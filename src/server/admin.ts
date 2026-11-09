import 'server-only';
import type { Db, ObjectId } from 'mongodb';
import { recordAudit } from '@/server/audit';
import { collections, type AccountStatus, type PlanId, type SubscriptionStatus, type UserRole } from '@/server/db/collections';
import { usagePeriod } from '@/server/usage';

// Read models and operations for application administrators. Everything here
// is called only after requireAdmin() (pages) or from the operator CLI.

export interface AdminUserRow {
  id: string;
  name: string;
  email: string;
  createdAt: Date;
  lastLoginAt: Date | null;
  status: AccountStatus;
  role: UserRole;
  planId: PlanId | null;
  subscriptionStatus: SubscriptionStatus | null;
  usageThisMonth: number;
}

export async function listUsers(db: Db, page = 1, pageSize = 50): Promise<{ rows: AdminUserRow[]; total: number; page: number; pages: number }> {
  const { users } = collections(db);
  const total = await users.countDocuments();
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const current = Math.min(Math.max(1, Math.floor(page) || 1), pages);
  const period = usagePeriod();

  const rows = await users
    .aggregate<AdminUserRow>([
      { $sort: { createdAt: -1, _id: -1 } },
      { $skip: (current - 1) * pageSize },
      { $limit: pageSize },
      {
        $lookup: {
          from: 'subscriptions',
          let: { uid: '$_id' },
          pipeline: [{ $match: { $expr: { $eq: ['$userId', '$$uid'] } } }, { $sort: { updatedAt: -1 } }, { $limit: 1 }],
          as: 'subscription',
        },
      },
      {
        $lookup: {
          from: 'usage',
          let: { uid: '$_id' },
          pipeline: [
            { $match: { $expr: { $and: [{ $eq: ['$userId', '$$uid'] }, { $eq: ['$period', period] }] } } },
            { $group: { _id: null, total: { $sum: '$quantity' } } },
          ],
          as: 'usage',
        },
      },
      {
        $project: {
          _id: 0,
          id: { $toString: '$_id' },
          name: 1,
          email: 1,
          createdAt: 1,
          lastLoginAt: { $ifNull: ['$lastLoginAt', null] },
          status: { $ifNull: ['$status', 'active'] },
          role: { $ifNull: ['$role', 'user'] },
          planId: { $ifNull: [{ $first: '$subscription.planId' }, null] },
          subscriptionStatus: { $ifNull: [{ $first: '$subscription.status' }, null] },
          usageThisMonth: { $ifNull: [{ $first: '$usage.total' }, 0] },
        },
      },
    ])
    .toArray();
  return { rows, total, page: current, pages };
}

/** Look a user up by email (operator CLI only), to find the id to act on. */
export async function findUserByEmail(db: Db, email: string) {
  return collections(db).users.findOne(
    { email: email.trim().toLowerCase() },
    { projection: { name: 1, email: 1, role: 1, status: 1, createdAt: 1 } },
  );
}

/** Grant or revoke the admin role by user id; audited. Returns false when no such user. */
export async function setUserRole(db: Db, userId: ObjectId, role: UserRole, actor: string): Promise<boolean> {
  const result = await collections(db).users.updateOne({ _id: userId }, { $set: { role, updatedAt: new Date() } });
  if (result.matchedCount === 0) return false;
  await recordAudit(db, {
    type: role === 'admin' ? 'admin.role_granted' : 'admin.role_revoked',
    userId,
    actor,
    metadata: { role },
  });
  return true;
}
