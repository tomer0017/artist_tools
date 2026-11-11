'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { catalogSpec } from '@/server/config/catalog';
import { pricingSpec } from '@/server/config/pricing';
import { discardDraft, getPublished, publishDraft, restoreAsDraft, saveDraft, type ConfigSpec } from '@/server/config/versions';
import { createCoupon, setCouponStatus } from '@/server/coupons';
import { getDb } from '@/server/db/client';
import { toObjectId } from '@/server/db/collections';
import { log } from '@/server/log';
import { currentAdmin, signedInRecently } from '@/server/session';
import type { ActionResult } from './actions';

// Admin actions on configuration (plan catalog, prices) and coupons. Same
// rules as ./actions.ts: the admin is re-checked from the database, input is
// validated on the server, everything is audited by the operation it calls.
// Publishing a version needs a sign-in from the last 10 minutes.

const DENIED: ActionResult = { ok: false, message: 'You are not allowed to do that.' };
const REAUTH: ActionResult = { ok: false, reauth: true, message: 'For your security, confirm it is you (sign in again), then publish.' };

const specs = { catalog: catalogSpec, pricing: pricingSpec } as const;
const Kind = z.enum(['catalog', 'pricing']);
const pathOf = (kind: keyof typeof specs) => (kind === 'catalog' ? '/admin/plans' : '/admin/pricing');

export async function startDraft(input: { kind: string }): Promise<ActionResult> {
  const admin = await currentAdmin();
  if (!admin) return DENIED;
  const kind = Kind.safeParse(input.kind);
  if (!kind.success) return { ok: false, message: 'That request was not valid.' };
  const spec = specs[kind.data] as ConfigSpec<unknown>;
  const published = await getPublished(getDb(), spec);
  const result = await saveDraft(getDb(), spec, published?.document ?? spec.defaults(), `admin:${admin.id.toHexString()}`);
  revalidatePath(pathOf(kind.data));
  return result.status === 'saved' ? { ok: true, message: `Draft version ${result.version} started from what is live.` } : { ok: false, message: result.issues.join('; ') };
}

export async function saveConfigDraft(input: { kind: string; document: unknown; note?: string }): Promise<ActionResult> {
  const admin = await currentAdmin();
  if (!admin) return DENIED;
  const kind = Kind.safeParse(input.kind);
  if (!kind.success) return { ok: false, message: 'That request was not valid.' };
  const note = typeof input.note === 'string' ? input.note.trim().slice(0, 200) || null : null;
  const result = await saveDraft(getDb(), specs[kind.data] as ConfigSpec<unknown>, input.document, `admin:${admin.id.toHexString()}`, note);
  revalidatePath(pathOf(kind.data));
  if (result.status === 'invalid') return { ok: false, message: `Not saved: ${result.issues.slice(0, 3).join('; ')}` };
  return { ok: true, message: `Draft version ${result.version} saved. Nothing changes until you publish it.` };
}

export async function discardConfigDraft(input: { kind: string }): Promise<ActionResult> {
  const admin = await currentAdmin();
  if (!admin) return DENIED;
  const kind = Kind.safeParse(input.kind);
  if (!kind.success) return { ok: false, message: 'That request was not valid.' };
  const discarded = await discardDraft(getDb(), kind.data, `admin:${admin.id.toHexString()}`);
  revalidatePath(pathOf(kind.data));
  return { ok: true, message: discarded ? 'Draft discarded.' : 'There was no draft.' };
}

export async function publishConfig(input: { kind: string }): Promise<ActionResult> {
  const admin = await currentAdmin();
  if (!admin) return DENIED;
  const kind = Kind.safeParse(input.kind);
  if (!kind.success) return { ok: false, message: 'That request was not valid.' };
  if (!signedInRecently(admin.signedInAt)) return REAUTH;
  const result = await publishDraft(getDb(), specs[kind.data] as ConfigSpec<unknown>, `admin:${admin.id.toHexString()}`);
  revalidatePath(pathOf(kind.data));
  if (result.status === 'no_draft') return { ok: false, message: 'There is no draft to publish.' };
  if (result.status === 'invalid') return { ok: false, message: `Not published: ${result.issues.slice(0, 3).join('; ')}` };
  log.info('admin.config_published', { kind: kind.data, version: result.version });
  return { ok: true, message: `Version ${result.version} is live.` };
}

export async function restoreConfig(input: { kind: string; version: number }): Promise<ActionResult> {
  const admin = await currentAdmin();
  if (!admin) return DENIED;
  const parsed = z.object({ kind: Kind, version: z.number().int().min(1) }).safeParse(input);
  if (!parsed.success) return { ok: false, message: 'That request was not valid.' };
  const result = await restoreAsDraft(getDb(), specs[parsed.data.kind] as ConfigSpec<unknown>, parsed.data.version, `admin:${admin.id.toHexString()}`);
  revalidatePath(pathOf(parsed.data.kind));
  if (result.status === 'not_found') return { ok: false, message: 'That version does not exist.' };
  if (result.status === 'invalid') return { ok: false, message: result.issues.join('; ') };
  return { ok: true, message: `Draft version ${result.version} holds version ${parsed.data.version}'s settings. Publish it to go back.` };
}

export async function addCoupon(input: Record<string, unknown>): Promise<ActionResult> {
  const admin = await currentAdmin();
  if (!admin) return DENIED;
  const date = (value: unknown) => (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T00:00:00Z`) : null);
  const result = await createCoupon(
    getDb(),
    { ...input, startsAt: date(input.startsAt) ?? new Date(), endsAt: date(input.endsAt) },
    `admin:${admin.id.toHexString()}`,
  );
  revalidatePath('/admin/coupons');
  if (result.status === 'duplicate') return { ok: false, message: 'That code already exists.' };
  if (result.status === 'invalid') return { ok: false, message: result.issues.slice(0, 3).join('; ') };
  return { ok: true, message: 'Coupon created. It can be used once paid plans launch.' };
}

export async function changeCouponStatus(input: { couponId: string; status: string }): Promise<ActionResult> {
  const admin = await currentAdmin();
  if (!admin) return DENIED;
  const parsed = z.object({ couponId: z.string().regex(/^[0-9a-f]{24}$/i), status: z.enum(['active', 'disabled']) }).safeParse(input);
  if (!parsed.success) return { ok: false, message: 'That request was not valid.' };
  const changed = await setCouponStatus(getDb(), toObjectId(parsed.data.couponId)!, parsed.data.status, `admin:${admin.id.toHexString()}`);
  revalidatePath('/admin/coupons');
  return { ok: true, message: changed ? (parsed.data.status === 'active' ? 'Coupon switched on.' : 'Coupon switched off.') : 'Nothing to change.' };
}
