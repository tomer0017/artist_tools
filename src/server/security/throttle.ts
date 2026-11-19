import 'server-only';
import { createHash } from 'node:crypto';
import type { Db } from 'mongodb';
import { collections, isDuplicateKeyError } from '@/server/db/collections';

// ─── Per-address throttles ────────────────────────────────────────────────────
// Limits that follow an email address rather than a network address, so
// rotating IPs does not help an attacker guess one account's password or flood
// one inbox. Keys hold a SHA-256 of the address, never the address itself,
// and every window ends on its own (no permanent lockout anyone could
// trigger). Better Auth's per-IP limits run in front of these.

export interface ThrottleRule {
  limit: number;
  windowSeconds: number;
}

export const THROTTLES = {
  /** Wrong passwords for one address before password sign-in pauses for it. */
  signInFailures: { limit: 10, windowSeconds: 15 * 60 },
  /** Emails of one kind to one address. */
  mailPerHour: { limit: 3, windowSeconds: 60 * 60 },
  mailPerDay: { limit: 10, windowSeconds: 24 * 60 * 60 },
  /**
   * New accounts from everyone together (Google and password alike): a
   * circuit breaker against mass sign-ups, which also keeps the email
   * provider's daily quota and the sender's reputation safe. Counted under
   * the key EVERYONE rather than an address.
   */
  newAccountsPerHour: { limit: 50, windowSeconds: 60 * 60 },
  newAccountsPerDay: { limit: 300, windowSeconds: 24 * 60 * 60 },
  /** Learn items and images one account asks for (ADR-0017), counted under the account's id; admins are not counted. */
  learnRequests: { limit: 600, windowSeconds: 10 * 60 },
  /** Completions one account records or removes (ADR-0018), counted under the account's id. */
  learnCompletions: { limit: 60, windowSeconds: 10 * 60 },
} satisfies Record<string, ThrottleRule>;

/** The "address" of counters that cover every visitor at once. */
export const EVERYONE = '*';

const hashAddress = (address: string) => createHash('sha256').update(address.trim().toLowerCase()).digest('base64url');
export const throttleKey = (purpose: string, address: string) => `${purpose}:${hashAddress(address)}`;

/**
 * Count one event for `address` and say whether it is still within the rule.
 * Atomic: a window that has ended starts again at 1.
 */
export async function consumeThrottle(db: Db, purpose: string, address: string, rule: ThrottleRule, now = new Date()) {
  const { authThrottles } = collections(db);
  const key = throttleKey(purpose, address);
  const live = { $gt: ['$expiresAt', now] };
  const update = () =>
    authThrottles.findOneAndUpdate(
      { _id: key },
      [
        {
          $set: {
            count: { $cond: [live, { $add: ['$count', 1] }, 1] },
            firstAt: { $cond: [live, '$firstAt', now] },
            expiresAt: { $cond: [live, '$expiresAt', new Date(now.getTime() + rule.windowSeconds * 1000)] },
          },
        },
      ],
      { upsert: true, returnDocument: 'after' },
    );
  let doc;
  try {
    doc = await update();
  } catch (error) {
    // Two first events raced to create the window; the loser counts into it.
    if (!isDuplicateKeyError(error)) throw error;
    doc = await update();
  }
  const count = doc?.count ?? 1;
  return { allowed: count <= rule.limit, count };
}

/** How many events `address` has in its current window (0 when none or ended). */
export async function throttleCount(db: Db, purpose: string, address: string, now = new Date()): Promise<number> {
  const doc = await collections(db).authThrottles.findOne({ _id: throttleKey(purpose, address) });
  return doc && doc.expiresAt > now ? doc.count : 0;
}

/** End the window early (e.g. after a successful sign-in). */
export async function clearThrottle(db: Db, purpose: string, address: string): Promise<void> {
  await collections(db).authThrottles.deleteOne({ _id: throttleKey(purpose, address) });
}
