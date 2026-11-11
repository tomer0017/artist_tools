import 'server-only';
import { randomBytes } from 'node:crypto';
import type { Db, ObjectId } from 'mongodb';
import { recordAudit } from '@/server/audit';
import { checkCoupon, type CouponCheck } from '@/server/coupons';
import { pricingSpec, type Price } from '@/server/config/pricing';
import { publishedDocument } from '@/server/config/versions';
import { collections, type CheckoutSessionDoc, type CouponDoc } from '@/server/db/collections';

// ─── Checkout sessions (docs/billing/02-architecture.md) ──────────────────────
// Before anyone is sent to a provider's hosted checkout, the server records
// what is being bought, by whom: a published, active price, an eligible
// coupon, a verified account in good standing without a live subscription.
// The session id travels to the provider and back in its verified webhook;
// the browser's return from checkout only shows the session's state and never
// grants anything by itself.

/** How long a started checkout may take before it lapses. */
export const CHECKOUT_TTL_MS = 60 * 60 * 1000;

export type CheckoutRefusal =
  | 'unknown_price'
  | 'account_unavailable'
  | 'email_not_verified'
  | 'already_subscribed'
  | Extract<CouponCheck, { ok: false }>['reason'];

export type OpenCheckoutResult =
  | { ok: true; session: CheckoutSessionDoc; price: Price; coupon: (CouponDoc & { _id: ObjectId }) | null }
  | { ok: false; reason: CheckoutRefusal };

export async function openCheckoutSession(
  db: Db,
  input: { userId: ObjectId; provider: string; priceId: string; couponCode?: string | null },
  now = new Date(),
): Promise<OpenCheckoutResult> {
  const { users, subscriptions, checkoutSessions } = collections(db);
  const { prices } = await publishedDocument(db, pricingSpec);
  const price = prices.find((p) => p.id === input.priceId && p.active);
  if (!price) return { ok: false, reason: 'unknown_price' };

  const user = await users.findOne({ _id: input.userId }, { projection: { status: 1, emailVerified: 1 } });
  if (!user || user.status !== 'active') return { ok: false, reason: 'account_unavailable' };
  if (!user.emailVerified) return { ok: false, reason: 'email_not_verified' };
  // Plan changes on a live subscription go through the provider (changePrice), not a second checkout.
  if (await subscriptions.countDocuments({ userId: input.userId, status: { $in: ['trialing', 'active', 'past_due'] } }, { limit: 1 })) {
    return { ok: false, reason: 'already_subscribed' };
  }

  let coupon: (CouponDoc & { _id: ObjectId }) | null = null;
  const code = input.couponCode?.trim().toUpperCase() || null;
  if (code) {
    const check = await checkCoupon(db, code, { userId: input.userId, target: `${price.planId}:${price.interval}`, currency: price.currency }, now);
    if (check.ok === false) return { ok: false, reason: check.reason };
    coupon = check.coupon;
  }

  const session: CheckoutSessionDoc = {
    _id: `cs_${randomBytes(18).toString('base64url')}`,
    userId: input.userId,
    provider: input.provider,
    priceId: price.id,
    couponCode: coupon?.code ?? null,
    status: 'open',
    createdAt: now,
    expiresAt: new Date(now.getTime() + CHECKOUT_TTL_MS),
    completedAt: null,
  };
  await checkoutSessions.insertOne(session);
  await recordAudit(db, {
    type: 'billing.checkout_started',
    userId: input.userId,
    actor: `user:${input.userId.toHexString()}`,
    metadata: { provider: input.provider, priceId: price.id, coupon: coupon?.code ?? null },
  });
  return { ok: true, session, price, coupon };
}

/**
 * What the return page may show about a checkout: only to the account that
 * started it, and only what verified events have recorded ('open' until the
 * provider confirms; an open session past its time reads as 'expired').
 */
export async function checkoutStatus(db: Db, sessionId: string, userId: ObjectId, now = new Date()) {
  const session = await collections(db).checkoutSessions.findOne({ _id: sessionId, userId });
  if (!session) return 'not_found' as const;
  if (session.status === 'open' && session.expiresAt <= now) return 'expired' as const;
  return session.status;
}
