import 'server-only';
import type { Db, ObjectId } from 'mongodb';
import { z } from 'zod';
import { CURRENCIES, type Currency } from '@/lib/locale';
import { recordAudit } from '@/server/audit';
import { collections, isDuplicateKeyError, type CouponDoc } from '@/server/db/collections';

// ─── Coupons ──────────────────────────────────────────────────────────────────
// Discount codes an admin defines now and checkout uses in Phase 4: a
// percentage or a fixed amount (minor units, one currency), the prices it
// applies to, a validity window, an overall limit and a per-person limit.
// Redemptions are recorded one per use in `coupon_redemptions` (counted from
// there, never from a counter on the coupon). Codes are never deleted, only
// switched off, so the history stays readable. Every change is audited.

export const COUPON_TARGETS = ['pro:month', 'pro:year'] as const;

export const CouponInput = z
  .object({
    code: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z0-9][A-Z0-9-]{2,31}$/, 'Use 3–32 letters, digits or dashes'),
    kind: z.enum(['percent', 'fixed']),
    percentOff: z.number().int().min(1).max(100).nullable(),
    amountOffMinor: z.number().int().min(1).max(100_000_000).nullable(),
    currency: z.enum(CURRENCIES).nullable(),
    appliesTo: z.array(z.enum(COUPON_TARGETS)).max(COUPON_TARGETS.length),
    startsAt: z.date(),
    endsAt: z.date().nullable(),
    maxRedemptions: z.number().int().min(1).max(1_000_000).nullable(),
    maxPerUser: z.number().int().min(1).max(100),
    note: z.string().trim().max(200).nullable(),
  })
  .superRefine((c, ctx) => {
    if (c.kind === 'percent' && c.percentOff === null) ctx.addIssue({ code: 'custom', path: ['percentOff'], message: 'Enter a percentage' });
    if (c.kind === 'fixed' && (c.amountOffMinor === null || c.currency === null)) ctx.addIssue({ code: 'custom', path: ['amountOffMinor'], message: 'Enter an amount and currency' });
    if (c.endsAt && c.endsAt <= c.startsAt) ctx.addIssue({ code: 'custom', path: ['endsAt'], message: 'Must be after the start' });
  });

export type CouponInputT = z.infer<typeof CouponInput>;

export async function createCoupon(db: Db, input: unknown, actor: string, now = new Date()) {
  const parsed = CouponInput.safeParse(input);
  if (!parsed.success) return { status: 'invalid' as const, issues: parsed.error.issues.map((i) => `${i.path.join('.') || 'coupon'}: ${i.message}`) };
  const c = parsed.data;
  const doc: CouponDoc = {
    code: c.code,
    kind: c.kind,
    percentOff: c.kind === 'percent' ? c.percentOff : null,
    amountOffMinor: c.kind === 'fixed' ? c.amountOffMinor : null,
    currency: c.kind === 'fixed' ? c.currency : null,
    appliesTo: [...c.appliesTo],
    startsAt: c.startsAt,
    endsAt: c.endsAt,
    maxRedemptions: c.maxRedemptions,
    maxPerUser: c.maxPerUser,
    status: 'active',
    note: c.note,
    createdBy: actor,
    createdAt: now,
    updatedAt: now,
  };
  try {
    const { insertedId } = await collections(db).coupons.insertOne(doc);
    await recordAudit(db, { type: 'admin.coupon_created', userId: null, actor, metadata: { couponId: insertedId.toHexString(), code: c.code, kind: c.kind } });
    return { status: 'created' as const, id: insertedId.toHexString() };
  } catch (error) {
    if (isDuplicateKeyError(error)) return { status: 'duplicate' as const };
    throw error;
  }
}

export async function setCouponStatus(db: Db, couponId: ObjectId, status: CouponDoc['status'], actor: string, now = new Date()) {
  const { modifiedCount } = await collections(db).coupons.updateOne({ _id: couponId, status: { $ne: status } }, { $set: { status, updatedAt: now } });
  if (modifiedCount === 0) return false;
  await recordAudit(db, { type: 'admin.coupon_status_changed', userId: null, actor, metadata: { couponId: couponId.toHexString(), status } });
  return true;
}

export async function listCoupons(db: Db) {
  const { coupons, couponRedemptions } = collections(db);
  const [list, counts] = await Promise.all([
    coupons.find({}, { sort: { createdAt: -1 }, limit: 200 }).toArray(),
    couponRedemptions.aggregate<{ _id: ObjectId; n: number }>([{ $group: { _id: '$couponId', n: { $sum: 1 } } }]).toArray(),
  ]);
  const used = new Map(counts.map((c) => [c._id.toHexString(), c.n]));
  return list.map((c) => ({ ...c, id: c._id!.toHexString(), redemptions: used.get(c._id!.toHexString()) ?? 0 }));
}

export type CouponCheck =
  | { ok: true; coupon: CouponDoc & { _id: ObjectId } }
  | { ok: false; reason: 'unknown' | 'disabled' | 'not_started' | 'expired' | 'not_eligible' | 'used_up' | 'already_used' };

/** Whether `code` can be used by `userId` for a price (`pro:month`…), right now. For checkout (Phase 4). */
export async function checkCoupon(db: Db, code: string, use: { userId: ObjectId; target: string; currency: Currency }, now = new Date()): Promise<CouponCheck> {
  const coupon = await collections(db).coupons.findOne({ code: code.trim().toUpperCase() });
  if (!coupon) return { ok: false, reason: 'unknown' };
  if (coupon.status !== 'active') return { ok: false, reason: 'disabled' };
  if (coupon.startsAt > now) return { ok: false, reason: 'not_started' };
  if (coupon.endsAt && coupon.endsAt <= now) return { ok: false, reason: 'expired' };
  if (coupon.appliesTo.length > 0 && !coupon.appliesTo.includes(use.target)) return { ok: false, reason: 'not_eligible' };
  if (coupon.kind === 'fixed' && coupon.currency !== use.currency) return { ok: false, reason: 'not_eligible' };
  const { couponRedemptions } = collections(db);
  if (coupon.maxRedemptions !== null && (await couponRedemptions.countDocuments({ couponId: coupon._id })) >= coupon.maxRedemptions) return { ok: false, reason: 'used_up' };
  if ((await couponRedemptions.countDocuments({ couponId: coupon._id, userId: use.userId })) >= coupon.maxPerUser) return { ok: false, reason: 'already_used' };
  return { ok: true, coupon: coupon as CouponDoc & { _id: ObjectId } };
}

/** The price after a coupon, in minor units; never below zero. */
export function discountedAmount(amountMinor: number, coupon: Pick<CouponDoc, 'kind' | 'percentOff' | 'amountOffMinor'>): number {
  const off = coupon.kind === 'percent' ? Math.round((amountMinor * (coupon.percentOff ?? 0)) / 100) : (coupon.amountOffMinor ?? 0);
  return Math.max(0, amountMinor - off);
}
