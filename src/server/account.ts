import 'server-only';
import type { Db, ObjectId } from 'mongodb';
import { TOOL_IDS, type AccountSummary, type ToolId } from '@/lib/account';
import { collections } from '@/server/db/collections';
import { getEntitlements, type Entitlements } from '@/server/entitlements';

/**
 * The signed-in person's own account, read fresh from the database (never from
 * the session's cookie cache), so a plan or role change shows on their next
 * request. Safe to send to the browser: no tokens, no provider ids.
 */
export async function getAccountSummary(db: Db, userId: ObjectId, now = new Date()): Promise<{ account: AccountSummary; entitlements: Entitlements } | null> {
  const [user, entitlements] = await Promise.all([
    collections(db).users.findOne(
      { _id: userId },
      { projection: { name: 1, email: 1, emailVerified: 1, image: 1, createdAt: 1, lastLoginAt: 1, introsSeen: 1 } },
    ),
    getEntitlements(db, userId, now),
  ]);
  if (!user) return null;
  return {
    entitlements,
    account: {
      id: user._id.toHexString(),
      name: user.name,
      email: user.email,
      emailVerified: user.emailVerified === true,
      image: user.image ?? null,
      role: entitlements.role,
      createdAt: user.createdAt.toISOString(),
      lastLoginAt: user.lastLoginAt ? user.lastLoginAt.toISOString() : null,
      plan: { assigned: entitlements.assignedPlan, effective: entitlements.planId },
      access: entitlements.access,
      subscription: { status: entitlements.subscriptionStatus ?? 'none' },
      features: entitlements.features,
      introsSeen: (user.introsSeen ?? []).filter((tool): tool is ToolId => (TOOL_IDS as readonly string[]).includes(tool)),
    },
  };
}

/** Remember that the person dismissed a tool's first-visit introduction (their own account only). */
export async function markIntroSeen(db: Db, userId: ObjectId, tool: ToolId): Promise<void> {
  await collections(db).users.updateOne({ _id: userId }, { $addToSet: { introsSeen: tool } });
}

/** Show every tool's introduction again (the person asked for it on their account page). */
export async function resetIntros(db: Db, userId: ObjectId): Promise<void> {
  await collections(db).users.updateOne({ _id: userId }, { $set: { introsSeen: [] } });
}
