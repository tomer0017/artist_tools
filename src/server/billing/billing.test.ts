// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ObjectId, type Db } from 'mongodb';
import { MONGO_STARTUP_TIMEOUT, startTestMongo, type TestMongo } from '@/test/mongo';
import { collections } from '@/server/db/collections';
import { migrate } from '@/server/db/migrate';
import { pricingSpec } from '@/server/config/pricing';
import { publishDraft, saveDraft } from '@/server/config/versions';
import { clearPlanCache, getEntitlements } from '@/server/entitlements';
import { CHECKOUT_TTL_MS, checkoutStatus, openCheckoutSession } from './checkout';
import { billingMetrics } from './metrics';
import { processPaymentEvent } from './process';
import type { ProviderPayment, ProviderSubscription, VerifiedPaymentEvent } from './provider';
import { reconcileSubscriptions } from './reconcile';
import { InvalidSignature, SIGNATURE_TOLERANCE_SECONDS, signPayload, verifySignature } from './signature';

// Billing is exercised with verified events built directly here (what a
// provider adapter hands over after checking the signature). The prices are
// test fixtures in a throwaway database, not decisions.

const DAY = 86_400_000;
const NOW = new Date();
const later = (ms: number) => new Date(NOW.getTime() + ms);

let mongo: TestMongo;

beforeAll(async () => {
  mongo = await startTestMongo();
  await migrate(mongo.db);
  const prices = [
    { id: 'pro-month-usd', planId: 'pro', interval: 'month', currency: 'USD', amountMinor: 900, trialDays: null, active: true },
    { id: 'pro-year-ils', planId: 'pro', interval: 'year', currency: 'ILS', amountMinor: 36_000, trialDays: 7, active: true },
    { id: 'pro-month-old', planId: 'pro', interval: 'month', currency: 'USD', amountMinor: 700, trialDays: null, active: false },
  ];
  expect((await saveDraft(mongo.db, pricingSpec, { prices }, 'admin:test')).status).toBe('saved');
  expect((await publishDraft(mongo.db, pricingSpec, 'admin:test')).status).toBe('published');
}, MONGO_STARTUP_TIMEOUT);
afterAll(async () => mongo?.stop());

async function newUser(db: Db, options: { emailVerified?: boolean; status?: 'active' | 'suspended'; testAccount?: boolean } = {}) {
  const _id = new ObjectId();
  await collections(db).users.insertOne({
    _id,
    name: 'Painter',
    email: `${_id.toHexString()}@example.com`,
    emailVerified: options.emailVerified ?? true,
    createdAt: NOW,
    updatedAt: NOW,
    role: 'user',
    status: options.status ?? 'active',
    marketingConsent: false,
    ...(options.testAccount ? { testAccount: true } : {}),
  });
  return _id;
}

const providerSub = (userId: ObjectId, id: string, at: Date, patch: Partial<ProviderSubscription> = {}): ProviderSubscription => ({
  userId: userId.toHexString(),
  planId: 'pro',
  providerCustomerId: `cus_${userId.toHexString().slice(-8)}`,
  providerSubscriptionId: id,
  status: 'active',
  currentPeriodStart: at,
  currentPeriodEnd: new Date(at.getTime() + 30 * DAY),
  cancelAtPeriodEnd: false,
  canceledAt: null,
  priceId: 'pro-month-usd',
  interval: 'month',
  currency: 'USD',
  amountMinor: 900,
  ...patch,
});

let seq = 0;
const subEvent = (userId: ObjectId, id: string, at: Date, patch: Partial<ProviderSubscription> = {}, extra: Partial<VerifiedPaymentEvent> = {}): VerifiedPaymentEvent => ({
  provider: 'test',
  eventId: `evt_${++seq}`,
  type: 'subscription.updated',
  occurredAt: at,
  subscription: providerSub(userId, id, at, patch),
  ...extra,
});

const payEvent = (userId: ObjectId, id: string, at: Date, patch: Partial<ProviderPayment> = {}): VerifiedPaymentEvent => ({
  provider: 'test',
  eventId: `evt_${++seq}`,
  type: 'payment',
  occurredAt: at,
  payment: {
    providerPaymentId: id,
    providerSubscriptionId: null,
    userId: userId.toHexString(),
    kind: 'charge',
    status: 'succeeded',
    amountMinor: 900,
    currency: 'USD',
    occurredAt: at,
    receiptUrl: null,
    ...patch,
  },
});

describe('webhook signatures', () => {
  const secret = 'whsec_for_tests_only';
  const body = JSON.stringify({ id: 'evt_1', type: 'subscription.updated' });
  const at = NOW.getTime();

  it('accept the exact body, signed with the secret, within the time window', () => {
    expect(() => verifySignature(secret, body, signPayload(secret, body, at), at + (SIGNATURE_TOLERANCE_SECONDS - 1) * 1000)).not.toThrow();
  });

  it('refuse anything else', () => {
    const header = signPayload(secret, body, at);
    const refused: [string, string | null, number][] = [
      [`${body} `, header, at], // body changed after signing
      [body, signPayload('another-secret', body, at), at],
      [body, null, at],
      [body, 't=abc,v1=00', at],
      [body, header.replace(/v1=./, 'v1=x'), at],
      [body, header, at + (SIGNATURE_TOLERANCE_SECONDS + 1) * 1000], // replayed later
      [body, header, at - (SIGNATURE_TOLERANCE_SECONDS + 1) * 1000],
    ];
    for (const [b, h, now] of refused) expect(() => verifySignature(secret, b, h, now)).toThrow(InvalidSignature);
  });
});

describe('payment events', () => {
  it('never apply older subscription state over newer', async () => {
    const db = mongo.db;
    const userId = await newUser(db);
    expect(await processPaymentEvent(db, subEvent(userId, 'sub_order', later(-DAY), { status: 'past_due' }))).toBe('processed');
    const late = subEvent(userId, 'sub_order', later(-2 * DAY), { status: 'active' });
    expect(await processPaymentEvent(db, late)).toBe('stale');

    const { subscriptions, paymentEvents } = collections(db);
    const sub = await subscriptions.findOne({ providerSubscriptionId: 'sub_order' });
    expect(sub.status).toBe('past_due');
    expect(sub.lastEventAt).toEqual(later(-DAY));
    // Still marked handled, so the provider does not keep retrying it.
    expect(await paymentEvents.findOne({ eventId: late.eventId })).toMatchObject({ status: 'processed' });
  });

  it('end in the newest state when deliveries arrive at once', async () => {
    const db = mongo.db;
    const userId = await newUser(db);
    const hours = [3, 1, 5, 2, 4];
    const results = await Promise.all(hours.map((h) => processPaymentEvent(db, subEvent(userId, 'sub_race', later(h * 3_600_000), { amountMinor: 1000 + h }))));
    expect(results.every((r) => r === 'processed' || r === 'stale')).toBe(true);
    const sub = await collections(db).subscriptions.findOne({ providerSubscriptionId: 'sub_race' });
    expect(sub).toMatchObject({ amountMinor: 1005, lastEventAt: later(5 * 3_600_000) });
    expect(await collections(db).subscriptions.countDocuments({ providerSubscriptionId: 'sub_race' })).toBe(1);
  });

  it('record each payment once, and money alone grants nothing', async () => {
    const db = mongo.db;
    clearPlanCache();
    const userId = await newUser(db);
    expect(await processPaymentEvent(db, payEvent(userId, 'pay_1', NOW))).toBe('processed');
    // The same charge reported by a second event (an invoice and a charge notification).
    expect(await processPaymentEvent(db, payEvent(userId, 'pay_1', NOW))).toBe('processed');
    await processPaymentEvent(db, payEvent(userId, 'pay_2', NOW, { status: 'failed' }));

    const { payments, auditEvents } = collections(db);
    expect(await payments.countDocuments({ userId })).toBe(2);
    expect(await payments.countDocuments({ providerPaymentId: 'pay_1' })).toBe(1);
    expect(await auditEvents.countDocuments({ userId, type: 'billing.payment' })).toBe(2);
    expect((await getEntitlements(db, userId)).planId).toBe('free');
  });

  it('remember the provider customer for the account', async () => {
    const db = mongo.db;
    const userId = await newUser(db);
    await processPaymentEvent(db, subEvent(userId, 'sub_cus', NOW, { providerCustomerId: 'cus_a' }));
    await processPaymentEvent(db, subEvent(userId, 'sub_cus', later(1000), { providerCustomerId: 'cus_a' }));
    const customers = await collections(db).billingCustomers.find({ userId }).toArray();
    expect(customers.map((c) => [c.provider, c.providerCustomerId])).toEqual([['test', 'cus_a']]);
  });

  it('count a coupon once, when the subscription it started is created', async () => {
    const db = mongo.db;
    const { coupons, couponRedemptions } = collections(db);
    const { insertedId } = await coupons.insertOne({
      code: 'LAUNCH20',
      kind: 'percent',
      percentOff: 20,
      amountOffMinor: null,
      currency: null,
      appliesTo: [],
      startsAt: later(-DAY),
      endsAt: null,
      maxRedemptions: null,
      maxPerUser: 1,
      status: 'active',
      note: null,
      createdBy: 'admin:test',
      createdAt: NOW,
      updatedAt: NOW,
    });
    const userId = await newUser(db);
    await processPaymentEvent(db, subEvent(userId, 'sub_coupon', NOW, { couponCode: 'launch20' }));
    await processPaymentEvent(db, subEvent(userId, 'sub_coupon', later(30 * DAY), { couponCode: 'LAUNCH20' })); // the renewal still names it
    expect(await couponRedemptions.countDocuments({ couponId: insertedId, userId })).toBe(1);
  });
});

describe('checkout sessions', () => {
  it('open only for an active, published price and an account that may buy', async () => {
    const db = mongo.db;
    await collections(db).coupons.insertOne({
      code: 'YEARLY-ILS',
      kind: 'fixed',
      percentOff: null,
      amountOffMinor: 5000,
      currency: 'ILS',
      appliesTo: ['pro:year'],
      startsAt: later(-DAY),
      endsAt: null,
      maxRedemptions: null,
      maxPerUser: 1,
      status: 'active',
      note: null,
      createdBy: 'admin:test',
      createdAt: NOW,
      updatedAt: NOW,
    });
    const buyer = await newUser(db);
    const subscribed = await newUser(db);
    await processPaymentEvent(db, subEvent(subscribed, 'sub_existing', NOW));
    const open = (userId: ObjectId, priceId: string, couponCode: string | null = null) =>
      openCheckoutSession(db, { userId, provider: 'test', priceId, couponCode }, NOW);

    expect(await open(buyer, 'no-such-price')).toEqual({ ok: false, reason: 'unknown_price' });
    expect(await open(buyer, 'pro-month-old')).toEqual({ ok: false, reason: 'unknown_price' }); // not active
    expect(await open(await newUser(db, { emailVerified: false }), 'pro-month-usd')).toEqual({ ok: false, reason: 'email_not_verified' });
    expect(await open(await newUser(db, { status: 'suspended' }), 'pro-month-usd')).toEqual({ ok: false, reason: 'account_unavailable' });
    expect(await open(new ObjectId(), 'pro-month-usd')).toEqual({ ok: false, reason: 'account_unavailable' });
    expect(await open(subscribed, 'pro-year-ils')).toEqual({ ok: false, reason: 'already_subscribed' });
    expect(await open(buyer, 'pro-month-usd', 'NOPE')).toEqual({ ok: false, reason: 'unknown' });
    expect(await open(buyer, 'pro-month-usd', 'YEARLY-ILS')).toEqual({ ok: false, reason: 'not_eligible' });

    const started = await open(buyer, 'pro-year-ils', ' yearly-ils ');
    if (started.ok === false) throw new Error(`refused: ${started.reason}`);
    expect(started.session).toMatchObject({ userId: buyer, provider: 'test', priceId: 'pro-year-ils', couponCode: 'YEARLY-ILS', status: 'open' });
    expect(started.session._id).toMatch(/^cs_[A-Za-z0-9_-]{24}$/);
    expect(started.session.expiresAt.getTime() - NOW.getTime()).toBe(CHECKOUT_TTL_MS);
    expect(await collections(db).auditEvents.countDocuments({ userId: buyer, type: 'billing.checkout_started' })).toBe(1);
  });

  it('complete only from a verified event for the same account, never from the return page', async () => {
    const db = mongo.db;
    clearPlanCache();
    const buyer = await newUser(db);
    const someoneElse = await newUser(db);
    const started = await openCheckoutSession(db, { userId: buyer, provider: 'test', priceId: 'pro-month-usd' }, NOW);
    if (started.ok === false) throw new Error(`refused: ${started.reason}`);
    const id = started.session._id;

    expect(await checkoutStatus(db, id, buyer, NOW)).toBe('open');
    expect(await checkoutStatus(db, id, someoneElse, NOW)).toBe('not_found');
    expect(await checkoutStatus(db, id, buyer, later(CHECKOUT_TTL_MS))).toBe('expired');

    // An event naming this checkout for another account changes nothing.
    expect(await processPaymentEvent(db, subEvent(someoneElse, 'sub_wrong', NOW, {}, { checkoutSessionId: id }))).toBe('ignored');
    expect(await collections(db).subscriptions.countDocuments({ providerSubscriptionId: 'sub_wrong' })).toBe(0);
    expect(await checkoutStatus(db, id, buyer, NOW)).toBe('open');
    expect((await getEntitlements(db, buyer)).planId).toBe('free');

    expect(await processPaymentEvent(db, subEvent(buyer, 'sub_right', NOW, {}, { checkoutSessionId: id }))).toBe('processed');
    expect(await checkoutStatus(db, id, buyer, NOW)).toBe('completed');
    clearPlanCache();
    expect((await getEntitlements(db, buyer)).planId).toBe('pro');
  });
});

describe('billing metrics', () => {
  it('report recurring revenue per currency, live subscriptions, churn and money returned', async () => {
    const db = mongo.client.db(`metrics_${new ObjectId().toHexString()}`);
    await migrate(db);
    const sub = async (patch: Partial<ProviderSubscription>, options: { testAccount?: boolean } = {}) => {
      const userId = await newUser(db, options);
      await processPaymentEvent(db, subEvent(userId, `sub_${userId}`, NOW, patch));
      return userId;
    };
    const monthly = await sub({});
    const yearly = await sub({ interval: 'year', currency: 'ILS', amountMinor: 36_000, priceId: 'pro-year-ils' });
    await sub({ status: 'trialing', trialEndsAt: later(7 * DAY) });
    const pastDue = await sub({ status: 'past_due' });
    await sub({ cancelAtPeriodEnd: true });
    await sub({ amountMinor: 5000 }, { testAccount: true });
    await sub({ status: 'expired', endedAt: later(-10 * DAY) });
    await sub({ status: 'canceled', endedAt: later(-40 * DAY) });

    await processPaymentEvent(db, payEvent(monthly, 'refund_1', later(-2 * DAY), { kind: 'refund', amountMinor: 300 }));
    await processPaymentEvent(db, payEvent(monthly, 'refund_old', later(-45 * DAY), { kind: 'refund', amountMinor: 900 }));
    await processPaymentEvent(db, payEvent(pastDue, 'charge_failed', later(-1 * DAY), { status: 'failed' }));
    await processPaymentEvent(db, payEvent(yearly, 'dispute_1', later(-3 * DAY), { kind: 'chargeback', currency: 'ILS', amountMinor: 36_000 }));

    expect(await billingMetrics(db, { now: NOW })).toEqual({
      mrrMinor: { USD: 2700, ILS: 3000 },
      arrMinor: { USD: 32_400, ILS: 36_000 },
      subscriptions: { active: 3, trialing: 1, pastDue: 1, cancelingAtPeriodEnd: 1 },
      last30Days: { ended: 1, churnRate: 1 / 6, refunds: { count: 1, amountMinor: { USD: 300 } }, failedPayments: 1, chargebacks: 1 },
    });
    expect((await billingMetrics(db, { now: NOW, includeTestAccounts: true })).mrrMinor.USD).toBe(7700);
  });

  it('are empty, not zero-filled guesses, before any provider is connected', async () => {
    const db = mongo.client.db(`metrics_${new ObjectId().toHexString()}`);
    await migrate(db);
    expect(await billingMetrics(db, { now: NOW })).toMatchObject({ mrrMinor: {}, arrMinor: {}, last30Days: { ended: 0, churnRate: null } });
  });
});

describe('reconciliation', () => {
  it('corrects what the provider reports differently, audits it, and keeps the run', async () => {
    const db = mongo.db;
    const a = await newUser(db);
    const b = await newUser(db);
    const c = await newUser(db);
    for (const [user, id] of [[a, 'sub_r1'], [b, 'sub_r2'], [c, 'sub_r3']] as const) {
      await processPaymentEvent(db, subEvent(user, id, NOW, {}, { provider: 'recon' }));
    }
    // The provider's own records: sub_r1 was set to cancel at period end (a
    // missed webhook), sub_r2 matches, sub_r3 is unknown there.
    const theirs = new Map([
      ['sub_r1', providerSub(a, 'sub_r1', NOW, { cancelAtPeriodEnd: true })],
      ['sub_r2', providerSub(b, 'sub_r2', NOW)],
    ]);
    const source = { id: 'recon', fetchSubscription: async (id: string) => theirs.get(id) ?? null };

    const run = await reconcileSubscriptions(db, source, 'admin:test', later(DAY));
    expect(run).toMatchObject({ checked: 3, missing: ['sub_r3'], fixed: [{ providerSubscriptionId: 'sub_r1', field: 'cancelAtPeriodEnd', ours: 'false', theirs: 'true' }] });

    const { subscriptions, auditEvents, reconciliationRuns } = collections(db);
    expect(await subscriptions.findOne({ providerSubscriptionId: 'sub_r1' })).toMatchObject({ cancelAtPeriodEnd: true, lastEventAt: later(DAY) });
    expect(await subscriptions.findOne({ providerSubscriptionId: 'sub_r3' })).toMatchObject({ status: 'active' }); // left for an admin
    expect(await auditEvents.find({ type: 'billing.reconciled' }).toArray()).toMatchObject([{ userId: a, actor: 'admin:test' }]);
    expect(await reconciliationRuns.countDocuments({ provider: 'recon' })).toBe(1);

    // An event older than the correction no longer overrides it.
    expect(await processPaymentEvent(db, subEvent(a, 'sub_r1', later(DAY / 2), {}, { provider: 'recon' }))).toBe('stale');
    expect((await reconcileSubscriptions(db, source, 'admin:test', later(2 * DAY))).fixed).toEqual([]);
  });
});
