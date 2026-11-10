'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { PLAN_IDS, PLAN_NAMES } from '@/lib/plans';
import { setUserPlan, setUserRole } from '@/server/admin';
import { getDb } from '@/server/db/client';
import { toObjectId } from '@/server/db/collections';
import { log } from '@/server/log';
import { currentAdmin } from '@/server/session';

// Administrator actions. Next.js accepts server actions only from this site's
// own pages (it compares Origin and Host); each action then re-checks, from the
// database, that the caller is an active admin, validates its input and is
// audited by the operation it calls. Nothing here trusts the page that sent it.

export type ActionResult = { ok: boolean; message: string };

const UserId = z.string().regex(/^[0-9a-f]{24}$/i);
const PlanInput = z.object({ userId: UserId, plan: z.enum(PLAN_IDS) });
const RoleInput = z.object({ userId: UserId, role: z.enum(['user', 'admin']) });

const DENIED: ActionResult = { ok: false, message: 'You are not allowed to do that.' };
const INVALID: ActionResult = { ok: false, message: 'That request was not valid.' };

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
