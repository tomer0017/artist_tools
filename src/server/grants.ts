import 'server-only';
import type { Db, ObjectId } from 'mongodb';
import { isPlanId, type PlanId } from '@/lib/plans';
import { recordAudit } from '@/server/audit';
import { collections, toObjectId, type AccessGrantDoc, type GrantReason } from '@/server/db/collections';

// ─── Manual Pro for a limited time ────────────────────────────────────────────
// An administrator can give an account Pro for a limited time (a promotion, a
// trial, support, testing). A grant never changes the assigned plan or a
// subscription: entitlements simply use the best of the three while the grant
// lasts, and it ends on its own at `endsAt` (checked whenever access is read,
// so no job is needed). It can be extended from its current end, never past a
// year from today, or ended early. Nobody can give, extend or end their own
// access. Every change is audited.
//
// Pro with no end date is the assigned plan instead (setUserPlan in
// src/server/admin.ts): the same "no payment involved", without a grant.

export const GRANT_REASONS: readonly GrantReason[] = ['promotion', 'trial', 'support', 'test'];
export const GRANT_REASON_LABELS: Record<GrantReason, string> = {
  promotion: 'Promotion',
  trial: 'Trial',
  support: 'Support',
  test: 'Testing',
};
/** What the dashboard offers, for new grants and for extensions. Older grants of other lengths (14 or 365 days) keep working. */
export const GRANT_LENGTHS = [7, 30, 90] as const;
export type GrantLength = (typeof GRANT_LENGTHS)[number];
/** No grant ever ends more than this many days from today, also after an extension (a year, leap day included). */
export const MAX_GRANT_DAYS = 366;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Grants in force at `now`: not ended early, started, not yet ended. */
export const liveGrantFilter = (now: Date) => ({ revokedAt: null, startsAt: { $lte: now }, endsAt: { $gt: now } });

/** The best plan a live grant gives the account right now, with when it ends. */
export async function activeGrant(db: Db, userId: ObjectId, now = new Date()): Promise<{ planId: PlanId; endsAt: Date } | null> {
  const grants = await collections(db)
    .accessGrants.find({ userId, ...liveGrantFilter(now) }, { sort: { endsAt: -1 }, projection: { planId: 1, endsAt: 1 } })
    .toArray();
  const pro = grants.find((g) => g.planId === 'pro');
  const best = pro ?? grants[0];
  return best && isPlanId(best.planId) ? { planId: best.planId, endsAt: best.endsAt } : null;
}

export async function listGrants(db: Db, userId: ObjectId) {
  return collections(db).accessGrants.find({ userId }, { sort: { createdAt: -1 }, limit: 50 }).toArray();
}

/** 'self': nobody gives, extends or ends their own access from the dashboard (admins already have every feature). */
export type GrantResult = { status: 'created'; grantId: string; endsAt: Date } | { status: 'not_found' } | { status: 'invalid' } | { status: 'self' };

const wholeDays = (days: number) => Number.isInteger(days) && days >= 1 && days <= MAX_GRANT_DAYS;

export async function createGrant(
  db: Db,
  input: { userId: ObjectId; planId: PlanId; days: number; reason: GrantReason; actor: string; actorUserId?: ObjectId | null },
  now = new Date(),
): Promise<GrantResult> {
  // Only Pro is ever given: a grant of Free would change nothing.
  if (input.planId !== 'pro' || !GRANT_REASONS.includes(input.reason) || !wholeDays(input.days)) return { status: 'invalid' };
  if (input.actorUserId?.equals(input.userId)) return { status: 'self' };
  const user = await collections(db).users.findOne({ _id: input.userId }, { projection: { _id: 1 } });
  if (!user) return { status: 'not_found' };
  const endsAt = new Date(now.getTime() + input.days * DAY_MS);
  const doc: AccessGrantDoc = {
    userId: input.userId,
    planId: input.planId,
    startsAt: now,
    endsAt,
    reason: input.reason,
    grantedBy: input.actor,
    createdAt: now,
    revokedAt: null,
    revokedBy: null,
  };
  const { insertedId } = await collections(db).accessGrants.insertOne(doc);
  await recordAudit(db, {
    type: 'admin.grant_created',
    userId: input.userId,
    actor: input.actor,
    metadata: { grantId: insertedId.toHexString(), planId: input.planId, days: input.days, reason: input.reason },
  });
  return { status: 'created', grantId: insertedId.toHexString(), endsAt };
}

/** 'not_found': no such grant in force for this account (ended, ended early, someone else's); give Pro again instead. */
export type ExtendResult = { status: 'extended'; endsAt: Date } | { status: 'too_long'; latest: Date } | { status: 'not_found' } | { status: 'invalid' } | { status: 'self' };

/**
 * Move a grant in force `days` later, from its current end (not from today).
 * Refused when the new end would be more than MAX_GRANT_DAYS from today:
 * longer access is Pro with no end date. Nothing else changes.
 */
export async function extendGrant(
  db: Db,
  input: { userId: ObjectId; grantId: string; days: number; actor: string; actorUserId?: ObjectId | null },
  now = new Date(),
): Promise<ExtendResult> {
  if (!wholeDays(input.days)) return { status: 'invalid' };
  if (input.actorUserId?.equals(input.userId)) return { status: 'self' };
  const grantId = toObjectId(input.grantId);
  if (!grantId) return { status: 'not_found' };
  const { accessGrants } = collections(db);
  const grant = await accessGrants.findOne({ _id: grantId, userId: input.userId, ...liveGrantFilter(now) });
  if (!grant) return { status: 'not_found' };
  const endsAt = new Date(grant.endsAt.getTime() + input.days * DAY_MS);
  const latest = new Date(now.getTime() + MAX_GRANT_DAYS * DAY_MS);
  if (endsAt.getTime() > latest.getTime()) return { status: 'too_long', latest };
  // The end it had is part of the condition: of two changes at the same moment, only one applies.
  const { modifiedCount } = await accessGrants.updateOne(
    { _id: grantId, userId: input.userId, revokedAt: null, endsAt: grant.endsAt },
    { $set: { endsAt, extendedAt: now, extendedBy: input.actor } },
  );
  if (modifiedCount === 0) return { status: 'not_found' };
  await recordAudit(db, {
    type: 'admin.grant_extended',
    userId: input.userId,
    actor: input.actor,
    metadata: { grantId: input.grantId, planId: grant.planId, days: input.days, from: grant.endsAt.toISOString(), to: endsAt.toISOString() },
  });
  return { status: 'extended', endsAt };
}

export async function revokeGrant(
  db: Db,
  input: { userId: ObjectId; grantId: string; actor: string; actorUserId?: ObjectId | null },
  now = new Date(),
): Promise<'revoked' | 'not_found' | 'self'> {
  if (input.actorUserId?.equals(input.userId)) return 'self';
  const grantId = toObjectId(input.grantId);
  if (!grantId) return 'not_found';
  const { modifiedCount } = await collections(db).accessGrants.updateOne(
    { _id: grantId, userId: input.userId, revokedAt: null },
    { $set: { revokedAt: now, revokedBy: input.actor } },
  );
  if (modifiedCount === 0) return 'not_found';
  await recordAudit(db, { type: 'admin.grant_revoked', userId: input.userId, actor: input.actor, metadata: { grantId: input.grantId } });
  return 'revoked';
}
