import 'server-only';
import { randomBytes } from 'node:crypto';
import type { Db, ObjectId } from 'mongodb';
import { isCurrency, type Currency } from '@/lib/locale';
import { trackEvent } from '@/server/analytics';
import { recordAudit } from '@/server/audit';
import { pricingSpec } from '@/server/config/pricing';
import { getPublished } from '@/server/config/versions';
import { collections, isDuplicateKeyError, type CheckoutSessionDoc, type ReconciliationRunDoc, type SubscriptionDoc, type SubscriptionStatus } from '@/server/db/collections';
import { subscriptionGrantsPlan } from '@/server/entitlements';
import { log } from '@/server/log';
import { rateForQuote, refreshRates, usdToIls } from '../fx';
import { PayPalError, PayPalUnavailable, type PayPalClient } from './client';
import type { PayPalWebhookEvent } from './webhook';

// ─── PayPal subscriptions (docs/billing/03-paypal.md) ─────────────────────────
// Pro is one monthly price in USD (Admin → Pricing). A customer pays in the
// currency of their Profile preference: USD as it is, or ILS converted at the
// Bank of Israel's latest representative rate (src/server/billing/fx.ts).
// Whatever they agree to at checkout is theirs for the life of the
// subscription: each PayPal subscription carries its own price (PayPal's
// plan override), so there is one PayPal plan per currency and a new price or
// a new rate never touches an existing subscriber.
//
// Nothing the browser says grants anything. Every change of state is read
// from PayPal with our own credentials — after the customer returns from
// PayPal, after a verified webhook, and by the hourly reconciliation — and
// only subscriptions this server created count. Pro lasts until the end of
// the period verified payments cover (`paidThrough`, mirrored into
// `currentPeriodEnd` for entitlements). Stopping renewal cancels at PayPal at
// once (it has no "cancel at period end") and keeps Pro until then.

export const PROVIDER = 'paypal';
/** How long the offer a customer agreed to stays valid before they reach PayPal. */
export const CHECKOUT_LOCK_MS = 30 * 60 * 1000;
/** Version of the checkout terms the customer agrees to (recorded with the consent). */
export const TERMS_VERSION = '2026-11-23';
const DAY_MS = 24 * 60 * 60 * 1000;

/** What PayPal sends us back for monthly renewals and cancellations; the full list is registered with the webhook. */
export const WEBHOOK_EVENTS = [
  'BILLING.SUBSCRIPTION.CREATED',
  'BILLING.SUBSCRIPTION.ACTIVATED',
  'BILLING.SUBSCRIPTION.UPDATED',
  'BILLING.SUBSCRIPTION.EXPIRED',
  'BILLING.SUBSCRIPTION.CANCELLED',
  'BILLING.SUBSCRIPTION.SUSPENDED',
  'BILLING.SUBSCRIPTION.PAYMENT.FAILED',
  'PAYMENT.SALE.COMPLETED',
  'PAYMENT.SALE.DENIED',
  'PAYMENT.SALE.PENDING',
  'PAYMENT.SALE.REFUNDED',
  'PAYMENT.SALE.REVERSED',
  'CUSTOMER.DISPUTE.CREATED',
  'CUSTOMER.DISPUTE.UPDATED',
  'CUSTOMER.DISPUTE.RESOLVED',
] as const;

// ─── Money and dates ───

/** PayPal's "33.43" → 3343 (both currencies here have two decimals); null for anything else. */
export function moneyToMinor(value: unknown): number | null {
  if (typeof value !== 'string') return null;
  const match = /^(\d{1,9})(?:\.(\d{1,2}))?$/.exec(value.trim());
  return match ? Number(match[1]) * 100 + Number((match[2] ?? '').padEnd(2, '0')) : null;
}
export const minorToValue = (minor: number) => `${Math.floor(minor / 100)}.${String(minor % 100).padStart(2, '0')}`;

const dateOf = (value: unknown) => (typeof value === 'string' && !Number.isNaN(Date.parse(value)) ? new Date(value) : null);
const latest = (...dates: (Date | null | undefined)[]) => dates.reduce<Date | null>((a, b) => (b && (!a || b > a) ? b : a), null);

/** The same moment a calendar month later (UTC), on the month's last day when it is shorter (31 January → 28 February). */
export function addMonth(at: Date): Date {
  const next = new Date(at);
  next.setUTCDate(1);
  next.setUTCMonth(next.getUTCMonth() + 1);
  const lastDay = new Date(Date.UTC(next.getUTCFullYear(), next.getUTCMonth() + 1, 0)).getUTCDate();
  next.setUTCDate(Math.min(at.getUTCDate(), lastDay));
  return next;
}

// ─── PayPal's resources, as far as they are used ───

interface PayPalMoney {
  currency_code?: string;
  value?: string;
}
interface PayPalLink {
  href: string;
  rel: string;
}
export interface PayPalSubscription {
  id: string;
  status?: string;
  status_update_time?: string;
  create_time?: string;
  update_time?: string;
  custom_id?: string;
  plan_id?: string;
  plan_overridden?: boolean;
  plan?: { billing_cycles?: { sequence?: number; pricing_scheme?: { fixed_price?: PayPalMoney } }[] };
  subscriber?: { payer_id?: string };
  billing_info?: { last_payment?: { amount?: PayPalMoney; time?: string }; next_billing_time?: string; failed_payments_count?: number };
  links?: PayPalLink[];
}
interface PayPalTransaction {
  id: string;
  status?: string;
  amount_with_breakdown?: { gross_amount?: PayPalMoney };
  time?: string;
}

// ─── Who may subscribe ───

/** Until the owner opens subscriptions to everyone, only administrators and the listed testers may subscribe. */
export async function billingAccess(db: Db): Promise<{ openToEveryone: boolean; testerEmails: string[] }> {
  const doc = await collections(db).billingSettings.findOne({ _id: 'access' });
  return { openToEveryone: doc?.openToEveryone === true, testerEmails: doc?.testerEmails ?? [] };
}

export async function setBillingAccess(db: Db, input: { openToEveryone: boolean; testerEmails: string[] }, actor: string, now = new Date()): Promise<void> {
  const testerEmails = [...new Set(input.testerEmails.map((e) => e.trim().toLowerCase()).filter((e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)))].slice(0, 50);
  await collections(db).billingSettings.updateOne(
    { _id: 'access' },
    { $set: { openToEveryone: input.openToEveryone, testerEmails, updatedAt: now, updatedBy: actor } },
    { upsert: true },
  );
  await recordAudit(db, { type: 'admin.billing_access_changed', actor, metadata: { openToEveryone: input.openToEveryone, testers: testerEmails.length } });
}

// ─── The price ───

export interface BasePrice {
  priceId: string;
  /** USD cents. */
  amountMinor: number;
  /** The published pricing version it comes from. */
  version: number;
}

/** The published monthly Pro price in USD, or null (nothing published, unreadable, or none offered): no checkout then. */
export async function basePrice(db: Db): Promise<BasePrice | null> {
  const published = await getPublished(db, pricingSpec);
  if (!published) return null;
  const parsed = pricingSpec.schema.safeParse(published.document);
  if (!parsed.success) return null;
  const price = parsed.data.prices.find((p) => p.active && p.planId === 'pro' && p.interval === 'month' && p.currency === 'USD');
  return price && price.amountMinor > 0 ? { priceId: price.id, amountMinor: price.amountMinor, version: published.version } : null;
}

export interface Quote {
  currency: Currency;
  amountMinor: number;
  base: BasePrice;
  /** For ILS: the rate it was converted at, in millionths, and that rate's publication date. */
  fx: { rateMicros: number; rateDate: string; source: 'boi' } | null;
}

export type QuoteRefusal = 'no_price' | 'rate_unavailable';

/** The monthly price in `currency` right now. ILS needs the Bank of Israel's latest rate, confirmed within the hour. */
export async function quoteFor(db: Db, currency: Currency, now = new Date(), fetchImpl?: typeof fetch): Promise<{ ok: true; quote: Quote } | { ok: false; reason: QuoteRefusal }> {
  const base = await basePrice(db);
  if (!base) return { ok: false, reason: 'no_price' };
  if (currency === 'USD') return { ok: true, quote: { currency, amountMinor: base.amountMinor, base, fx: null } };
  const rate = await rateForQuote(db, now, fetchImpl);
  if (!rate) return { ok: false, reason: 'rate_unavailable' };
  return {
    ok: true,
    quote: { currency, amountMinor: usdToIls(base.amountMinor, rate.rateMicros), base, fx: { rateMicros: rate.rateMicros, rateDate: rate.date, source: 'boi' } },
  };
}

// ─── PayPal's product and plans: one plan per environment and currency ───

/** The PayPal plan for `currency`, created (with its product) the first time and checked again at most hourly. */
export async function ensurePlan(db: Db, client: PayPalClient, currency: Currency, defaultAmountMinor: number, now = new Date()): Promise<string> {
  const { billingPlans } = collections(db);
  const _id = `${client.environment}:${currency}`;
  const known = await billingPlans.findOne({ _id });
  if (known) {
    if (known.status === 'ACTIVE' && now.getTime() - known.checkedAt.getTime() < 60 * 60 * 1000) return known.planId;
    const plan = await client.request<{ id: string; status?: string }>('GET', `/v1/billing/plans/${encodeURIComponent(known.planId)}`);
    if (plan.status !== 'ACTIVE') {
      // Switched off in PayPal's dashboard: on again (existing subscriptions carry their own prices either way).
      await client.request('POST', `/v1/billing/plans/${encodeURIComponent(known.planId)}/activate`, { repeatable: true });
    }
    await billingPlans.updateOne({ _id }, { $set: { status: 'ACTIVE', checkedAt: now } });
    return known.planId;
  }
  const sibling = await billingPlans.findOne({ provider: PROVIDER, environment: client.environment });
  const productId =
    sibling?.productId ??
    (
      await client.request<{ id: string }>('POST', '/v1/catalogs/products', {
        body: { name: 'Studio Companion Pro', description: 'Studio Companion Pro, billed monthly.', type: 'SERVICE' },
        requestId: `studio-pro-product-${client.environment}`,
      })
    ).id;
  const plan = await client.request<{ id: string; status?: string }>('POST', '/v1/billing/plans', {
    body: {
      product_id: productId,
      name: `Studio Companion Pro, monthly (${currency})`,
      description: 'Renews every month until cancelled. Each subscription keeps the price agreed at checkout.',
      status: 'ACTIVE',
      billing_cycles: [
        {
          frequency: { interval_unit: 'MONTH', interval_count: 1 },
          tenure_type: 'REGULAR',
          sequence: 1,
          total_cycles: 0,
          pricing_scheme: { fixed_price: { value: minorToValue(defaultAmountMinor), currency_code: currency } },
        },
      ],
      // A renewal that still fails after PayPal's retries suspends the subscription; nothing unpaid is added to later charges.
      payment_preferences: { auto_bill_outstanding: false, setup_fee_failure_action: 'CANCEL', payment_failure_threshold: 1 },
    },
    requestId: `studio-pro-plan-${client.environment}-${currency}`,
    representation: true,
  });
  await billingPlans.updateOne(
    { _id },
    { $setOnInsert: { provider: PROVIDER, environment: client.environment, currency, productId, planId: plan.id, status: plan.status ?? 'ACTIVE', createdAt: now, checkedAt: now } },
    { upsert: true },
  );
  return plan.id;
}

// ─── Checkout ───

export type CheckoutRefusal =
  | QuoteRefusal
  | 'account_unavailable'
  | 'email_not_verified'
  | 'not_open'
  | 'already_subscribed'
  | 'paid_until'
  | 'price_changed'
  | 'consent_required'
  | 'paypal_unavailable'
  | 'paypal_refused';

interface Eligible {
  ok: true;
  user: { _id: ObjectId; email: string; role?: unknown; currency?: unknown };
}

/** Whether this account may start a subscription now. */
export async function checkoutEligibility(db: Db, userId: ObjectId, now = new Date()): Promise<Eligible | { ok: false; reason: CheckoutRefusal; until?: Date }> {
  const { users, subscriptions } = collections(db);
  const user = await users.findOne({ _id: userId }, { projection: { email: 1, role: 1, status: 1, emailVerified: 1, username: 1, currency: 1 } });
  if (!user || (user.status ?? 'active') !== 'active') return { ok: false, reason: 'account_unavailable' };
  // PayPal sends receipts to the PayPal account; ours go to a confirmed address. Username test accounts have none.
  if (!user.emailVerified || user.username) return { ok: false, reason: 'email_not_verified' };
  const access = await billingAccess(db);
  if (!access.openToEveryone && user.role !== 'admin' && !access.testerEmails.includes(user.email.toLowerCase())) return { ok: false, reason: 'not_open' };
  const live = await subscriptions.find({ userId, status: { $in: ['active', 'trialing', 'past_due', 'canceled'] } }, { projection: { planId: 1, status: 1, currentPeriodEnd: 1 } }).toArray();
  const paying = live.find((s) => s.status !== 'canceled' && subscriptionGrantsPlan(s, now));
  if (paying) return { ok: false, reason: 'already_subscribed' };
  // A stopped subscription still paid up: a new one now would charge twice for the same days.
  const paidUp = live.filter((s) => s.status === 'canceled' && subscriptionGrantsPlan(s, now)).sort((a, b) => b.currentPeriodEnd!.getTime() - a.currentPeriodEnd!.getTime())[0];
  if (paidUp) return { ok: false, reason: 'paid_until', until: paidUp.currentPeriodEnd! };
  return { ok: true, user };
}

const PAYPAL_HOST = /(^|\.)paypal\.com$/;

/** The page PayPal gave for approving, if it is PayPal's. */
function approveLink(links: PayPalLink[] | undefined): string | null {
  const href = links?.find((l) => l.rel === 'approve')?.href;
  if (!href) return null;
  try {
    const url = new URL(href);
    return url.protocol === 'https:' && PAYPAL_HOST.test(url.hostname) ? url.toString() : null;
  } catch {
    return null;
  }
}

/** The price PayPal holds for a subscription (the override), when it says. */
function heldPrice(remote: PayPalSubscription): { amountMinor: number; currency: string } | null {
  const fixed = remote.plan?.billing_cycles?.find((c) => (c.sequence ?? 1) === 1)?.pricing_scheme?.fixed_price;
  const amountMinor = moneyToMinor(fixed?.value);
  return amountMinor !== null && fixed?.currency_code ? { amountMinor, currency: fixed.currency_code } : null;
}

export interface CheckoutInput {
  userId: ObjectId;
  /** What the page showed, which the customer agreed to. */
  shown: { amountMinor: number; currency: Currency; rateDate: string | null };
  consent: boolean;
  /** This site's address, for PayPal's return and cancel links. */
  baseUrl: string;
}

export type CheckoutResult = { ok: true; approveUrl: string; sessionId: string } | { ok: false; reason: CheckoutRefusal; quote?: Quote; until?: Date };

/**
 * Start a PayPal subscription for exactly the offer the customer saw and
 * agreed to, and return PayPal's approval page. A repeated click within the
 * offer's 30 minutes returns the same PayPal subscription rather than a new
 * one. The price PayPal holds is checked before anyone is sent there.
 */
export async function startCheckout(db: Db, client: PayPalClient, input: CheckoutInput, now = new Date(), fetchImpl?: typeof fetch): Promise<CheckoutResult> {
  const { checkoutSessions } = collections(db);
  const eligible = await checkoutEligibility(db, input.userId, now);
  if (eligible.ok === false) return { ok: false, reason: eligible.reason, until: eligible.until };
  const priced = await quoteFor(db, input.shown.currency, now, fetchImpl);
  if (priced.ok === false) return { ok: false, reason: priced.reason };
  const quote = priced.quote;
  if (quote.amountMinor !== input.shown.amountMinor || quote.currency !== input.shown.currency || (quote.fx?.rateDate ?? null) !== input.shown.rateDate) {
    return { ok: false, reason: 'price_changed', quote };
  }
  if (!input.consent) return { ok: false, reason: 'consent_required', quote };

  // The same offer clicked again: the PayPal subscription already made for it.
  const reuse = await checkoutSessions.findOne({
    userId: input.userId,
    provider: PROVIDER,
    status: 'open',
    expiresAt: { $gt: now },
    amountMinor: quote.amountMinor,
    currency: quote.currency,
    approveUrl: { $type: 'string' },
  });
  if (reuse?.approveUrl) return { ok: true, approveUrl: reuse.approveUrl, sessionId: reuse._id };

  let planId: string;
  try {
    planId = await ensurePlan(db, client, quote.currency, quote.amountMinor, now);
  } catch (error) {
    log.error('billing.plan_unavailable', { currency: quote.currency, error: error instanceof Error ? error.message : 'unknown' });
    return { ok: false, reason: error instanceof PayPalUnavailable ? 'paypal_unavailable' : 'paypal_refused' };
  }

  const session: CheckoutSessionDoc = {
    _id: `cs_${randomBytes(18).toString('base64url')}`,
    userId: input.userId,
    provider: PROVIDER,
    priceId: quote.base.priceId,
    couponCode: null,
    status: 'open',
    createdAt: now,
    expiresAt: new Date(now.getTime() + CHECKOUT_LOCK_MS),
    completedAt: null,
    environment: client.environment,
    providerPlanId: planId,
    currency: quote.currency,
    amountMinor: quote.amountMinor,
    basePriceMinor: quote.base.amountMinor,
    priceVersion: quote.base.version,
    fx: quote.fx,
    consentAt: now,
  };
  await checkoutSessions.insertOne(session);

  const base = input.baseUrl.replace(/\/+$/, '');
  let remote: PayPalSubscription;
  try {
    remote = await client.request<PayPalSubscription>('POST', '/v1/billing/subscriptions', {
      body: {
        plan_id: planId,
        custom_id: session._id,
        // The agreed price, held by this subscription alone: later prices and rates never change it.
        plan: { billing_cycles: [{ sequence: 1, total_cycles: 0, pricing_scheme: { fixed_price: { value: minorToValue(quote.amountMinor), currency_code: quote.currency } } }] },
        application_context: {
          brand_name: 'Studio Companion',
          shipping_preference: 'NO_SHIPPING',
          user_action: 'SUBSCRIBE_NOW',
          return_url: `${base}/subscribe/return?checkout=${session._id}`,
          cancel_url: `${base}/subscribe/return?checkout=${session._id}&cancelled=1`,
        },
      },
      requestId: session._id,
      representation: true,
    });
  } catch (error) {
    await checkoutSessions.updateOne({ _id: session._id }, { $set: { status: 'cancelled' } });
    log.error('billing.checkout_failed', { error: error instanceof Error ? error.message : 'unknown' });
    return { ok: false, reason: error instanceof PayPalUnavailable ? 'paypal_unavailable' : 'paypal_refused' };
  }

  // Before sending anyone to PayPal: it must hold exactly the agreed price.
  let held = heldPrice(remote);
  if (!held) {
    try {
      held = heldPrice(await client.request<PayPalSubscription>('GET', `/v1/billing/subscriptions/${encodeURIComponent(remote.id)}`, { query: { fields: 'plan' } }));
    } catch {
      held = null;
    }
  }
  const approveUrl = approveLink(remote.links);
  if (!held || held.amountMinor !== quote.amountMinor || held.currency !== quote.currency || !approveUrl) {
    await checkoutSessions.updateOne({ _id: session._id }, { $set: { status: 'cancelled', providerSubscriptionId: remote.id } });
    log.error('billing.checkout_price_not_held', { subscription: remote.id, held: held ? `${held.amountMinor} ${held.currency}` : null });
    await recordAudit(db, { type: 'billing.flagged', userId: input.userId, actor: 'system', metadata: { flag: 'price_not_held', subscription: remote.id } });
    return { ok: false, reason: 'paypal_refused' };
  }
  await checkoutSessions.updateOne({ _id: session._id }, { $set: { providerSubscriptionId: remote.id, approveUrl } });
  await recordAudit(db, {
    type: 'billing.checkout_started',
    userId: input.userId,
    actor: `user:${input.userId.toHexString()}`,
    metadata: { provider: PROVIDER, environment: client.environment, currency: quote.currency, amountMinor: quote.amountMinor, rateDate: quote.fx?.rateDate ?? null },
  });
  return { ok: true, approveUrl, sessionId: session._id };
}

// ─── Reading a subscription's state from PayPal ───

export type SyncOutcome = 'active' | 'pending' | 'past_due' | 'canceled' | 'ended' | 'unknown';

export interface SyncResult {
  outcome: SyncOutcome;
  userId: ObjectId | null;
  paidThrough: Date | null;
  providerStatus: string | null;
  /** Set when something needs an administrator (a duplicate, a price PayPal did not keep). */
  flag: string | null;
}

const unknown = (providerStatus: string | null = null): SyncResult => ({ outcome: 'unknown', userId: null, paidThrough: null, providerStatus, flag: null });

/** Payments of a subscription since `since`, as PayPal lists them. */
async function transactionsOf(client: PayPalClient, id: string, since: Date, now: Date): Promise<PayPalTransaction[]> {
  // Best effort: the subscription's own last-payment data is enough to decide access, so an
  // unexpected answer here (PayPal does not document range limits) never blocks it.
  try {
    const answer = await client.request<{ transactions?: PayPalTransaction[] }>('GET', `/v1/billing/subscriptions/${encodeURIComponent(id)}/transactions`, {
      query: { start_time: since.toISOString(), end_time: new Date(now.getTime() + 60 * 60 * 1000).toISOString() },
    });
    return answer?.transactions ?? [];
  } catch (error) {
    log.warn('billing.transactions_unavailable', { subscription: id, error: error instanceof Error ? error.message : 'unknown' });
    return [];
  }
}

/** Cancel at PayPal; true when PayPal now reports it cancelled (also when it already was). */
async function cancelAtPayPal(client: PayPalClient, id: string, reason: string): Promise<boolean> {
  try {
    await client.request('POST', `/v1/billing/subscriptions/${encodeURIComponent(id)}/cancel`, { body: { reason } });
  } catch (error) {
    if (!(error instanceof PayPalError && error.status === 422)) throw error;
  }
  const after = await client.request<PayPalSubscription>('GET', `/v1/billing/subscriptions/${encodeURIComponent(id)}`);
  return after.status === 'CANCELLED';
}

/**
 * Bring our copy of one subscription up to date with what PayPal reports now,
 * and record its payments. Only subscriptions this server created (known by
 * their checkout or an existing record) are applied; anything else is logged
 * for an administrator and grants nothing.
 */
export async function syncSubscription(db: Db, client: PayPalClient, providerSubscriptionId: string, options: { now?: Date; actor: string }): Promise<SyncResult> {
  const now = options.now ?? new Date();
  const c = collections(db);
  const id = providerSubscriptionId;
  const remote = await client.request<PayPalSubscription>('GET', `/v1/billing/subscriptions/${encodeURIComponent(id)}`, { query: { fields: 'plan' } });
  const status = remote.status ?? null;

  const [existing, session] = await Promise.all([
    c.subscriptions.findOne({ provider: PROVIDER, providerSubscriptionId: id }),
    c.checkoutSessions.findOne({ provider: PROVIDER, providerSubscriptionId: id }),
  ]);
  const userId = existing?.userId ?? session?.userId ?? null;
  if (!userId || (session && remote.custom_id && remote.custom_id !== session._id)) {
    log.error('billing.unknown_subscription', { subscription: id, status });
    return unknown(status);
  }
  const agreed = existing?.amountMinor != null && existing.currency ? { amountMinor: existing.amountMinor, currency: existing.currency } : { amountMinor: session?.amountMinor ?? null, currency: session?.currency ?? null };
  if (agreed.amountMinor === null || !agreed.currency) {
    log.error('billing.subscription_without_offer', { subscription: id });
    return unknown(status);
  }

  // Payments: each recorded once, by PayPal's id.
  const created = dateOf(remote.create_time) ?? existing?.createdAt ?? now;
  const since = new Date(Math.max(created.getTime() - 60 * 60 * 1000, now.getTime() - 29 * DAY_MS));
  const transactions = status === 'APPROVAL_PENDING' || status === 'APPROVED' || !status ? [] : await transactionsOf(client, id, since, now);
  for (const t of transactions) {
    const amountMinor = moneyToMinor(t.amount_with_breakdown?.gross_amount?.value);
    const currency = t.amount_with_breakdown?.gross_amount?.currency_code;
    const at = dateOf(t.time);
    const paid = ['COMPLETED', 'PARTIALLY_REFUNDED', 'REFUNDED'].includes(t.status ?? '');
    const failed = ['DECLINED', 'FAILED'].includes(t.status ?? '');
    if (!t.id || amountMinor === null || !currency || !at || (!paid && !failed)) continue;
    try {
      await c.payments.insertOne({
        provider: PROVIDER,
        providerPaymentId: t.id,
        userId,
        providerSubscriptionId: id,
        kind: 'charge',
        status: paid ? 'succeeded' : 'failed',
        amountMinor,
        currency,
        occurredAt: at,
        receiptUrl: null,
        createdAt: now,
      });
      await recordAudit(db, { type: 'billing.payment', userId, actor: options.actor, metadata: { kind: 'charge', status: paid ? 'succeeded' : 'failed', amountMinor, currency } });
    } catch (error) {
      if (!isDuplicateKeyError(error)) throw error;
    }
  }

  // Paid through: the end of the period the latest verified payment covers. Never shortened here.
  const lastPaid = remote.billing_info?.last_payment;
  const lastPaidMinor = moneyToMinor(lastPaid?.amount?.value);
  const completedTimes = transactions.filter((t) => t.status === 'COMPLETED' || t.status === 'PARTIALLY_REFUNDED' || t.status === 'REFUNDED').map((t) => dateOf(t.time));
  const lastPaymentAt = latest(lastPaidMinor !== null ? dateOf(lastPaid?.time) : null, ...completedTimes, existing?.lastPaymentAt ?? null);
  const next = dateOf(remote.billing_info?.next_billing_time);
  let paidThrough = existing?.paidThrough ?? null;
  if (lastPaymentAt) {
    const monthLater = addMonth(lastPaymentAt);
    const covered = next && next > lastPaymentAt && next.getTime() <= monthLater.getTime() + 3 * DAY_MS ? next : monthLater;
    if (!paidThrough || covered > paidThrough) paidThrough = covered;
  }
  // A refund or chargeback ended the paid time: only a payment made after that brings it back.
  const endedAt = existing?.accessEndedAt ?? null;
  if (endedAt && paidThrough && paidThrough > endedAt && !(lastPaymentAt && lastPaymentAt > endedAt)) paidThrough = endedAt;

  let flag: string | null = existing?.flag ?? null;
  let providerStatus = status;
  // PayPal charged something other than what was agreed: stop it, keep what was paid for, and flag it.
  if (status === 'ACTIVE' && lastPaid && (lastPaidMinor !== agreed.amountMinor || lastPaid.amount?.currency_code !== agreed.currency)) {
    flag = 'price_mismatch';
    if (await cancelAtPayPal(client, id, 'The amount charged differs from the price agreed at checkout')) providerStatus = 'CANCELLED';
    log.error('billing.price_mismatch', { subscription: id });
    await recordAudit(db, { type: 'billing.flagged', userId, actor: options.actor, metadata: { flag, subscription: id } });
  }

  let ours: SubscriptionStatus;
  switch (providerStatus) {
    case 'ACTIVE':
      ours = paidThrough ? 'active' : 'incomplete';
      break;
    case 'SUSPENDED':
      ours = 'past_due';
      break;
    case 'CANCELLED':
      ours = 'canceled';
      break;
    case 'EXPIRED':
      ours = 'expired';
      break;
    default:
      ours = 'incomplete';
  }

  // A second paid subscription for the same account (e.g. an old approval link): stopped at once and flagged for a refund.
  if (ours === 'active' && existing?.status !== 'active') {
    const others = await c.subscriptions.find({ userId, providerSubscriptionId: { $ne: id }, status: { $in: ['active', 'past_due', 'canceled'] } }, { projection: { planId: 1, status: 1, currentPeriodEnd: 1 } }).toArray();
    if (others.some((o) => subscriptionGrantsPlan(o, now))) {
      flag = 'duplicate';
      if (await cancelAtPayPal(client, id, 'Duplicate subscription for the same account')) {
        providerStatus = 'CANCELLED';
        ours = 'canceled';
      }
      log.error('billing.duplicate_subscription', { subscription: id });
      await recordAudit(db, { type: 'billing.flagged', userId, actor: options.actor, metadata: { flag, subscription: id } });
    }
  }

  // Nothing to record yet: approval or the first payment is still pending (and nothing was ever recorded).
  if (ours === 'incomplete' && !existing) return { outcome: 'pending', userId, paidThrough: null, providerStatus, flag };

  const version = latest(dateOf(remote.status_update_time), dateOf(remote.update_time), dateOf(lastPaid?.time), created) ?? now;
  const set: Partial<SubscriptionDoc> = {
    userId,
    planId: 'pro',
    providerCustomerId: remote.subscriber?.payer_id ?? existing?.providerCustomerId ?? null,
    status: ours,
    providerStatus,
    providerPlanId: remote.plan_id ?? session?.providerPlanId ?? existing?.providerPlanId ?? null,
    environment: client.environment,
    currentPeriodStart: lastPaymentAt,
    currentPeriodEnd: paidThrough,
    paidThrough,
    nextBillingAt: providerStatus === 'ACTIVE' ? next : null,
    lastPaymentAt,
    failedPayments: remote.billing_info?.failed_payments_count ?? 0,
    // "Renewal stopped, Pro until…": the account and admin pages read it this way.
    cancelAtPeriodEnd: ours === 'canceled' && paidThrough !== null && paidThrough > now,
    canceledAt: ours === 'canceled' ? (existing?.canceledAt ?? dateOf(remote.status_update_time) ?? now) : null,
    endedAt: ours === 'expired' ? (existing?.endedAt ?? dateOf(remote.status_update_time) ?? now) : null,
    priceId: existing?.priceId ?? session?.priceId ?? null,
    interval: 'month',
    currency: agreed.currency,
    amountMinor: agreed.amountMinor,
    basePriceMinor: existing?.basePriceMinor ?? session?.basePriceMinor ?? null,
    priceVersion: existing?.priceVersion ?? session?.priceVersion ?? null,
    fx: existing?.fx ?? session?.fx ?? null,
    consent: existing?.consent ?? (session?.consentAt ? { at: session.consentAt, amountMinor: agreed.amountMinor, currency: agreed.currency, interval: 'month', terms: TERMS_VERSION } : null),
    checkoutSessionId: existing?.checkoutSessionId ?? session?._id ?? null,
    trialEndsAt: null,
    couponCode: null,
    flag,
    lastEventAt: version,
    updatedAt: now,
  };
  const filter = { provider: PROVIDER, providerSubscriptionId: id, $or: [{ lastEventAt: null }, { lastEventAt: { $lte: version } }] };
  const update = { $set: set, $setOnInsert: { provider: PROVIDER, providerSubscriptionId: id, createdAt: now } };
  const written =
    (await c.subscriptions.updateOne(filter, update, { upsert: true }).catch((error) => {
      if (isDuplicateKeyError(error)) return null;
      throw error;
    })) ?? (await c.subscriptions.updateOne(filter, update));
  if (written.matchedCount === 0 && written.upsertedCount === 0) {
    // A newer state was applied meanwhile (another delivery read PayPal after us): keep it.
    const current = await c.subscriptions.findOne({ provider: PROVIDER, providerSubscriptionId: id });
    return { outcome: outcomeOf(current?.status ?? ours), userId, paidThrough: current?.paidThrough ?? null, providerStatus: current?.providerStatus ?? providerStatus, flag: current?.flag ?? flag };
  }

  if (session && session.status === 'open' && ours !== 'incomplete') await c.checkoutSessions.updateOne({ _id: session._id, status: 'open' }, { $set: { status: 'completed', completedAt: now } });
  if (set.providerCustomerId) {
    await c.billingCustomers
      .updateOne({ provider: PROVIDER, userId }, { $set: { providerCustomerId: set.providerCustomerId }, $setOnInsert: { createdAt: now } }, { upsert: true })
      .catch((error) => {
        if (!isDuplicateKeyError(error)) throw error;
      });
  }
  const changed = existing?.status !== ours || existing?.paidThrough?.getTime() !== paidThrough?.getTime() || existing?.providerStatus !== providerStatus;
  if (changed) {
    await recordAudit(db, {
      type: 'subscription.changed',
      userId,
      actor: options.actor,
      metadata: { provider: PROVIDER, status: ours, providerStatus, paidThrough: paidThrough?.toISOString() ?? null },
    });
  }
  if (ours === 'active') await trackEvent(db, { name: 'subscription_converted', userId, dedupeKey: `subscription_converted:${userId.toHexString()}` });
  return { outcome: outcomeOf(ours), userId, paidThrough, providerStatus, flag };
}

function outcomeOf(status: SubscriptionStatus): SyncOutcome {
  switch (status) {
    case 'active':
    case 'trialing':
      return 'active';
    case 'past_due':
      return 'past_due';
    case 'canceled':
      return 'canceled';
    case 'expired':
      return 'ended';
    default:
      return 'pending';
  }
}

/** What the return page may show about a checkout: only to the account that started it, read from PayPal. */
export async function checkoutState(db: Db, client: PayPalClient | null, sessionId: string, userId: ObjectId, now = new Date()) {
  const session = await collections(db).checkoutSessions.findOne({ _id: sessionId, userId, provider: PROVIDER });
  if (!session) return { state: 'not_found' as const };
  if (session.status === 'cancelled') return { state: 'cancelled' as const };
  if (session.providerSubscriptionId && client) {
    try {
      const result = await syncSubscription(db, client, session.providerSubscriptionId, { now, actor: `user:${userId.toHexString()}` });
      if (result.outcome === 'active') return { state: 'active' as const, paidThrough: result.paidThrough };
      if (result.outcome === 'canceled' && result.flag === 'duplicate') return { state: 'duplicate' as const };
      if (result.outcome === 'past_due') return { state: 'payment_issue' as const };
      if (result.outcome === 'canceled' || result.outcome === 'ended') return { state: 'ended' as const };
    } catch (error) {
      log.warn('billing.checkout_state_unavailable', { error: error instanceof Error ? error.message : 'unknown' });
      return { state: 'pending' as const };
    }
  }
  if (session.expiresAt.getTime() + 3 * 60 * 60 * 1000 < now.getTime()) return { state: 'expired' as const };
  return { state: 'pending' as const };
}

/** Mark a checkout the customer turned back from at PayPal: nothing was charged. */
export async function cancelCheckout(db: Db, sessionId: string, userId: ObjectId): Promise<void> {
  await collections(db).checkoutSessions.updateOne({ _id: sessionId, userId, provider: PROVIDER, status: 'open' }, { $set: { status: 'cancelled' } });
}

// ─── Stopping renewal ───

export type StopResult = { ok: true; paidThrough: Date | null } | { ok: false; reason: 'none' | 'paypal_unavailable' | 'failed' };

/** Cancel the account's renewing PayPal subscription now: no further charge, Pro until the paid-through date. */
export async function stopRenewal(db: Db, client: PayPalClient, userId: ObjectId, actor: string, now = new Date()): Promise<StopResult> {
  const sub = await collections(db).subscriptions.findOne(
    { userId, provider: PROVIDER, environment: client.environment, providerStatus: { $in: ['ACTIVE', 'SUSPENDED'] } },
    { sort: { updatedAt: -1 } },
  );
  if (!sub?.providerSubscriptionId) return { ok: false, reason: 'none' };
  await recordAudit(db, { type: 'billing.cancel_requested', userId, actor, metadata: { provider: PROVIDER, subscription: sub.providerSubscriptionId } });
  try {
    // First the latest payments, so the paid-through date is complete, then the cancellation.
    await syncSubscription(db, client, sub.providerSubscriptionId, { now, actor });
    const cancelled = await cancelAtPayPal(client, sub.providerSubscriptionId, 'Renewal stopped by the customer in Studio Companion');
    const after = await syncSubscription(db, client, sub.providerSubscriptionId, { now, actor });
    if (!cancelled || after.providerStatus !== 'CANCELLED') return { ok: false, reason: 'failed' };
    await recordAudit(db, { type: 'billing.cancelled', userId, actor, metadata: { provider: PROVIDER, paidThrough: after.paidThrough?.toISOString() ?? null } });
    return { ok: true, paidThrough: after.paidThrough };
  } catch (error) {
    log.error('billing.stop_renewal_failed', { error: error instanceof Error ? error.message : 'unknown' });
    return { ok: false, reason: error instanceof PayPalUnavailable ? 'paypal_unavailable' : 'failed' };
  }
}

// ─── Refunds, chargebacks and disputes reported by PayPal ───

async function endPaidAccess(db: Db, providerSubscriptionId: string, now: Date, actor: string, flag: string | null) {
  const { subscriptions } = collections(db);
  const sub = await subscriptions.findOne({ provider: PROVIDER, providerSubscriptionId });
  if (!sub) return;
  const paidThrough = sub.paidThrough && sub.paidThrough < now ? sub.paidThrough : now;
  await subscriptions.updateOne(
    { _id: sub._id },
    { $set: { paidThrough, currentPeriodEnd: paidThrough, accessEndedAt: now, cancelAtPeriodEnd: false, updatedAt: now, ...(flag ? { flag } : {}) } },
  );
  await recordAudit(db, { type: 'subscription.changed', userId: sub.userId, actor, metadata: { provider: PROVIDER, status: sub.status, paidThrough: paidThrough.toISOString(), reason: flag ?? 'refund' } });
}

/**
 * Apply a verified PayPal event. Subscription and payment events re-read the
 * subscription from PayPal; refunds and chargebacks are recorded against the
 * payment they return, and end the paid time of the period it bought (a
 * partial refund only when renewal has already stopped). Disputes are flagged
 * for the owner, who answers them in PayPal.
 */
export async function applyEvent(db: Db, client: PayPalClient, event: PayPalWebhookEvent, now = new Date()): Promise<'processed' | 'ignored'> {
  const c = collections(db);
  const actor = `webhook:${PROVIDER}`;
  const type = event.eventType;
  if ((type.startsWith('BILLING.SUBSCRIPTION.') || ['PAYMENT.SALE.COMPLETED', 'PAYMENT.SALE.DENIED', 'PAYMENT.SALE.PENDING'].includes(type)) && event.subscriptionId) {
    const result = await syncSubscription(db, client, event.subscriptionId, { now, actor });
    return result.outcome === 'unknown' ? 'ignored' : 'processed';
  }
  if (type === 'PAYMENT.SALE.REFUNDED' || type === 'PAYMENT.SALE.REVERSED') {
    const saleId = type === 'PAYMENT.SALE.REFUNDED' ? event.saleId : event.resourceId;
    const sale = saleId ? await c.payments.findOne({ provider: PROVIDER, providerPaymentId: saleId, kind: 'charge' }) : null;
    const amountMinor = moneyToMinor(event.amount?.value) ?? sale?.amountMinor ?? null;
    if (!sale || amountMinor === null || !event.resourceId) {
      log.warn('billing.refund_for_unknown_payment', { event: event.id, type });
      return 'ignored';
    }
    const kind = type === 'PAYMENT.SALE.REFUNDED' ? 'refund' : 'chargeback';
    try {
      await c.payments.insertOne({
        provider: PROVIDER,
        providerPaymentId: kind === 'refund' ? event.resourceId : `${saleId}:reversal`,
        userId: sale.userId,
        providerSubscriptionId: sale.providerSubscriptionId,
        kind,
        status: 'succeeded',
        amountMinor,
        currency: event.amount?.currency ?? sale.currency,
        occurredAt: event.createTime ?? now,
        receiptUrl: null,
        createdAt: now,
        refundOf: saleId,
      });
      await recordAudit(db, { type: 'billing.payment', userId: sale.userId, actor, metadata: { kind, status: 'succeeded', amountMinor, currency: sale.currency } });
    } catch (error) {
      if (!isDuplicateKeyError(error)) throw error;
      return 'processed';
    }
    if (sale.providerSubscriptionId) {
      const sub = await c.subscriptions.findOne({ provider: PROVIDER, providerSubscriptionId: sale.providerSubscriptionId });
      const latestPayment = !sub?.lastPaymentAt || sale.occurredAt.getTime() >= sub.lastPaymentAt.getTime() - 60_000;
      const returned = (await c.payments.find({ provider: PROVIDER, refundOf: saleId }).toArray()).reduce((sum, p) => sum + p.amountMinor, 0);
      const whole = kind === 'chargeback' || returned >= sale.amountMinor;
      // The money for the current period went back: that period ends now. A partial refund of a
      // renewing subscription (a goodwill gesture) changes nothing; of a stopped one, it ends it too.
      if (sub && latestPayment && (whole || sub.status === 'canceled')) {
        await endPaidAccess(db, sale.providerSubscriptionId, now, actor, kind === 'chargeback' ? 'chargeback' : null);
        // Charging again next month for a period refunded in full would make no sense: renewal stops too.
        if (whole && (sub.providerStatus === 'ACTIVE' || sub.providerStatus === 'SUSPENDED')) {
          await cancelAtPayPal(client, sale.providerSubscriptionId, kind === 'chargeback' ? 'Payment reversed' : 'Payment refunded');
          await syncSubscription(db, client, sale.providerSubscriptionId, { now, actor });
        }
      }
    }
    if (kind === 'refund') {
      await c.refundRequests.updateMany({ userId: sale.userId, status: 'open' }, { $set: { status: 'refunded', decidedAt: now, decidedBy: 'paypal', note: 'Refund recorded from PayPal.' } });
    } else {
      await recordAudit(db, { type: 'billing.flagged', userId: sale.userId, actor, metadata: { flag: 'chargeback', payment: saleId } });
    }
    return 'processed';
  }
  if (type.startsWith('CUSTOMER.DISPUTE.')) {
    await recordAudit(db, { type: 'billing.flagged', actor, metadata: { flag: 'dispute', event: type, dispute: event.resourceId } });
    return 'processed';
  }
  return 'ignored';
}

// ─── Each delivery once ───

/**
 * Claim a verified event before applying it: a repeated delivery is answered
 * as a duplicate, but one whose processing failed (or stalled for over five
 * minutes) may be processed again when PayPal delivers it again.
 */
export async function claimEvent(db: Db, event: PayPalWebhookEvent, now = new Date()): Promise<'claimed' | 'duplicate'> {
  const { paymentEvents } = collections(db);
  try {
    await paymentEvents.insertOne({ provider: PROVIDER, eventId: event.id, type: event.eventType, status: 'processing', receivedAt: now, processedAt: null, error: null });
    return 'claimed';
  } catch (error) {
    if (!isDuplicateKeyError(error)) throw error;
  }
  const retry = await paymentEvents.updateOne(
    { provider: PROVIDER, eventId: event.id, $or: [{ status: 'failed' }, { status: 'processing', receivedAt: { $lt: new Date(now.getTime() - 5 * 60_000) } }] },
    { $set: { status: 'processing', receivedAt: now, error: null } },
  );
  return retry.modifiedCount === 1 ? 'claimed' : 'duplicate';
}

export async function finishEvent(db: Db, eventId: string, status: 'processed' | 'ignored' | 'failed', error: string | null = null): Promise<void> {
  await collections(db).paymentEvents.updateOne({ provider: PROVIDER, eventId }, { $set: { status, processedAt: new Date(), error: error?.slice(0, 300) ?? null } });
}

// ─── Reconciliation ───

/**
 * Re-read from PayPal every subscription that could still change: live ones,
 * stopped ones still paid up, recent ones, and checkouts of the last three
 * days that have a PayPal subscription. Run hourly by cron and from the admin
 * dashboard; webhooks can be missed, this cannot.
 */
export async function reconcilePayPal(db: Db, client: PayPalClient, actor: string, now = new Date(), fetchImpl?: typeof fetch): Promise<ReconciliationRunDoc> {
  const c = collections(db);
  const run: ReconciliationRunDoc = { provider: PROVIDER, startedAt: now, finishedAt: null, checked: 0, fixed: [], missing: [], actor };
  const recent = new Date(now.getTime() - 3 * DAY_MS);
  const subs = await c.subscriptions
    .find({
      provider: PROVIDER,
      environment: client.environment,
      providerSubscriptionId: { $type: 'string' },
      $or: [{ status: { $in: ['active', 'past_due', 'incomplete', 'trialing'] } }, { status: 'canceled', paidThrough: { $gt: new Date(now.getTime() - 2 * DAY_MS) } }, { updatedAt: { $gte: recent } }],
    })
    .toArray();
  // Checkouts with a PayPal subscription: open ones, and lapsed ones of the last two weeks (an
  // approval can still arrive late, and its webhook can be missed too).
  const checkouts = await c.checkoutSessions
    .find({
      provider: PROVIDER,
      environment: client.environment,
      providerSubscriptionId: { $type: 'string' },
      $or: [{ status: 'open', createdAt: { $gte: new Date(now.getTime() - 7 * DAY_MS) } }, { status: 'expired', createdAt: { $gte: new Date(now.getTime() - 14 * DAY_MS) } }],
    })
    .toArray();
  const ids = new Set<string>([...subs.map((s) => s.providerSubscriptionId!), ...checkouts.map((s) => s.providerSubscriptionId!)]);
  const before = new Map(subs.map((s) => [s.providerSubscriptionId!, s]));
  for (const id of ids) {
    run.checked += 1;
    try {
      const result = await syncSubscription(db, client, id, { now, actor });
      const was = before.get(id);
      if (was && (was.status !== outcomeStatus(result) || was.paidThrough?.getTime() !== result.paidThrough?.getTime())) {
        run.fixed.push({ providerSubscriptionId: id, field: 'status,paidThrough', ours: `${was.status} ${was.paidThrough?.toISOString() ?? '-'}`, theirs: `${result.providerStatus} ${result.paidThrough?.toISOString() ?? '-'}` });
      }
    } catch (error) {
      if (error instanceof PayPalError && error.status === 404) run.missing.push(id);
      else log.warn('billing.reconcile_failed', { subscription: id, error: error instanceof Error ? error.message : 'unknown' });
    }
  }
  // Offers nobody took within a day: closed (an approval that still arrives is picked up by its webhook).
  await c.checkoutSessions.updateMany({ provider: PROVIDER, status: 'open', expiresAt: { $lt: new Date(now.getTime() - DAY_MS) } }, { $set: { status: 'expired' } });
  try {
    await refreshRates(db, now, fetchImpl);
  } catch (error) {
    log.warn('fx.refresh_failed', { error: error instanceof Error ? error.message : 'unknown' });
  }
  run.finishedAt = new Date();
  await c.reconciliationRuns.insertOne(run);
  if (run.fixed.length) await recordAudit(db, { type: 'billing.reconciled', actor, metadata: { provider: PROVIDER, checked: run.checked, fixed: run.fixed.length } });
  return run;
}

const STATUS_OF: Record<SyncOutcome, SubscriptionStatus | null> = { active: 'active', past_due: 'past_due', canceled: 'canceled', ended: 'expired', pending: 'incomplete', unknown: null };
const outcomeStatus = (result: SyncResult): SubscriptionStatus | null => STATUS_OF[result.outcome];

// ─── The webhook PayPal notifies ───

/** Register (or update) PayPal's webhook for `url` with every event we handle; returns its ID for PAYPAL_WEBHOOK_ID. */
export async function ensureWebhook(client: PayPalClient, url: string): Promise<{ id: string; created: boolean }> {
  const target = new URL(url);
  if (target.protocol !== 'https:') throw new Error('PayPal delivers webhooks only to https:// addresses');
  const eventTypes = WEBHOOK_EVENTS.map((name) => ({ name }));
  const list = await client.request<{ webhooks?: { id: string; url: string }[] }>('GET', '/v1/notifications/webhooks');
  const found = list?.webhooks?.find((w) => w.url === target.toString());
  if (found) {
    await client.request('PATCH', `/v1/notifications/webhooks/${encodeURIComponent(found.id)}`, { body: [{ op: 'replace', path: '/event_types', value: eventTypes }], repeatable: true });
    return { id: found.id, created: false };
  }
  const made = await client.request<{ id: string }>('POST', '/v1/notifications/webhooks', { body: { url: target.toString(), event_types: eventTypes } });
  return { id: made.id, created: true };
}

/** The account's currency preference as a currency this checkout supports. */
export const checkoutCurrency = (value: unknown): Currency => (isCurrency(value) ? value : 'USD');
