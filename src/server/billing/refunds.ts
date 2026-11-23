import 'server-only';
import type { Db, ObjectId } from 'mongodb';
import { recordAudit } from '@/server/audit';
import { collections, toObjectId, type RefundRequestDoc } from '@/server/db/collections';
import type { PayPalClient } from './paypal/client';
import { PROVIDER, stopRenewal } from './paypal/subscriptions';

// ─── Refund requests (docs/billing/03-paypal.md) ──────────────────────────────
// A customer can ask to cancel and be refunded, separately from simply
// stopping renewal. Asking stops renewal at once (no further charge) and
// records the request with what the policy suggests:
// - a full refund within 7 days of the first payment (once per account);
// - after that, the unused part of the period paid for.
// Statutory rights (e.g. distance-selling cancellation) are not limited by
// this. Nothing is refunded automatically: the owner decides, refunds in
// PayPal, and the refund PayPal reports ends the paid time it returns
// (src/server/billing/paypal/subscriptions.ts) and closes the request.

export const FULL_REFUND_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;

export type RefundRequestResult = { ok: true; request: RefundRequestDoc } | { ok: false; reason: 'none' | 'paypal_unavailable' | 'failed' };

export async function requestRefund(db: Db, client: PayPalClient, userId: ObjectId, reason: string | null, actor: string, now = new Date()): Promise<RefundRequestResult> {
  const c = collections(db);
  const open = await c.refundRequests.findOne({ userId, status: 'open' });
  if (open) return { ok: true, request: open };
  // The subscription whose paid period is running now.
  const sub = await c.subscriptions.findOne({ userId, provider: PROVIDER, paidThrough: { $gt: now } }, { sort: { paidThrough: -1 } });
  if (!sub?.providerSubscriptionId) return { ok: false, reason: 'none' };
  if (sub.providerStatus === 'ACTIVE' || sub.providerStatus === 'SUSPENDED') {
    const stopped = await stopRenewal(db, client, userId, actor, now);
    if (stopped.ok === false) return { ok: false, reason: stopped.reason === 'paypal_unavailable' ? 'paypal_unavailable' : 'failed' };
  }
  const charges = await c.payments.find({ userId, provider: PROVIDER, providerSubscriptionId: sub.providerSubscriptionId, kind: 'charge', status: 'succeeded' }, { sort: { occurredAt: 1 } }).toArray();
  const last = charges.at(-1);
  if (!last) return { ok: false, reason: 'none' };
  const hadFullRefund = (await c.refundRequests.countDocuments({ userId, 'suggested.kind': 'full', status: 'refunded' })) > 0;
  const full = !hadFullRefund && charges.length === 1 && now.getTime() - charges[0].occurredAt.getTime() <= FULL_REFUND_DAYS * DAY_MS;
  const periodEnd = (await c.subscriptions.findOne({ _id: sub._id }))?.paidThrough ?? sub.paidThrough!;
  const span = Math.max(1, periodEnd.getTime() - last.occurredAt.getTime());
  const unused = Math.min(1, Math.max(0, (periodEnd.getTime() - now.getTime()) / span));
  const request: RefundRequestDoc = {
    userId,
    provider: PROVIDER,
    providerSubscriptionId: sub.providerSubscriptionId,
    reason: reason?.trim().slice(0, 500) || null,
    status: 'open',
    requestedAt: now,
    suggested: { kind: full ? 'full' : 'prorated', amountMinor: full ? last.amountMinor : Math.round(last.amountMinor * unused), currency: last.currency, providerPaymentId: last.providerPaymentId },
    decidedAt: null,
    decidedBy: null,
    note: null,
  };
  const { insertedId } = await c.refundRequests.insertOne(request);
  await recordAudit(db, { type: 'billing.refund_requested', userId, actor, metadata: { kind: request.suggested.kind, amountMinor: request.suggested.amountMinor, currency: request.suggested.currency } });
  return { ok: true, request: { ...request, _id: insertedId } };
}

/** The owner's decision on a request (the refund itself is made in PayPal, which reports it back). */
export async function closeRefundRequest(db: Db, id: string, outcome: 'refunded' | 'declined', note: string | null, actor: string, now = new Date()): Promise<'closed' | 'not_found'> {
  const _id = toObjectId(id);
  if (!_id) return 'not_found';
  const request = await collections(db).refundRequests.findOneAndUpdate(
    { _id, status: 'open' },
    { $set: { status: outcome, decidedAt: now, decidedBy: actor, note: note?.trim().slice(0, 500) || null } },
    { returnDocument: 'after' },
  );
  if (!request) return 'not_found';
  await recordAudit(db, { type: 'billing.refund_closed', userId: request.userId, actor, metadata: { outcome } });
  return 'closed';
}
