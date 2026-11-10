import 'server-only';
import type { Db } from 'mongodb';
import { removeUserData } from '@/server/account-management';
import { recordAudit } from '@/server/audit';
import { collections } from '@/server/db/collections';

// Nightly housekeeping (`npm run db -- maintenance`, run by cron on the server):
// - password sign-ups whose address was never confirmed within 24 hours are
//   removed, so nobody can hold someone else's address hostage (ADR-0002);
//   accounts with any other sign-in method are never touched;
// - Better Auth's per-IP rate-limit rows idle for over a day are pruned.
// Expired sessions, verifications, throttles and outbox mail remove
// themselves (TTL indexes).

export const UNVERIFIED_LIFETIME_MS = 24 * 60 * 60 * 1000;
const RATE_LIMIT_IDLE_MS = 24 * 60 * 60 * 1000;

export async function runMaintenance(db: Db, now = new Date()) {
  const { users, accounts, rateLimits } = collections(db);
  const stale = await users
    .find({ emailVerified: false, createdAt: { $lt: new Date(now.getTime() - UNVERIFIED_LIFETIME_MS) } }, { projection: { email: 1 } })
    .toArray();
  let unverifiedRemoved = 0;
  for (const user of stale) {
    const methods = await accounts.find({ userId: user._id }, { projection: { providerId: 1 } }).toArray();
    if (methods.some((m) => m.providerId !== 'credential')) continue;
    await recordAudit(db, { type: 'account.deleted', userId: user._id, actor: 'system', metadata: { reason: 'never_verified' } });
    await removeUserData(db, user._id, user.email);
    unverifiedRemoved += 1;
  }
  const { deletedCount: rateLimitsPruned } = await rateLimits.deleteMany({ lastRequest: { $lt: now.getTime() - RATE_LIMIT_IDLE_MS } });
  return { unverifiedRemoved, rateLimitsPruned };
}
