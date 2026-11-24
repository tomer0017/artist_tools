'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { TIP_ID } from '@/lib/companion/model';
import { getDb } from '@/server/db/client';
import {
  duplicateTip,
  moveTip,
  restoreCompanionVersion,
  saveAccess,
  saveSettings,
  saveTip,
  setTipArchived,
  type CompanionEditResult,
} from '@/server/companion/editor';
import { log } from '@/server/log';
import { currentAdmin } from '@/server/session';

// Admin → Companion's actions (ADR-0024). Each re-checks the administrator
// (and their second factor) from the database, validates what it is sent on
// the server, and publishes through src/server/companion/editor.ts: the
// change is live when this returns "saved", kept in the configuration's
// history and the activity log. Studios follow on their next account check
// (within a minute) or at once on their next page.

export interface CompanionActionResult {
  ok: boolean;
  message: string;
  id?: string | null;
  version?: number;
  issues?: string[];
  conflict?: boolean;
}

const DENIED: CompanionActionResult = { ok: false, message: 'You are not allowed to do that.' };
const INVALID: CompanionActionResult = { ok: false, message: 'That request was not valid.' };
const Id = z.string().regex(TIP_ID);

function answer(result: CompanionEditResult): CompanionActionResult {
  if (result.status === 'saved') {
    revalidatePath('/admin/companion');
    log.info('admin.companion_saved', { tipId: result.id, version: result.version });
    return { ok: true, message: `${result.message} · live now (version ${result.version})`, id: result.id, version: result.version };
  }
  if (result.status === 'not_found') return { ok: false, message: 'That tip is not in the live configuration any more. Refresh the page.' };
  if (result.status === 'conflict') return { ok: false, conflict: true, message: result.message };
  if (result.status === 'blocked') return { ok: false, message: result.message };
  return { ok: false, message: result.issues.length === 1 ? result.issues[0] : 'Not saved: see what is missing below.', issues: result.issues };
}

async function run(work: (db: ReturnType<typeof getDb>, actor: string) => Promise<CompanionEditResult>): Promise<CompanionActionResult> {
  const admin = await currentAdmin();
  if (!admin) return DENIED;
  try {
    return answer(await work(getDb(), `admin:${admin.id.toHexString()}`));
  } catch (error) {
    log.error('admin.companion_save_failed', { error });
    return { ok: false, message: 'Not saved: something went wrong on the server. Nothing was changed; try again.' };
  }
}

export async function saveCompanionSettings(input: unknown): Promise<CompanionActionResult> {
  return run((db, actor) => saveSettings(db, actor, input));
}

export async function saveCompanionAccess(input: unknown): Promise<CompanionActionResult> {
  return run((db, actor) => saveAccess(db, actor, input));
}

export async function saveCompanionTip(input: { id: string | null; baseHash?: string; fields: unknown }): Promise<CompanionActionResult> {
  if (input?.id !== null && !Id.safeParse(input?.id).success) return INVALID;
  if (input.id !== null && typeof input.baseHash !== 'string') return INVALID;
  return run((db, actor) => saveTip(db, actor, { id: input.id, baseHash: input.baseHash, fields: input.fields }));
}

export async function duplicateCompanionTip(input: { id: string }): Promise<CompanionActionResult> {
  const parsed = z.object({ id: Id }).safeParse(input);
  if (!parsed.success) return INVALID;
  return run((db, actor) => duplicateTip(db, actor, { id: parsed.data.id! }));
}

export async function archiveCompanionTip(input: { id: string; archived: boolean }): Promise<CompanionActionResult> {
  const parsed = z.object({ id: Id, archived: z.boolean() }).safeParse(input);
  if (!parsed.success) return INVALID;
  return run((db, actor) => setTipArchived(db, actor, { id: parsed.data.id!, archived: parsed.data.archived! }));
}

export async function moveCompanionTip(input: { id: string; direction: 'up' | 'down' }): Promise<CompanionActionResult> {
  const parsed = z.object({ id: Id, direction: z.enum(['up', 'down']) }).safeParse(input);
  if (!parsed.success) return INVALID;
  return run((db, actor) => moveTip(db, actor, { id: parsed.data.id!, direction: parsed.data.direction! }));
}

export async function restoreCompanionVersionAction(input: { version: number }): Promise<CompanionActionResult> {
  const parsed = z.object({ version: z.number().int().min(1) }).safeParse(input);
  if (!parsed.success) return INVALID;
  return run((db, actor) => restoreCompanionVersion(db, actor, { version: parsed.data.version! }));
}
