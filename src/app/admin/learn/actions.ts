'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { accessModeOf, legacyLearnOf } from '@/lib/learn/access';
import { ACCESS_MODES, ITEM_ID, itemImages, type AccessMode, type LearnItem } from '@/lib/learn/model';
import { getDb } from '@/server/db/client';
import { getPlanStates } from '@/server/entitlements';
import {
  createItem,
  duplicateItem,
  itemForEdit,
  itemHistory,
  moveItem,
  parseFields,
  previewVersionRestore,
  restoreItemCopy,
  restoreVersion,
  saveItem,
  setAccess,
  setArchived,
  type EditResult,
  type ItemHistoryEntry,
} from '@/server/learn/editor';
import { assetsFor } from '@/server/learn/present';
import { log } from '@/server/log';
import { currentAdmin } from '@/server/session';

// Admin → Learn's actions (ADR-0023). Each re-checks the administrator
// (and their second factor) from the database, validates what it is sent on
// the server, and publishes through src/server/learn/editor.ts: the change is
// live when this returns "saved", recorded in the content's history and the
// activity log.

export interface LearnActionResult {
  ok: boolean;
  message: string;
  /** The item saved (a new one's ID). */
  id?: string;
  version?: number;
  /** What stops it, in words (the form shows them). */
  issues?: string[];
  /** The item changed since the editor opened it: the form keeps what was typed. */
  conflict?: boolean;
}

const DENIED: LearnActionResult = { ok: false, message: 'You are not allowed to do that.' };
const INVALID: LearnActionResult = { ok: false, message: 'That request was not valid.' };
const Id = z.string().regex(ITEM_ID);

async function session() {
  const admin = await currentAdmin();
  if (!admin) return null;
  const db = getDb();
  return { db, actor: `admin:${admin.id.toHexString()}`, legacy: legacyLearnOf(await getPlanStates(db)) };
}

/** Saved: say so and refresh the page; otherwise what stopped it. */
function answer(result: EditResult): LearnActionResult {
  if (result.status === 'saved') {
    revalidatePath('/admin/learn');
    log.info('admin.learn_saved', { itemId: result.id, version: result.version });
    return { ok: true, message: `${result.message} · live now (version ${result.version})`, id: result.id, version: result.version };
  }
  if (result.status === 'not_found') return { ok: false, message: 'That item is not in the live content any more. Refresh the page.' };
  if (result.status === 'conflict') return { ok: false, conflict: true, message: result.message };
  if (result.status === 'blocked') return { ok: false, message: result.message };
  return { ok: false, message: result.issues.length === 1 ? result.issues[0] : 'Not saved: see what is missing below.', issues: result.issues };
}

async function run(work: (s: NonNullable<Awaited<ReturnType<typeof session>>>) => Promise<EditResult>): Promise<LearnActionResult> {
  const s = await session();
  if (!s) return DENIED;
  try {
    return answer(await work(s));
  } catch (error) {
    log.error('admin.learn_save_failed', { error });
    return { ok: false, message: 'Not saved: something went wrong on the server. Nothing was changed; try again.' };
  }
}

export async function saveLearnItem(input: { id: string | null; kind: string; collection?: string; baseHash?: string; fields: unknown }): Promise<LearnActionResult> {
  const data = parseFields(input?.kind, input?.collection, input?.fields);
  if ('issues' in data) return { ...INVALID, issues: data.issues };
  if (input.id === null) return run(({ db, actor }) => createItem(db, actor, { data }));
  const id = Id.safeParse(input.id);
  if (!id.success || typeof input.baseHash !== 'string') return INVALID;
  return run(({ db, actor, legacy }) => saveItem(db, actor, { id: id.data, baseHash: input.baseHash!, data, legacy }));
}

export async function setLearnAccess(input: { id: string; access: string }): Promise<LearnActionResult> {
  const parsed = z.object({ id: Id, access: z.enum(ACCESS_MODES) }).safeParse(input);
  if (!parsed.success) return INVALID;
  return run(({ db, actor, legacy }) => setAccess(db, actor, { id: parsed.data.id!, access: parsed.data.access!, legacy }));
}

export async function archiveLearnItem(input: { id: string; archived: boolean }): Promise<LearnActionResult> {
  const parsed = z.object({ id: Id, archived: z.boolean() }).safeParse(input);
  if (!parsed.success) return INVALID;
  return run(({ db, actor, legacy }) => setArchived(db, actor, { id: parsed.data.id!, archived: parsed.data.archived!, legacy }));
}

export async function duplicateLearnItem(input: { id: string }): Promise<LearnActionResult> {
  const parsed = z.object({ id: Id }).safeParse(input);
  if (!parsed.success) return INVALID;
  return run(({ db, actor }) => duplicateItem(db, actor, { id: parsed.data.id! }));
}

export async function moveLearnItem(input: { id: string; direction: string }): Promise<LearnActionResult> {
  const parsed = z.object({ id: Id, direction: z.enum(['up', 'down']) }).safeParse(input);
  if (!parsed.success) return INVALID;
  return run(({ db, actor }) => moveItem(db, actor, { id: parsed.data.id!, direction: parsed.data.direction! }));
}

export async function restoreLearnItem(input: { id: string; version: number }): Promise<LearnActionResult> {
  const parsed = z.object({ id: Id, version: z.number().int().min(1) }).safeParse(input);
  if (!parsed.success) return INVALID;
  return run(({ db, actor }) => restoreItemCopy(db, actor, { id: parsed.data.id!, version: parsed.data.version! }));
}

export async function restoreLearnVersion(input: { version: number }): Promise<LearnActionResult> {
  const parsed = z.object({ version: z.number().int().min(1) }).safeParse(input);
  if (!parsed.success) return INVALID;
  return run(({ db, actor }) => restoreVersion(db, actor, { version: parsed.data.version! }));
}

export async function previewLearnRestore(input: { version: number }): Promise<{ ok: boolean; message?: string; changes?: string[] }> {
  const s = await session();
  if (!s) return { ok: false, message: DENIED.message };
  const parsed = z.object({ version: z.number().int().min(1) }).safeParse(input);
  if (!parsed.success) return { ok: false, message: INVALID.message };
  const preview = await previewVersionRestore(s.db, parsed.data.version!);
  return 'problem' in preview ? { ok: false, message: preview.problem } : { ok: true, changes: preview.changes };
}

export interface ImageInfo {
  thumbnailAssetId: string | null;
  width: number | null;
  height: number | null;
  contentType: string | null;
}

export interface LoadedItem {
  item: LearnItem;
  /** Its access now (its own mode, or what the old plan rules give an item without one). */
  access: AccessMode;
  hash: string;
  version: number | null;
  /** What the editor shows of each picture and sheet it uses. */
  images: Record<string, ImageInfo>;
  history: ItemHistoryEntry[];
}

/** An item as stored, to edit: with its fingerprint (for "changed since you opened it"), its pictures and its history. */
export async function loadLearnItem(input: { id: string }): Promise<{ ok: true; loaded: LoadedItem } | { ok: false; message: string }> {
  const s = await session();
  if (!s) return { ok: false, message: DENIED.message };
  const parsed = z.object({ id: Id }).safeParse(input);
  if (!parsed.success) return { ok: false, message: INVALID.message };
  const found = await itemForEdit(s.db, parsed.data.id!);
  if (!found) return { ok: false, message: 'That item is not in the live content. Refresh the page.' };
  const ids = itemImages(found.item).map((ref) => ref.assetId);
  if (found.item.kind === 'exercise' && found.item.worksheet.kind === 'static') ids.push(found.item.worksheet.assetId);
  const assets = await assetsFor(s.db, ids);
  const images = Object.fromEntries(
    ids.map((id) => {
      const doc = assets.get(id);
      return [id, { thumbnailAssetId: doc?.thumbnailAssetId ?? null, width: doc?.width ?? null, height: doc?.height ?? null, contentType: doc?.contentType ?? null }];
    }),
  );
  return { ok: true, loaded: { ...found, access: accessModeOf(found.item, s.legacy), images, history: await itemHistory(s.db, parsed.data.id!) } };
}
