import 'server-only';
import type { Db } from 'mongodb';
import { removeUserData } from '@/server/account-management';
import { recordAudit } from '@/server/audit';
import { collections } from '@/server/db/collections';

// Nightly housekeeping (`npm run db -- maintenance`, run by cron on the server):
// - password sign-ups whose address was never confirmed within 24 hours are
//   removed, so nobody can hold someone else's address hostage (ADR-0002);
//   accounts with any other sign-in method are never touched;
// - Better Auth's per-IP rate-limit rows idle for over a day are pruned;
// - analytics events older than 13 months and audit events older than 24
//   months are deleted (the retention proposed in ADR-0011 and ADR-0010, to
//   be confirmed with counsel; docs/privacy/data-inventory.md).
// Expired sessions, verifications, throttles and outbox mail remove
// themselves (TTL indexes).

export const UNVERIFIED_LIFETIME_MS = 24 * 60 * 60 * 1000;
const RATE_LIMIT_IDLE_MS = 24 * 60 * 60 * 1000;
export const ANALYTICS_RETENTION_MONTHS = 13;
export const AUDIT_RETENTION_MONTHS = 24;

/** The same moment `months` calendar months earlier (UTC), on the month's last day when it is shorter (31 March → 28 February). */
export function monthsBefore(now: Date, months: number): Date {
  const target = new Date(now);
  target.setUTCDate(1);
  target.setUTCMonth(target.getUTCMonth() - months);
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(now.getUTCDate(), lastDay));
  return target;
}

export async function runMaintenance(db: Db, now = new Date()) {
  const { users, accounts, rateLimits, analyticsEvents, auditEvents } = collections(db);
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
  const { deletedCount: analyticsPruned } = await analyticsEvents.deleteMany({ at: { $lt: monthsBefore(now, ANALYTICS_RETENTION_MONTHS) } });
  const { deletedCount: auditPruned } = await auditEvents.deleteMany({ at: { $lt: monthsBefore(now, AUDIT_RETENTION_MONTHS) } });
  return { unverifiedRemoved, rateLimitsPruned, analyticsPruned, auditPruned };
}
