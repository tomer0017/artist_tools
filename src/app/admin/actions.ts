'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { LOCALES } from '@/lib/locale';
import { PLAN_IDS, PLAN_NAMES } from '@/lib/plans';
import { mayChangeRoles, ownerProtection, setTestAccount, setUserPlan, setUserRole, setUserStatus } from '@/server/admin';
import { getAuth, usernamePasswordAvailable } from '@/server/auth';
import { getDb } from '@/server/db/client';
import { SUSPEND_REASONS, collections, toObjectId, type SuspendReason } from '@/server/db/collections';
import { GRANT_LENGTHS, GRANT_REASONS, createGrant, extendGrant, liveGrantFilter, revokeGrant } from '@/server/grants';
import type { GrantReason } from '@/server/db/collections';
import { log } from '@/server/log';
import { createUsernameAccount, endAllSessions, resetUsernamePassword, revealInitialPassword } from '@/server/password-accounts';
import { currentAdmin, signedInRecently } from '@/server/session';

// Administrator actions. Next.js accepts server actions only from this site's
// own pages (it compares Origin and Host); each action then re-checks, from the
// database, that the caller is an active admin, validates its input and is
// audited by the operation it calls. Nothing here trusts the page that sent it.
// The most sensitive ones (roles, suspensions, handing out a password) also
// need a sign-in from the last 10 minutes, so a stolen or forgotten session
// cannot use them. Once an owner is set (server command line only), no other
// admin can change the owner's account, and only the owner changes roles.
//
// A password an action hands out (a new tester, a reset, an initial password)
// is in its reply to the admin who asked, once: it is never stored in plain
// text, never logged and never shown again.

export type ActionResult = { ok: boolean; message: string; reauth?: boolean };

/** A reply that hands a password to the admin who asked, once. */
export type PasswordResult = ActionResult & { credentials?: { userId: string; username: string; password: string } };

const UserId = z.string().regex(/^[0-9a-f]{24}$/i);
const Reason = z.enum(GRANT_REASONS as [GrantReason, ...GrantReason[]]);
const PlanInput = z.object({ userId: UserId, plan: z.enum(PLAN_IDS), reason: Reason.optional() });
const RoleInput = z.object({ userId: UserId, role: z.enum(['user', 'admin']) });
/** Only the lengths the dashboard offers (older grants of other lengths keep working). */
const Length = z.number().int().refine((days) => (GRANT_LENGTHS as readonly number[]).includes(days));

const DENIED: ActionResult = { ok: false, message: 'You are not allowed to do that.' };
const INVALID: ActionResult = { ok: false, message: 'That request was not valid.' };
const REAUTH: ActionResult = { ok: false, reauth: true, message: 'For your security, confirm it is you (sign in again), then repeat this change.' };
const SELF: ActionResult = { ok: false, message: 'You cannot change your own access. As an admin you already have every feature.' };
const OWNER: ActionResult = { ok: false, message: "This is the owner's account: only the owner can change it." };
const ROLES_OWNER_ONLY: ActionResult = { ok: false, message: 'Only the owner can change who is an admin.' };

/** The owner's account, and the admin acting is someone else. */
async function ownersAccount(adminId: NonNullable<Awaited<ReturnType<typeof currentAdmin>>>['id'], userId: string): Promise<boolean> {
  return (await ownerProtection(getDb(), { actorUserId: adminId, userId: toObjectId(userId)! })) === 'owner';
}

function refresh(userId: string) {
  revalidatePath('/admin');
  revalidatePath(`/admin/users/${userId}`);
}

/** The assigned plan: Pro here is Pro with no end date, given without payment; Free ends it. Billing and grants are never touched. */
export async function changePlan(input: { userId: string; plan: string; reason?: string }): Promise<ActionResult> {
  const admin = await currentAdmin();
  if (!admin) return DENIED;
  const parsed = PlanInput.safeParse(input);
  if (!parsed.success) return INVALID;
  if (await ownersAccount(admin.id, parsed.data.userId)) return OWNER;

  const { userId, plan, reason } = parsed.data;
  const result = await setUserPlan(getDb(), { userId: toObjectId(userId)!, plan, reason, actor: `admin:${admin.id.toHexString()}`, actorUserId: admin.id });
  if (result.status === 'not_found') return { ok: false, message: 'That account no longer exists.' };
  if (result.status === 'self') return SELF;
  if (result.status === 'unchanged') return { ok: true, message: plan === 'pro' ? 'They already have Pro with no end date.' : 'They have no Pro with no end date to end.' };
  log.info('admin.plan_changed', { userId, from: result.from, to: result.to });
  refresh(userId);
  return { ok: true, message: plan === 'pro' ? 'Pro given with no end date.' : 'Pro with no end date ended. A subscription or Pro for a time, if they have one, is unchanged.' };
}

export async function changeRole(input: { userId: string; role: string }): Promise<ActionResult> {
  const admin = await currentAdmin();
  if (!admin) return DENIED;
  const parsed = RoleInput.safeParse(input);
  if (!parsed.success) return INVALID;
  if (!signedInRecently(admin.signedInAt)) return REAUTH;
  if (!(await mayChangeRoles(getDb(), admin.id))) return ROLES_OWNER_ONLY;
  if (await ownersAccount(admin.id, parsed.data.userId)) return OWNER;

  const { userId, role } = parsed.data;
  const result = await setUserRole(getDb(), { userId: toObjectId(userId)!, role, actor: `admin:${admin.id.toHexString()}`, actorUserId: admin.id });
  switch (result) {
    case 'not_found':
      return { ok: false, message: 'That account no longer exists.' };
    case 'self':
      return { ok: false, message: 'You cannot remove your own admin access.' };
    case 'last_admin':
      return { ok: false, message: 'This is the last admin. Make someone else an admin first.' };
    case 'username_account':
      return { ok: false, message: 'Accounts that sign in with a username can never be admins. Admin access needs a Google sign-in.' };
    case 'unchanged':
      return { ok: true, message: 'Nothing to change.' };
    default:
      log.info('admin.role_changed', { userId, role });
      refresh(userId);
      return { ok: true, message: role === 'admin' ? 'Admin access granted.' : 'Admin access removed.' };
  }
}

const StatusInput = z.object({ userId: UserId, status: z.enum(['active', 'suspended']), reason: z.enum(SUSPEND_REASONS as [SuspendReason, ...SuspendReason[]]).optional() });

export async function changeStatus(input: { userId: string; status: string; reason?: string }): Promise<ActionResult> {
  const admin = await currentAdmin();
  if (!admin) return DENIED;
  const parsed = StatusInput.safeParse(input);
  if (!parsed.success) return INVALID;
  if (await ownersAccount(admin.id, parsed.data.userId)) return OWNER;
  if (!signedInRecently(admin.signedInAt)) return REAUTH;

  const { userId, status, reason } = parsed.data;
  const result = await setUserStatus(getDb(), { userId: toObjectId(userId)!, status, reason, actor: `admin:${admin.id.toHexString()}`, actorUserId: admin.id });
  switch (result) {
    case 'not_found':
      return { ok: false, message: 'That account no longer exists.' };
    case 'self':
      return { ok: false, message: 'You cannot suspend your own account.' };
    case 'last_admin':
      return { ok: false, message: 'This is the last active admin. Make someone else an admin first.' };
    case 'invalid':
      return { ok: false, message: 'Choose a reason for the suspension.' };
    case 'unchanged':
      return { ok: true, message: 'Nothing to change.' };
    default:
      log.info('admin.status_changed', { userId, status });
      refresh(userId);
      return { ok: true, message: status === 'suspended' ? 'Account suspended and signed out everywhere.' : 'Account reactivated.' };
  }
}

export async function changeTestFlag(input: { userId: string; test: boolean }): Promise<ActionResult> {
  const admin = await currentAdmin();
  if (!admin) return DENIED;
  const parsed = z.object({ userId: UserId, test: z.boolean() }).safeParse(input);
  if (!parsed.success) return INVALID;
  if (await ownersAccount(admin.id, parsed.data.userId)) return OWNER;
  const result = await setTestAccount(getDb(), { userId: toObjectId(parsed.data.userId)!, test: parsed.data.test, actor: `admin:${admin.id.toHexString()}` });
  if (result === 'not_found') return { ok: false, message: 'That account no longer exists.' };
  refresh(parsed.data.userId);
  return { ok: true, message: parsed.data.test ? 'Marked as a test account: left out of analytics.' : 'No longer a test account.' };
}

const GrantInput = z.object({ userId: UserId, planId: z.literal('pro'), days: Length, reason: Reason });

const DAY_FORMAT = new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeZone: 'UTC' });

/** Pro for a time, without payment: it ends on its own. Billing and the assigned plan are never touched. */
export async function giveAccess(input: { userId: string; planId: string; days: number; reason: string }): Promise<ActionResult> {
  const admin = await currentAdmin();
  if (!admin) return DENIED;
  const parsed = GrantInput.safeParse(input);
  if (!parsed.success) return INVALID;
  if (await ownersAccount(admin.id, parsed.data.userId)) return OWNER;
  const { userId, planId, days, reason } = parsed.data;
  const result = await createGrant(getDb(), { userId: toObjectId(userId)!, planId, days, reason, actor: `admin:${admin.id.toHexString()}`, actorUserId: admin.id });
  if (result.status === 'not_found') return { ok: false, message: 'That account no longer exists.' };
  if (result.status === 'self') return SELF;
  if (result.status === 'invalid') return INVALID;
  log.info('admin.grant_created', { userId, planId, days });
  refresh(userId);
  return { ok: true, message: `${PLAN_NAMES[planId]} given for ${days} days, until ${DAY_FORMAT.format(result.endsAt)}. It ends on its own.` };
}

/** Move Pro given for a time later, from its current end, never past a year from today. */
export async function extendAccess(input: { userId: string; grantId: string; days: number }): Promise<ActionResult> {
  const admin = await currentAdmin();
  if (!admin) return DENIED;
  const parsed = z.object({ userId: UserId, grantId: UserId, days: Length }).safeParse(input);
  if (!parsed.success) return INVALID;
  if (await ownersAccount(admin.id, parsed.data.userId)) return OWNER;
  const { userId, grantId, days } = parsed.data;
  const result = await extendGrant(getDb(), { userId: toObjectId(userId)!, grantId, days, actor: `admin:${admin.id.toHexString()}`, actorUserId: admin.id });
  switch (result.status) {
    case 'self':
      return SELF;
    case 'invalid':
      return INVALID;
    case 'not_found':
      return { ok: false, message: 'That access has ended or changed meanwhile. Reload the page, then give Pro again if needed.' };
    case 'too_long':
      return { ok: false, message: `That would end more than a year from today. The latest possible end is ${DAY_FORMAT.format(result.latest)}; for longer, give Pro with no end date.` };
    default:
      log.info('admin.grant_extended', { userId, days });
      refresh(userId);
      return { ok: true, message: `Extended by ${days} days, until ${DAY_FORMAT.format(result.endsAt)}.` };
  }
}

export async function endAccess(input: { userId: string; grantId: string }): Promise<ActionResult> {
  const admin = await currentAdmin();
  if (!admin) return DENIED;
  const parsed = z.object({ userId: UserId, grantId: UserId }).safeParse(input);
  if (!parsed.success) return INVALID;
  if (await ownersAccount(admin.id, parsed.data.userId)) return OWNER;
  const result = await revokeGrant(getDb(), { userId: toObjectId(parsed.data.userId)!, grantId: parsed.data.grantId, actor: `admin:${admin.id.toHexString()}`, actorUserId: admin.id });
  if (result === 'self') return SELF;
  if (result === 'not_found') return { ok: false, message: 'That access had already ended.' };
  refresh(parsed.data.userId);
  return { ok: true, message: 'Access ended.' };
}

/**
 * Back to Free from manual Pro, in one step: Pro with no end date and every
 * live Pro for a time end (each audited as usual). A paid subscription and
 * the admin role are never touched, so either still gives what it gives.
 */
export async function endManualPro(input: { userId: string }): Promise<ActionResult> {
  const admin = await currentAdmin();
  if (!admin) return DENIED;
  const parsed = z.object({ userId: UserId }).safeParse(input);
  if (!parsed.success) return INVALID;
  if (await ownersAccount(admin.id, parsed.data.userId)) return OWNER;
  const db = getDb();
  const userId = toObjectId(parsed.data.userId)!;
  const actor = `admin:${admin.id.toHexString()}`;
  const plan = await setUserPlan(db, { userId, plan: 'free', actor, actorUserId: admin.id });
  if (plan.status === 'not_found') return { ok: false, message: 'That account no longer exists.' };
  if (plan.status === 'self') return SELF;
  const live = await collections(db).accessGrants.find({ userId, ...liveGrantFilter(new Date()) }, { projection: { _id: 1 } }).toArray();
  let ended = 0;
  for (const grant of live) if ((await revokeGrant(db, { userId, grantId: grant._id!.toHexString(), actor, actorUserId: admin.id })) === 'revoked') ended += 1;
  const noEndDate = plan.status === 'updated';
  if (!noEndDate && ended === 0) return { ok: true, message: 'They have no manual Pro to end.' };
  log.info('admin.manual_pro_ended', { userId: parsed.data.userId, noEndDate, ended });
  refresh(parsed.data.userId);
  const what = [noEndDate ? 'Pro with no end date' : null, ended ? `${ended === 1 ? 'Pro for a time' : `${ended} grants of Pro for a time`}` : null].filter(Boolean).join(' and ');
  return { ok: true, message: `Ended: ${what}. A paid subscription, if they have one, is unchanged.` };
}

const NewTesterInput = z.object({
  username: z.string().max(60),
  name: z.string().max(200).optional(),
  plan: z.enum(PLAN_IDS),
  locale: z.enum(LOCALES),
  test: z.boolean(),
});

const USERNAME_PROBLEMS = {
  too_short: 'Use at least 3 characters for the username.',
  too_long: 'Use at most 30 characters for the username.',
  invalid: 'Usernames use English letters, digits, dots and underscores only.',
  name: 'Choose a display name with at least one visible character (up to 80).',
} as const;

/** Create a username account for a tester; the reply holds its password, once. */
export async function createTester(input: { username: string; name?: string; plan: string; locale: string; test: boolean }): Promise<PasswordResult> {
  const admin = await currentAdmin();
  if (!admin) return DENIED;
  const parsed = NewTesterInput.safeParse(input);
  if (!parsed.success) return INVALID;
  if (!usernamePasswordAvailable()) return { ok: false, message: 'Username sign-in is off on this server (AUTH_USERNAME_PASSWORD), so a username account could not sign in.' };

  const db = getDb();
  const { username, name, plan, locale, test } = parsed.data;
  const result = await createUsernameAccount(db, getAuth(), { username: username!, name, plan: plan!, locale: locale!, test: test === true, actor: `admin:${admin.id.toHexString()}` });
  switch (result.status) {
    case 'invalid':
      return { ok: false, message: USERNAME_PROBLEMS[result.problem] };
    case 'exists':
      return { ok: false, message: 'That username is taken. Nothing was changed; choose another, or open that account to reset its password.' };
    case 'conflict':
      return { ok: false, message: 'That username cannot be used. Choose another.' };
    default: {
      const userId = result.userId.toHexString();
      log.info('admin.account_created', { userId, plan: parsed.data.plan });
      revalidatePath('/admin');
      return { ok: true, message: `Account ${result.username} created.`, credentials: { userId, username: result.username, password: result.password } };
    }
  }
}

/** Give a username account a new password (the reply holds it, once) and sign it out everywhere. */
export async function resetPassword(input: { userId: string }): Promise<PasswordResult> {
  const admin = await currentAdmin();
  if (!admin) return DENIED;
  const parsed = z.object({ userId: UserId }).safeParse(input);
  if (!parsed.success) return INVALID;
  if (await ownersAccount(admin.id, parsed.data.userId)) return OWNER;
  if (!signedInRecently(admin.signedInAt)) return REAUTH;

  const userId = toObjectId(parsed.data.userId)!;
  const result = await resetUsernamePassword(getDb(), getAuth(), { userId, actor: `admin:${admin.id.toHexString()}` });
  if (result.status === 'not_found') return { ok: false, message: 'That account no longer exists.' };
  if (result.status === 'not_username_account') return { ok: false, message: 'Only accounts that sign in with a username have a password an admin can reset.' };
  const user = await collections(getDb()).users.findOne({ _id: userId }, { projection: { username: 1, displayUsername: 1 } });
  log.info('admin.password_reset', { userId: parsed.data.userId, sessionsEnded: result.sessionsEnded });
  refresh(parsed.data.userId);
  return {
    ok: true,
    message: `New password made. ${result.sessionsEnded === 1 ? 'One session was' : `${result.sessionsEnded} sessions were`} signed out.`,
    credentials: { userId: parsed.data.userId, username: user?.displayUsername || user?.username || '', password: result.password },
  };
}

/** The initial password the server command line made, once (it is removed as it is revealed). */
export async function revealPassword(input: { userId: string }): Promise<PasswordResult> {
  const admin = await currentAdmin();
  if (!admin) return DENIED;
  const parsed = z.object({ userId: UserId }).safeParse(input);
  if (!parsed.success) return INVALID;
  if (await ownersAccount(admin.id, parsed.data.userId)) return OWNER;
  if (!signedInRecently(admin.signedInAt)) return REAUTH;

  const userId = toObjectId(parsed.data.userId)!;
  const result = await revealInitialPassword(getDb(), { userId, actor: `admin:${admin.id.toHexString()}` });
  refresh(parsed.data.userId);
  if (result.status === 'none') return { ok: false, message: 'There is no initial password to reveal any more (it was revealed, replaced or has expired). Reset the password to make a new one.' };
  if (result.status === 'unreadable') return { ok: false, message: 'The initial password could not be read (the server key changed). Reset the password to make a new one.' };
  const user = await collections(getDb()).users.findOne({ _id: userId }, { projection: { username: 1, displayUsername: 1 } });
  log.info('admin.initial_password_revealed', { userId: parsed.data.userId });
  return { ok: true, message: 'Initial password revealed. It is no longer kept on the server.', credentials: { userId: parsed.data.userId, username: user?.displayUsername || user?.username || '', password: result.password } };
}

/** Sign an account out on every device. */
export async function signOutEverywhere(input: { userId: string }): Promise<ActionResult> {
  const admin = await currentAdmin();
  if (!admin) return DENIED;
  const parsed = z.object({ userId: UserId }).safeParse(input);
  if (!parsed.success) return INVALID;
  if (await ownersAccount(admin.id, parsed.data.userId)) return OWNER;
  const result = await endAllSessions(getDb(), { userId: toObjectId(parsed.data.userId)!, actor: `admin:${admin.id.toHexString()}`, actorUserId: admin.id });
  if (result.status === 'not_found') return { ok: false, message: 'That account no longer exists.' };
  if (result.status === 'self') return { ok: false, message: 'To sign yourself out of other devices, use your own account page.' };
  log.info('admin.sessions_revoked', { userId: parsed.data.userId, count: result.count });
  refresh(parsed.data.userId);
  return { ok: true, message: result.count === 0 ? 'No active sessions to end.' : `Signed out everywhere (${result.count} ${result.count === 1 ? 'session' : 'sessions'} ended).` };
}
