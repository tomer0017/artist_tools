import 'server-only';
import type { Db, ObjectId } from 'mongodb';
import { isPlanId, type PlanId } from '@/lib/plans';
import { recordAudit } from '@/server/audit';
import { collections, toObjectId, type AccessGrantDoc, type GrantReason } from '@/server/db/collections';

// ─── Promotional and trial access ─────────────────────────────────────────────
// An administrator can give an account a plan for a limited time (a promotion,
// a trial, support, testing). A grant never changes the assigned plan or a
// subscription: entitlements simply use the best of the three while the grant
// lasts, and it ends on its own at `endsAt` (checked whenever access is read,
// so no job is needed). Revoking ends it early. Every change is audited.

export const GRANT_REASONS: readonly GrantReason[] = ['promotion', 'trial', 'support', 'test'];
export const GRANT_REASON_LABELS: Record<GrantReason, string> = {
  promotion: 'Promotion',
  trial: 'Trial',
  support: 'Support',
  test: 'Testing',
};
export const MAX_GRANT_DAYS = 366;

/** The best plan a live grant gives the account right now, with when it ends. */
export async function activeGrant(db: Db, userId: ObjectId, now = new Date()): Promise<{ planId: PlanId; endsAt: Date } | null> {
  const grants = await collections(db)
    .accessGrants.find({ userId, revokedAt: null, startsAt: { $lte: now }, endsAt: { $gt: now } }, { sort: { endsAt: -1 }, projection: { planId: 1, endsAt: 1 } })
    .toArray();
  const pro = grants.find((g) => g.planId === 'pro');
  const best = pro ?? grants[0];
  return best && isPlanId(best.planId) ? { planId: best.planId, endsAt: best.endsAt } : null;
}

export async function listGrants(db: Db, userId: ObjectId) {
  return collections(db).accessGrants.find({ userId }, { sort: { createdAt: -1 }, limit: 50 }).toArray();
}

export type GrantResult = { status: 'created'; grantId: string; endsAt: Date } | { status: 'not_found' } | { status: 'invalid' };

export async function createGrant(
  db: Db,
  input: { userId: ObjectId; planId: PlanId; days: number; reason: GrantReason; actor: string },
  now = new Date(),
): Promise<GrantResult> {
  if (!isPlanId(input.planId) || !GRANT_REASONS.includes(input.reason)) return { status: 'invalid' };
  if (!Number.isInteger(input.days) || input.days < 1 || input.days > MAX_GRANT_DAYS) return { status: 'invalid' };
  const user = await collections(db).users.findOne({ _id: input.userId }, { projection: { _id: 1 } });
  if (!user) return { status: 'not_found' };
  const endsAt = new Date(now.getTime() + input.days * 24 * 60 * 60 * 1000);
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

export async function revokeGrant(db: Db, input: { userId: ObjectId; grantId: string; actor: string }, now = new Date()): Promise<'revoked' | 'not_found'> {
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
