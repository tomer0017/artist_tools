'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { PLAN_IDS, PLAN_NAMES } from '@/lib/plans';
import { setTestAccount, setUserPlan, setUserRole, setUserStatus } from '@/server/admin';
import { getDb } from '@/server/db/client';
import { SUSPEND_REASONS, toObjectId, type SuspendReason } from '@/server/db/collections';
import { GRANT_REASONS, MAX_GRANT_DAYS, createGrant, revokeGrant } from '@/server/grants';
import { log } from '@/server/log';
import { currentAdmin, signedInRecently } from '@/server/session';

// Administrator actions. Next.js accepts server actions only from this site's
// own pages (it compares Origin and Host); each action then re-checks, from the
// database, that the caller is an active admin, validates its input and is
// audited by the operation it calls. Nothing here trusts the page that sent it.
// The most sensitive ones (roles, suspensions) also need a sign-in from the
// last 10 minutes, so a stolen or forgotten session cannot use them.

export type ActionResult = { ok: boolean; message: string; reauth?: boolean };

const UserId = z.string().regex(/^[0-9a-f]{24}$/i);
const PlanInput = z.object({ userId: UserId, plan: z.enum(PLAN_IDS) });
const RoleInput = z.object({ userId: UserId, role: z.enum(['user', 'admin']) });

const DENIED: ActionResult = { ok: false, message: 'You are not allowed to do that.' };
const INVALID: ActionResult = { ok: false, message: 'That request was not valid.' };
const REAUTH: ActionResult = { ok: false, reauth: true, message: 'For your security, confirm it is you (sign in again), then repeat this change.' };

function refresh(userId: string) {
  revalidatePath('/admin');
  revalidatePath(`/admin/users/${userId}`);
}

export async function changePlan(input: { userId: string; plan: string }): Promise<ActionResult> {
  const admin = await currentAdmin();
  if (!admin) return DENIED;
  const parsed = PlanInput.safeParse(input);
  if (!parsed.success) return INVALID;

  const { userId, plan } = parsed.data;
  const result = await setUserPlan(getDb(), { userId: toObjectId(userId)!, plan, actor: `admin:${admin.id.toHexString()}` });
  if (result.status === 'not_found') return { ok: false, message: 'That account no longer exists.' };
  if (result.status === 'unchanged') return { ok: true, message: `Already on ${PLAN_NAMES[plan]}.` };
  log.info('admin.plan_changed', { userId, from: result.from, to: result.to });
  refresh(userId);
  return { ok: true, message: `Plan changed to ${PLAN_NAMES[plan]}.` };
}

export async function changeRole(input: { userId: string; role: string }): Promise<ActionResult> {
  const admin = await currentAdmin();
  if (!admin) return DENIED;
  const parsed = RoleInput.safeParse(input);
  if (!parsed.success) return INVALID;
  if (!signedInRecently(admin.signedInAt)) return REAUTH;

  const { userId, role } = parsed.data;
  const result = await setUserRole(getDb(), { userId: toObjectId(userId)!, role, actor: `admin:${admin.id.toHexString()}`, actorUserId: admin.id });
  switch (result) {
    case 'not_found':
      return { ok: false, message: 'That account no longer exists.' };
    case 'self':
      return { ok: false, message: 'You cannot remove your own admin access.' };
    case 'last_admin':
      return { ok: false, message: 'This is the last admin. Make someone else an admin first.' };
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
  const result = await setTestAccount(getDb(), { userId: toObjectId(parsed.data.userId)!, test: parsed.data.test, actor: `admin:${admin.id.toHexString()}` });
  if (result === 'not_found') return { ok: false, message: 'That account no longer exists.' };
  refresh(parsed.data.userId);
  return { ok: true, message: parsed.data.test ? 'Marked as a test account: left out of analytics.' : 'No longer a test account.' };
}

const GrantInput = z.object({
  userId: UserId,
  planId: z.enum(PLAN_IDS),
  days: z.number().int().min(1).max(MAX_GRANT_DAYS),
  reason: z.enum(GRANT_REASONS as [string, ...string[]]),
});

export async function giveAccess(input: { userId: string; planId: string; days: number; reason: string }): Promise<ActionResult> {
  const admin = await currentAdmin();
  if (!admin) return DENIED;
  const parsed = GrantInput.safeParse(input);
  if (!parsed.success) return INVALID;
  const { userId, planId, days, reason } = parsed.data;
  const result = await createGrant(getDb(), { userId: toObjectId(userId)!, planId, days, reason: reason as (typeof GRANT_REASONS)[number], actor: `admin:${admin.id.toHexString()}` });
  if (result.status === 'not_found') return { ok: false, message: 'That account no longer exists.' };
  if (result.status === 'invalid') return INVALID;
  log.info('admin.grant_created', { userId, planId, days });
  refresh(userId);
  return { ok: true, message: `${PLAN_NAMES[planId]} given for ${days} ${days === 1 ? 'day' : 'days'}. It ends on its own.` };
}

export async function endAccess(input: { userId: string; grantId: string }): Promise<ActionResult> {
  const admin = await currentAdmin();
  if (!admin) return DENIED;
  const parsed = z.object({ userId: UserId, grantId: UserId }).safeParse(input);
  if (!parsed.success) return INVALID;
  const result = await revokeGrant(getDb(), { userId: toObjectId(parsed.data.userId)!, grantId: parsed.data.grantId, actor: `admin:${admin.id.toHexString()}` });
  if (result === 'not_found') return { ok: false, message: 'That access had already ended.' };
  refresh(parsed.data.userId);
  return { ok: true, message: 'Access ended.' };
}
