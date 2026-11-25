// @vitest-environment node
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ObjectId, type Db } from 'mongodb';
import { MONGO_STARTUP_TIMEOUT, MONGO_STOP_TIMEOUT, startTestMongo, type TestMongo } from '@/test/mongo';
import { FakePayPal } from '@/test/fake-paypal';
import { pricingSpec } from '@/server/config/pricing';
import { publishDraft, saveDraft } from '@/server/config/versions';
import { collections } from '@/server/db/collections';
import { migrate } from '@/server/db/migrate';
import { getEntitlements, GRACE_DAYS } from '@/server/entitlements';
import { PayPalUnavailable } from './client';
import { closeRefundRequest, requestRefund } from '../refunds';
import {
  addMonth,
  applyEvent,
  cancelCheckout,
  claimEvent,
  finishEvent,
  checkoutState,
  ensureWebhook,
  quoteFor,
  reconcilePayPal,
  setBillingAccess,
  startCheckout,
  stopRenewal,
  syncSubscription,
  WEBHOOK_EVENTS,
} from './subscriptions';

const NOW = new Date('2026-12-01T10:00:00Z');
const DAY = 86_400_000;
const at = (days: number, from = NOW) => new Date(from.getTime() + days * DAY);
const BASE = 'https://studio.example.com';
const noNetwork = (async () => {
  throw new TypeError('no network in tests');
}) as typeof fetch;

let mongo: TestMongo;
let db: Db;
let paypal: FakePayPal;

async function publishPrice(amountMinor: number) {
  await saveDraft(db, pricingSpec, { prices: [{ id: 'pro-month-usd', planId: 'pro', interval: 'month', currency: 'USD', amountMinor, trialDays: null, active: true, providerRefs: {} }] }, 'admin:test');
  await publishDraft(db, pricingSpec, 'admin:test');
}

async function storeRate(rateMicros: number, date = '2026-11-30', checkedAt = NOW) {
  await collections(db).fxRates.updateOne({ _id: `USD_ILS:${date}` }, { $set: { pair: 'USD_ILS', date, rateMicros, source: 'boi', fetchedAt: checkedAt, checkedAt } }, { upsert: true });
}

async function newUser(extra: Record<string, unknown> = {}) {
  const _id = new ObjectId();
  await collections(db).users.insertOne({
    _id, name: 'Buyer', email: `${_id.toHexString()}@buyer.test`, emailVerified: true, createdAt: NOW, updatedAt: NOW,
    role: 'user', status: 'active', plan: 'free', marketingConsent: false, currency: 'USD', ...extra,
  } as never);
  return _id;
}

const shownUsd = (amountMinor = 1000) => ({ amountMinor, currency: 'USD' as const, rateDate: null });
const checkout = (userId: ObjectId, shown: { amountMinor: number; currency: 'USD' | 'ILS'; rateDate: string | null } = shownUsd(), when = NOW) => startCheckout(db, paypal, { userId, shown, consent: true, baseUrl: BASE }, when, noNetwork);
const sync = (id: string, when: Date) => syncSubscription(db, paypal, id, { now: when, actor: 'test' });
const planOf = async (userId: ObjectId, when: Date) => (await getEntitlements(db, userId, when)).planId;
const subOf = (userId: ObjectId) => collections(db).subscriptions.findOne({ userId });
const lastCreated = () => [...paypal.subscriptions.values()].at(-1)!;

/** A paying subscriber: checkout, approval at NOW, back on our return page. */
async function subscriber(extra: Record<string, unknown> = {}) {
  const userId = await newUser(extra);
  const started = await checkout(userId);
  if (started.ok === false) throw new Error(started.reason);
  const id = lastCreated().id;
  paypal.approve(id, NOW);
  await sync(id, at(0.001));
  return { userId, id, sessionId: started.sessionId };
}

beforeAll(async () => {
  mongo = await startTestMongo();
  db = mongo.db;
  await migrate(db);
}, MONGO_STARTUP_TIMEOUT);
afterAll(() => mongo?.stop(), MONGO_STOP_TIMEOUT);

beforeEach(async () => {
  const c = collections(db);
  await Promise.all([c.subscriptions.deleteMany({}), c.checkoutSessions.deleteMany({}), c.payments.deleteMany({}), c.billingPlans.deleteMany({}), c.fxRates.deleteMany({}), c.refundRequests.deleteMany({}), c.accessGrants.deleteMany({}), c.paymentEvents.deleteMany({}), c.configVersions.deleteMany({ kind: 'pricing' })]);
  paypal = new FakePayPal();
  paypal.now = () => NOW;
  await publishPrice(1000);
  await setBillingAccess(db, { openToEveryone: true, testerEmails: [] }, 'admin:test');
});

describe('checkout', () => {
  it('starts a PayPal subscription holding exactly the agreed price, and gives Pro only once PayPal has the payment', async () => {
    const userId = await newUser();
    const started = await checkout(userId);
    expect(started).toMatchObject({ ok: true, approveUrl: expect.stringMatching(/^https:\/\/www\.sandbox\.paypal\.com\//) });
    const sub = lastCreated();
    expect(sub.price).toEqual({ value: '10.00', currency_code: 'USD' });
    const create = paypal.calls.find((c) => c.method === 'POST' && c.path === '/v1/billing/subscriptions')!;
    expect(create.requestId).toBe((started as { sessionId: string }).sessionId);
    expect(create.body).toMatchObject({ custom_id: create.requestId, application_context: { return_url: `${BASE}/subscribe/return?checkout=${create.requestId}`, shipping_preference: 'NO_SHIPPING' } });

    // Back from PayPal before approving: nothing yet.
    expect(await checkoutState(db, paypal, create.requestId!, userId, NOW)).toEqual({ state: 'pending' });
    expect(await planOf(userId, NOW)).toBe('free');

    paypal.approve(sub.id, NOW);
    expect(await checkoutState(db, paypal, create.requestId!, userId, at(0.001))).toMatchObject({ state: 'active', paidThrough: addMonth(NOW) });
    expect(await planOf(userId, at(1))).toBe('pro');
    expect(await subOf(userId)).toMatchObject({
      provider: 'paypal', status: 'active', providerStatus: 'ACTIVE', amountMinor: 1000, currency: 'USD', basePriceMinor: 1000, fx: null,
      paidThrough: addMonth(NOW), currentPeriodEnd: addMonth(NOW), nextBillingAt: addMonth(NOW), environment: 'sandbox',
      consent: { amountMinor: 1000, currency: 'USD', interval: 'month' },
    });
    expect(await collections(db).payments.countDocuments({ userId, kind: 'charge', status: 'succeeded' })).toBe(1);
    expect(await collections(db).checkoutSessions.findOne({ _id: create.requestId })).toMatchObject({ status: 'completed' });
    // A second subscription is refused while this one runs.
    expect(await checkout(userId, shownUsd(), at(1))).toMatchObject({ ok: false, reason: 'already_subscribed' });
  });

  it('charges ILS at the Bank of Israel rate, and the subscriber keeps that amount whatever the price or the rate do later', async () => {
    await storeRate(3_343_000);
    const userId = await newUser({ currency: 'ILS' });
    expect((await quoteFor(db, 'ILS', NOW, noNetwork)) as unknown).toMatchObject({ ok: true, quote: { currency: 'ILS', amountMinor: 3343, fx: { rateMicros: 3_343_000, rateDate: '2026-11-30' } } });
    const started = await checkout(userId, { amountMinor: 3343, currency: 'ILS', rateDate: '2026-11-30' });
    expect(started.ok).toBe(true);
    const sub = lastCreated();
    expect(sub.price).toEqual({ value: '33.43', currency_code: 'ILS' });
    paypal.approve(sub.id, NOW);
    await sync(sub.id, at(0.001));
    expect(await subOf(userId)).toMatchObject({ amountMinor: 3343, currency: 'ILS', fx: { rateMicros: 3_343_000, rateDate: '2026-11-30', source: 'boi' } });

    // The owner raises the price and the shekel moves: new customers see the new amount…
    await publishPrice(1200);
    await storeRate(3_500_000, '2026-12-01');
    expect((await quoteFor(db, 'ILS', NOW, noNetwork)) as unknown).toMatchObject({ ok: true, quote: { amountMinor: 4200 } });
    // …the existing subscriber still renews at ₪33.43.
    paypal.renew(sub.id);
    await sync(sub.id, at(31));
    expect(await subOf(userId)).toMatchObject({ amountMinor: 3343, currency: 'ILS', paidThrough: addMonth(addMonth(NOW)) });
    expect((await collections(db).payments.find({ userId }).toArray()).map((p) => `${p.amountMinor} ${p.currency}`)).toEqual(['3343 ILS', '3343 ILS']);
    expect(sub.price).toEqual({ value: '33.43', currency_code: 'ILS' });
  });

  it('asks again when the price changed since it was shown, and only goes on with consent', async () => {
    const userId = await newUser();
    await publishPrice(1200);
    expect(await checkout(userId, shownUsd(1000))).toMatchObject({ ok: false, reason: 'price_changed', quote: { amountMinor: 1200 } });
    expect(await startCheckout(db, paypal, { userId, shown: shownUsd(1200), consent: false, baseUrl: BASE }, NOW, noNetwork)).toMatchObject({ ok: false, reason: 'consent_required' });
    expect(paypal.subscriptions.size).toBe(0);
  });

  it('offers no ILS price without a rate confirmed with the Bank of Israel within the hour', async () => {
    const userId = await newUser({ currency: 'ILS' });
    expect(await checkout(userId, { amountMinor: 3343, currency: 'ILS', rateDate: '2026-11-30' })).toMatchObject({ ok: false, reason: 'rate_unavailable' });
    await storeRate(3_343_000, '2026-11-30', at(-0.1));
    expect(await checkout(userId, { amountMinor: 3343, currency: 'ILS', rateDate: '2026-11-30' })).toMatchObject({ ok: false, reason: 'rate_unavailable' });
    expect(paypal.subscriptions.size).toBe(0);
  });

  it('pressing Continue twice reuses the same PayPal subscription', async () => {
    const userId = await newUser();
    const first = await checkout(userId);
    const second = await checkout(userId, shownUsd(), at(0.01));
    expect(second).toEqual(first);
    expect(paypal.subscriptions.size).toBe(1);
  });

  it('an approval abandoned at PayPal charges nothing, gives nothing, and a new checkout can start', async () => {
    const userId = await newUser();
    const first = (await checkout(userId)) as { sessionId: string };
    await cancelCheckout(db, first.sessionId, userId);
    expect(await checkoutState(db, paypal, first.sessionId, userId, NOW)).toEqual({ state: 'cancelled' });
    expect(await planOf(userId, NOW)).toBe('free');
    expect(await checkout(userId, shownUsd(), at(0.01))).toMatchObject({ ok: true });
    expect(paypal.subscriptions.size).toBe(2);
  });

  it('a checkout that is never approved gives nothing and is closed after a day', async () => {
    const userId = await newUser();
    const started = (await checkout(userId)) as { sessionId: string };
    await reconcilePayPal(db, paypal, 'test', at(2), noNetwork);
    expect(await collections(db).checkoutSessions.findOne({ _id: started.sessionId })).toMatchObject({ status: 'expired' });
    expect(await subOf(userId)).toBeNull();
    expect(await planOf(userId, at(2))).toBe('free');
  });

  it('is open only to administrators and listed testers until the owner opens it', async () => {
    await setBillingAccess(db, { openToEveryone: false, testerEmails: ['Tester@Example.com'] }, 'admin:test');
    expect(await checkout(await newUser())).toMatchObject({ ok: false, reason: 'not_open' });
    expect(await checkout(await newUser({ email: 'tester@example.com' }))).toMatchObject({ ok: true });
    expect(await checkout(await newUser({ role: 'admin' }))).toMatchObject({ ok: true });
    // Username test accounts have no confirmed address for receipts.
    expect(await checkout(await newUser({ role: 'admin', username: 'tomerpay' }))).toMatchObject({ ok: false, reason: 'email_not_verified' });
  });

  it('says when PayPal cannot be reached, and grants nothing', async () => {
    const userId = await newUser();
    paypal.failNext(/^POST \/v1\/billing\/subscriptions$/);
    expect(await checkout(userId)).toMatchObject({ ok: false, reason: 'paypal_unavailable' });
    expect(await collections(db).checkoutSessions.findOne({ userId })).toMatchObject({ status: 'cancelled' });
    expect(await planOf(userId, NOW)).toBe('free');
  });
});

describe('renewals and payment failures', () => {
  it('records each renewal once and moves the paid-through date by a month', async () => {
    const { userId, id } = await subscriber();
    paypal.renew(id);
    await sync(id, at(31));
    await sync(id, at(31.5)); // the same state read twice
    expect(await collections(db).payments.countDocuments({ userId, kind: 'charge' })).toBe(2);
    expect((await subOf(userId))!.paidThrough).toEqual(addMonth(addMonth(NOW)));
    expect(await planOf(userId, at(45))).toBe('pro');
  });

  it('keeps Pro through the grace week after a failed renewal, then returns the account to Free', async () => {
    const { userId, id } = await subscriber();
    paypal.failRenewal(id, true);
    const due = addMonth(NOW);
    await sync(id, at(2, due));
    expect(await subOf(userId)).toMatchObject({ status: 'past_due', providerStatus: 'SUSPENDED', failedPayments: 1 });
    expect(await collections(db).payments.countDocuments({ userId, status: 'failed' })).toBe(1);
    expect(await planOf(userId, at(GRACE_DAYS - 1, due))).toBe('pro');
    expect(await planOf(userId, at(GRACE_DAYS + 1, due))).toBe('free');
  });

  it('catches up through reconciliation when webhooks were missed', async () => {
    const userId = await newUser();
    await checkout(userId);
    const id = lastCreated().id;
    paypal.approve(id, NOW);
    // No return page, no webhook: only the hourly reconciliation.
    const run = await reconcilePayPal(db, paypal, 'cron', at(0.04), noNetwork);
    expect(run.checked).toBe(1);
    expect(await subOf(userId)).toMatchObject({ status: 'active', paidThrough: addMonth(NOW) });
    // A month later the renewal's webhook is missed too.
    paypal.renew(id);
    await reconcilePayPal(db, paypal, 'cron', at(31), noNetwork);
    expect(await subOf(userId)).toMatchObject({ status: 'active', paidThrough: addMonth(addMonth(NOW)) });
    expect(await collections(db).payments.countDocuments({ userId })).toBe(2);
    // An approval that arrives after its checkout lapsed is still found.
    const late = await newUser();
    const lateCheckout = (await checkout(late)) as { sessionId: string };
    await reconcilePayPal(db, paypal, 'cron', at(2), noNetwork);
    expect(await collections(db).checkoutSessions.findOne({ _id: lateCheckout.sessionId })).toMatchObject({ status: 'expired' });
    paypal.approve(lastCreated().id, at(3));
    await reconcilePayPal(db, paypal, 'cron', at(3.05), noNetwork);
    expect(await subOf(late)).toMatchObject({ status: 'active' });
  });
});

describe('stopping renewal', () => {
  it('cancels at PayPal at once, keeps Pro until the paid-through date, then Free', async () => {
    const { userId, id } = await subscriber();
    const result = await stopRenewal(db, paypal, userId, `user:${userId}`, at(10));
    expect(result).toEqual({ ok: true, paidThrough: addMonth(NOW) });
    expect(paypal.subscriptions.get(id)!.status).toBe('CANCELLED');
    expect(paypal.calls.find((c) => c.path.endsWith('/cancel'))!.body).toEqual({ reason: 'Renewal stopped by the customer in SketchyArtLab' });
    expect(await subOf(userId)).toMatchObject({ status: 'canceled', cancelAtPeriodEnd: true, paidThrough: addMonth(NOW), nextBillingAt: null });
    expect(await planOf(userId, at(-0.01, addMonth(NOW)))).toBe('pro');
    expect(await planOf(userId, at(0.01, addMonth(NOW)))).toBe('free');
    // Nothing more to stop; and a new subscription waits until the paid time is used up.
    expect(await stopRenewal(db, paypal, userId, 'test', at(11))).toEqual({ ok: false, reason: 'none' });
    expect(await checkout(userId, shownUsd(), at(12))).toMatchObject({ ok: false, reason: 'paid_until', until: addMonth(NOW) });
  });

  it('picks up a cancellation made in PayPal itself', async () => {
    const { userId, id } = await subscriber();
    paypal.cancelByBuyer(id, at(5));
    const outcome = await applyEvent(db, paypal, { id: 'WH-1', eventType: 'BILLING.SUBSCRIPTION.CANCELLED', createTime: at(5), resourceType: 'subscription', resourceId: id, subscriptionId: id, saleId: null, amount: null }, at(5));
    expect(outcome).toBe('processed');
    expect(await subOf(userId)).toMatchObject({ status: 'canceled', paidThrough: addMonth(NOW) });
    expect(await planOf(userId, at(20))).toBe('pro');
  });

  it('claims nothing when PayPal cannot be reached', async () => {
    const { userId } = await subscriber();
    paypal.failNext(/\/cancel$/, new PayPalUnavailable('timeout'));
    expect(await stopRenewal(db, paypal, userId, 'test', at(3))).toEqual({ ok: false, reason: 'paypal_unavailable' });
    expect(await subOf(userId)).toMatchObject({ status: 'active', providerStatus: 'ACTIVE' });
  });

  it('never touches a manual Pro grant, which keeps Pro after the paid time ends', async () => {
    const { userId } = await subscriber();
    await collections(db).accessGrants.insertOne({ userId, planId: 'pro', startsAt: NOW, endsAt: at(90), reason: 'promotion', grantedBy: 'admin:test', createdAt: NOW, revokedAt: null } as never);
    await stopRenewal(db, paypal, userId, 'test', at(1));
    expect(await collections(db).accessGrants.countDocuments({ userId, revokedAt: null })).toBe(1);
    expect(await planOf(userId, at(60))).toBe('pro');
  });
});

describe('safety', () => {
  it('ignores subscriptions this server did not create', async () => {
    const plan = [...paypal.plans.keys()][0] ?? (await checkout(await newUser()), [...paypal.plans.keys()][0]);
    const foreign = (await paypal.request<{ id: string }>('POST', '/v1/billing/subscriptions', { body: { plan_id: plan, custom_id: 'cs_someone_else' } })).id;
    paypal.approve(foreign, NOW);
    expect((await sync(foreign, at(0.01))).outcome).toBe('unknown');
    expect(await collections(db).subscriptions.countDocuments({ providerSubscriptionId: foreign })).toBe(0);
  });

  it("shows a checkout only to the account that started it, and stops only one's own renewal", async () => {
    const { sessionId } = await subscriber();
    const other = await newUser();
    expect(await checkoutState(db, paypal, sessionId, other, at(1))).toEqual({ state: 'not_found' });
    expect(await stopRenewal(db, paypal, other, 'test', at(1))).toEqual({ ok: false, reason: 'none' });
  });

  it('stops and flags a subscription PayPal charges a different amount for, keeping what was paid', async () => {
    const userId = await newUser();
    await checkout(userId);
    paypal.chargeOverride = '12.00';
    const id = lastCreated().id;
    paypal.approve(id, NOW);
    expect((await sync(id, at(0.01))).flag).toBe('price_mismatch');
    expect(paypal.subscriptions.get(id)!.status).toBe('CANCELLED');
    expect(await subOf(userId)).toMatchObject({ status: 'canceled', flag: 'price_mismatch', amountMinor: 1000 });
    expect(await planOf(userId, at(10))).toBe('pro');
  });

  it('stops and flags a second paid subscription for the same account', async () => {
    const { userId } = await subscriber();
    const planId = [...paypal.plans.keys()][0];
    const dup = (await paypal.request<{ id: string }>('POST', '/v1/billing/subscriptions', { body: { plan_id: planId, custom_id: 'cs_old_link', plan: { billing_cycles: [{ sequence: 1, pricing_scheme: { fixed_price: { value: '10.00', currency_code: 'USD' } } }] } } })).id;
    await collections(db).checkoutSessions.insertOne({ _id: 'cs_old_link', userId, provider: 'paypal', priceId: 'pro-month-usd', couponCode: null, status: 'open', createdAt: NOW, expiresAt: at(0.02), completedAt: null, providerSubscriptionId: dup, amountMinor: 1000, currency: 'USD', environment: 'sandbox' });
    paypal.approve(dup, at(0.5));
    expect((await sync(dup, at(0.6))).flag).toBe('duplicate');
    expect(paypal.subscriptions.get(dup)!.status).toBe('CANCELLED');
    expect(await collections(db).subscriptions.countDocuments({ userId, status: 'active' })).toBe(1);
  });

  it('a full refund or a chargeback ends the paid time it returned, and a later read of PayPal does not bring it back', async () => {
    const { userId, id } = await subscriber();
    await collections(db).refundRequests.insertOne({ userId, provider: 'paypal', providerSubscriptionId: id, reason: null, status: 'open', requestedAt: at(1), suggested: { kind: 'full', amountMinor: 1000, currency: 'USD', providerPaymentId: null }, decidedAt: null, decidedBy: null, note: null });
    const sale = (await collections(db).payments.findOne({ userId, kind: 'charge' }))!;
    const refund = { id: 'WH-2', eventType: 'PAYMENT.SALE.REFUNDED', createTime: at(2), resourceType: 'refund', resourceId: 'REFUND-1', subscriptionId: null, saleId: sale.providerPaymentId, amount: { value: '10.00', currency: 'USD' } };
    expect(await applyEvent(db, paypal, refund, at(2))).toBe('processed');
    expect(await applyEvent(db, paypal, refund, at(2))).toBe('processed'); // delivered twice: recorded once
    expect(await collections(db).payments.countDocuments({ userId, kind: 'refund' })).toBe(1);
    expect(await planOf(userId, at(3))).toBe('free');
    expect(await collections(db).refundRequests.findOne({ userId })).toMatchObject({ status: 'refunded', decidedBy: 'paypal' });
    await sync(id, at(4));
    expect(await planOf(userId, at(5))).toBe('free');
  });
});

describe('the webhook PayPal notifies', () => {
  it('is registered once for every event handled, and only for an https address', async () => {
    const url = `${BASE}/api/billing/paypal/webhook`;
    const first = await ensureWebhook(paypal, url);
    expect(first.created).toBe(true);
    expect(paypal.webhooks[0].event_types.map((e) => e.name)).toEqual([...WEBHOOK_EVENTS]);
    expect(await ensureWebhook(paypal, url)).toEqual({ id: first.id, created: false });
    expect(paypal.webhooks).toHaveLength(1);
    await expect(ensureWebhook(paypal, 'http://localhost:8080/api/billing/paypal/webhook')).rejects.toThrow('https');
  });
});

describe('webhook deliveries', () => {
  it('are applied once, and again only after an attempt that failed', async () => {
    const event = { id: 'WH-9', eventType: 'BILLING.SUBSCRIPTION.UPDATED', createTime: NOW, resourceType: 'subscription', resourceId: 'I-1', subscriptionId: 'I-1', saleId: null, amount: null };
    expect(await claimEvent(db, event, NOW)).toBe('claimed');
    expect(await claimEvent(db, event, NOW)).toBe('duplicate');
    await finishEvent(db, event.id, 'failed', 'PayPal answered 503');
    expect(await claimEvent(db, event, at(0.001))).toBe('claimed');
    await finishEvent(db, event.id, 'processed');
    expect(await claimEvent(db, event, at(0.002))).toBe('duplicate');
  });
});

describe('refund requests', () => {
  it('stop renewal at once and suggest a full refund within 7 days of the first payment, once per account', async () => {
    const { userId, id } = await subscriber();
    const first = await requestRefund(db, paypal, userId, 'Not for me', 'test', at(3));
    expect(first).toMatchObject({ ok: true, request: { status: 'open', reason: 'Not for me', suggested: { kind: 'full', amountMinor: 1000, currency: 'USD' } } });
    expect(paypal.subscriptions.get(id)!.status).toBe('CANCELLED');
    // Asking again returns the same open request.
    expect((await requestRefund(db, paypal, userId, null, 'test', at(3.1))) as unknown).toMatchObject({ ok: true, request: { _id: (first as { request: { _id: unknown } }).request._id } });
    expect(await closeRefundRequest(db, String((first as { request: { _id: unknown } }).request._id), 'refunded', 'Refunded in PayPal', 'admin:owner', at(4))).toBe('closed');
    // A second subscription later: no second full refund.
    await subOf(userId);
  });

  it('suggest the unused part of the paid period after 7 days', async () => {
    const { userId } = await subscriber();
    const paidThrough = addMonth(NOW);
    const when = new Date(NOW.getTime() + (paidThrough.getTime() - NOW.getTime()) / 2);
    expect(await requestRefund(db, paypal, userId, null, 'test', when)).toMatchObject({ ok: true, request: { suggested: { kind: 'prorated', amountMinor: 500 } } });
  });

  it('need a paid period running now', async () => {
    expect(await requestRefund(db, paypal, await newUser(), null, 'test', NOW)).toEqual({ ok: false, reason: 'none' });
  });
});
