import 'server-only';
import { randomInt } from 'node:crypto';
import type { Db, ObjectId } from 'mongodb';
import { isAPIError } from 'better-auth/api';
import type { Locale } from '@/lib/locale';
import type { PlanId } from '@/lib/plans';
import { normalizeUsername, usernameEmail, usernameProblem, type UsernameProblem } from '@/lib/username';
import { cleanDisplayName, removeUserData } from '@/server/account-management';
import { recordAudit } from '@/server/audit';
import { usernameThrottleKey, type Auth } from '@/server/auth';
import { collections, isDuplicateKeyError, toObjectId } from '@/server/db/collections';
import { checkPassword } from '@/server/security/password-policy';
import { open, seal } from '@/server/security/secret-box';
import { clearThrottle } from '@/server/security/throttle';

// ─── Username accounts for invited testers (ADR-0012) ─────────────────────────
// Created only by an administrator (dashboard) or an operator (CLI), never by
// the public. Passwords are generated here, hashed by Better Auth's own
// hasher (scrypt) through its server-only endpoints, and never stored in
// plain text or written to a log:
// - from the dashboard, a new password is shown once to the administrator
//   who asked for it, in the reply to that request;
// - from the CLI, which must not print it, the initial password is sealed
//   (AES-256-GCM, secret-box.ts) and can be revealed once from the dashboard
//   for 72 hours, after which only a reset gives a new one.
// A reset never shows the old password: it makes a new one and signs the
// account out everywhere. Every change is audited (ids and enums only).

/** No 0/O, 1/l/I: easy to read out and to type on a phone. */
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';

/** How long an initial password from the CLI waits to be revealed. */
export const INITIAL_PASSWORD_HOURS = 72;

/**
 * A new random password: 16 characters from 56 (about 93 bits), in four
 * groups ("Kp7x-Tq3m-W9fz-Hd2r"), that passes the password policy.
 */
export function generatePassword(context: { email?: string | null; name?: string | null } = {}): string {
  for (let attempt = 0; attempt < 100; attempt++) {
    const chars = Array.from({ length: 16 }, () => ALPHABET[randomInt(ALPHABET.length)]);
    const password = [0, 4, 8, 12].map((start) => chars.slice(start, start + 4).join('')).join('-');
    if (!checkPassword(password, context)) return password;
  }
  throw new Error('Could not generate a password that passes the policy');
}

export type CreateAccountResult =
  | { status: 'created'; userId: ObjectId; username: string; password: string }
  /** That username is taken: nothing was changed (creating is idempotent and never overwrites). */
  | { status: 'exists'; userId: ObjectId }
  | { status: 'invalid'; problem: UsernameProblem | 'name' }
  /** The username's placeholder address belongs to another account. */
  | { status: 'conflict' };

export interface NewAccount {
  username: string;
  /** Shown in the studio; the username when left out. */
  name?: string;
  plan: PlanId;
  locale: Locale;
  /** Left out of analytics and revenue figures. */
  test: boolean;
  /** 'admin:<id>' or 'cli'. */
  actor: string;
}

/** Create a username account with a new random password (returned once, never stored); audited. */
export async function createUsernameAccount(db: Db, auth: Auth, input: NewAccount, now = new Date()): Promise<CreateAccountResult> {
  const { users } = collections(db);
  const username = input.username.trim();
  const problem = usernameProblem(username);
  if (problem) return { status: 'invalid', problem };
  const name = cleanDisplayName(input.name?.trim() ? input.name : username);
  if (!name) return { status: 'invalid', problem: 'name' };

  const lower = normalizeUsername(username);
  const existing = await users.findOne({ $or: [{ username: lower }, { email: usernameEmail(username) }] }, { projection: { username: 1 } });
  if (existing) return existing.username === lower ? { status: 'exists', userId: existing._id } : { status: 'conflict' };

  const password = generatePassword({ email: usernameEmail(username), name });
  let userId: ObjectId;
  try {
    const created = await auth.api.createUsernameAccount({ body: { username, name, password, plan: input.plan, locale: input.locale } });
    userId = toObjectId(created.userId)!;
  } catch (error) {
    // Someone created the same username a moment ago: report it, change nothing.
    const taken = isDuplicateKeyError(error) || (isAPIError(error) && (error.body as { code?: string } | undefined)?.code === 'USERNAME_IS_ALREADY_TAKEN');
    const winner = taken ? await users.findOne({ username: lower }, { projection: { _id: 1 } }) : null;
    if (winner) return { status: 'exists', userId: winner._id };
    throw error;
  }
  await users.updateOne(
    { _id: userId },
    { $set: { testAccount: input.test, createdBy: input.actor, planUpdatedAt: now, planUpdatedBy: input.actor, updatedAt: now } },
  );
  await recordAudit(db, { type: 'admin.account_created', userId, actor: input.actor, metadata: { method: 'username', plan: input.plan, test: input.test } });
  return { status: 'created', userId, username, password };
}

export type ResetResult =
  | { status: 'reset'; password: string; sessionsEnded: number }
  | { status: 'not_found' }
  /** Only username accounts have passwords an administrator may reset (never a Google account). */
  | { status: 'not_username_account' };

/**
 * Give a username account a new random password (returned once): the old
 * one stops working, every session ends, an initial password still waiting
 * to be revealed is discarded and a sign-in pause is lifted; audited.
 */
export async function resetUsernamePassword(db: Db, auth: Auth, change: { userId: ObjectId; actor: string }): Promise<ResetResult> {
  const { users, sessions, passwordHandoffs } = collections(db);
  const user = await users.findOne({ _id: change.userId }, { projection: { username: 1, email: 1, name: 1 } });
  if (!user) return { status: 'not_found' };
  if (!user.username) return { status: 'not_username_account' };
  const password = generatePassword({ email: user.email, name: user.name });
  try {
    await auth.api.setUsernamePassword({ body: { userId: change.userId.toHexString(), password } });
  } catch (error) {
    if (isAPIError(error) && (error.body as { code?: string } | undefined)?.code === 'NOT_A_USERNAME_ACCOUNT') return { status: 'not_username_account' };
    throw error;
  }
  const { deletedCount } = await sessions.deleteMany({ userId: change.userId });
  await passwordHandoffs.deleteOne({ _id: change.userId });
  await clearThrottle(db, 'signin-fail', usernameThrottleKey(user.username));
  await recordAudit(db, { type: 'admin.password_reset', userId: change.userId, actor: change.actor, metadata: { sessionsEnded: deletedCount } });
  return { status: 'reset', password, sessionsEnded: deletedCount };
}

export type EndSessionsResult = { status: 'ended'; count: number } | { status: 'not_found' } | { status: 'self' };

/** Sign an account out on every device (its sessions end at once); audited. Not for the admin's own account. */
export async function endAllSessions(db: Db, change: { userId: ObjectId; actor: string; actorUserId?: ObjectId | null }): Promise<EndSessionsResult> {
  if (change.actorUserId?.equals(change.userId)) return { status: 'self' };
  const { users, sessions } = collections(db);
  if (!(await users.findOne({ _id: change.userId }, { projection: { _id: 1 } }))) return { status: 'not_found' };
  const { deletedCount } = await sessions.deleteMany({ userId: change.userId });
  await recordAudit(db, { type: 'admin.sessions_revoked', userId: change.userId, actor: change.actor, metadata: { count: deletedCount } });
  return { status: 'ended', count: deletedCount };
}

/** Keep an initial password, sealed, for one reveal in the dashboard; returns when it expires. */
export async function holdInitialPassword(db: Db, userId: ObjectId, password: string, actor: string, now = new Date()): Promise<Date> {
  const expiresAt = new Date(now.getTime() + INITIAL_PASSWORD_HOURS * 60 * 60 * 1000);
  await collections(db).passwordHandoffs.replaceOne(
    { _id: userId },
    { sealed: seal(password, undefined, 'initial-password'), createdBy: actor, createdAt: now, expiresAt },
    { upsert: true },
  );
  return expiresAt;
}

/** Whether an initial password is waiting to be revealed, and until when. */
export async function pendingInitialPassword(db: Db, userId: ObjectId, now = new Date()): Promise<{ expiresAt: Date } | null> {
  const doc = await collections(db).passwordHandoffs.findOne({ _id: userId, expiresAt: { $gt: now } }, { projection: { expiresAt: 1 } });
  return doc ? { expiresAt: doc.expiresAt } : null;
}

export type RevealResult = { status: 'revealed'; password: string } | { status: 'none' } | { status: 'unreadable' };

/** The initial password, once: it is removed in the same step, so a second request finds nothing; audited. */
export async function revealInitialPassword(db: Db, change: { userId: ObjectId; actor: string }, now = new Date()): Promise<RevealResult> {
  const doc = await collections(db).passwordHandoffs.findOneAndDelete({ _id: change.userId, expiresAt: { $gt: now } });
  if (!doc) return { status: 'none' };
  // Sealed under an older BETTER_AUTH_SECRET: gone either way; a reset makes a new one.
  const password = open(doc.sealed, undefined, 'initial-password');
  if (!password) return { status: 'unreadable' };
  await recordAudit(db, { type: 'admin.initial_password_revealed', userId: change.userId, actor: change.actor, metadata: {} });
  return { status: 'revealed', password };
}

export type RemoveResult = 'removed' | 'not_found' | 'not_username_account';

/** Delete a username account and its data (operator CLI only; never a Google account or an admin); audited. */
export async function removeUsernameAccount(db: Db, change: { userId: ObjectId; actor: string }): Promise<RemoveResult> {
  const { users } = collections(db);
  const user = await users.findOne({ _id: change.userId }, { projection: { username: 1, email: 1, role: 1 } });
  if (!user) return 'not_found';
  if (!user.username || user.role === 'admin') return 'not_username_account';
  await recordAudit(db, { type: 'admin.account_removed', userId: change.userId, actor: change.actor, metadata: { method: 'username' } });
  await collections(db).passwordHandoffs.deleteOne({ _id: change.userId });
  await removeUserData(db, change.userId, user.email);
  return 'removed';
}

/** A username account by its username (any capitals), for the operator CLI. */
export async function findByUsername(db: Db, username: string) {
  return collections(db).users.findOne(
    { username: normalizeUsername(username) },
    { projection: { name: 1, username: 1, displayUsername: 1, role: 1, plan: 1, status: 1, testAccount: 1, createdAt: 1, lastLoginAt: 1 } },
  );
}
