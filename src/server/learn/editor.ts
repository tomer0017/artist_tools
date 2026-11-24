import 'server-only';
import { createHash } from 'node:crypto';
import type { Db } from 'mongodb';
import { z } from 'zod';
import { TOOL_IDS } from '@/lib/account';
import { accessModeOf, type LegacyLearn } from '@/lib/learn/access';
import {
  ACCESS_LABELS,
  ACCESS_MODES,
  ASSET_ID,
  CHALLENGE_ID,
  CHALLENGE_LEVELS,
  EXERCISE_ID,
  GROUP_ID,
  MEDIUMS,
  REFERENCE_KINDS,
  UNIT_LEVELS,
  emptyContent,
  itemsOf,
  publishedFlagFor,
  type AccessMode,
  type LearnChallenge,
  type LearnCollection,
  type LearnContent,
  type LearnExercise,
  type LearnItem,
} from '@/lib/learn/model';
import { endOfGroup, moveWithinGroup, placeAfter, type Placed } from '@/lib/learn/placement';
import { recordAudit } from '@/server/audit';
import { getDraft, getPublished, publishIfUnchanged } from '@/server/config/versions';
import { collections } from '@/server/db/collections';
import { LearnContentSchema, changedFields, describeContentChanges, everUsedIds, learnContentSpec } from './content';

// ─── Admin → Learn's editor (ADR-0023) ────────────────────────────────────────
// Every change an admin makes to a lesson or challenge — its text, pictures,
// group, place, access, a new item, a copy, archiving, a restore — is
// published at once as a new version of the Learn content, through the same
// guarded step operator tools use (publishIfUnchanged): what is live is read,
// the one change is applied to it, everything is checked as for any
// publication, and the new version replaces the live one only if nothing was
// published meanwhile. If something was, the change is applied again to the
// newer content (a save to another item merges by itself); if this very item
// changed since the admin opened it, nothing is written and their typed text
// stays in the form. Every version is kept: an item's history lists the
// versions that changed it, and any of them can be restored. While an
// imported draft waits for review, nothing is saved from here.

export type EditResult =
  | { status: 'saved'; version: number; id: string; message: string }
  /** The item changed since the editor opened it: nothing was written. */
  | { status: 'conflict'; message: string }
  | { status: 'invalid'; issues: string[] }
  /** Saving is paused (an imported draft waits, or the live content cannot be read). */
  | { status: 'blocked'; message: string }
  | { status: 'not_found' };

/** A fingerprint of an item as stored, to tell whether it changed since an editor opened it. */
export const itemHash = (item: unknown): string => createHash('sha256').update(JSON.stringify(item)).digest('base64url').slice(0, 22);

// ─── What the editor form sends ───────────────────────────────────────────────

const Text = z.string().max(4000);
const Loc = z.object({ en: Text, he: Text }).strict();
const Ref = z.object({ assetId: z.string().regex(ASSET_ID), alt: Loc, credit: Loc.optional() }).strict();
const Tools = z.array(z.enum(TOOL_IDS)).max(TOOL_IDS.length);
const Preset = z.object({ levels: z.number().int().optional(), squint: z.boolean().optional(), columns: z.number().int().optional(), rows: z.number().int().optional() }).strict();
const ToolLink = z.object({ tool: z.enum(TOOL_IDS), label: Loc, preset: Preset.optional() }).strict();
const Step = z.object({ text: Loc, image: Ref.optional(), tool: ToolLink.optional(), worksheet: z.boolean().optional() }).strict();
const Worksheet = z.union([z.object({ kind: z.literal('none') }).strict(), z.object({ kind: z.literal('generated') }).strict(), z.object({ kind: z.literal('static'), assetId: z.string().regex(ASSET_ID) }).strict()]);

export const ExerciseFieldsSchema = z
  .object({
    groupId: z.string().regex(GROUP_ID),
    access: z.enum(ACCESS_MODES),
    title: Loc,
    objective: Loc,
    materials: Loc,
    instruction: Loc,
    guide: Loc.optional(),
    mistake: z.object({ mistake: Loc, fix: Loc, image: Ref.optional() }).strict(),
    success: Loc,
    references: z.array(Ref).max(20),
    worksheet: Worksheet,
    tools: Tools,
    optional: z.boolean().optional(),
    skill: Loc.optional(),
    minutes: z.number().int().min(5).max(120).nullable().optional(),
    demo: z.array(z.object({ image: Ref, caption: Loc }).strict()).max(6).optional(),
    steps: z.array(Step).max(6).optional(),
    create: Loc.optional(),
  })
  .strict();

export const ChallengeFieldsSchema = z
  .object({
    groupId: z.string().regex(GROUP_ID),
    access: z.enum(ACCESS_MODES),
    title: Loc,
    prompt: Loc,
    level: z.enum(CHALLENGE_LEVELS),
    skill: Loc,
    skillArea: z.number().int().min(1).max(10),
    reference: z.enum(REFERENCE_KINDS),
    references: z.array(Ref).max(20),
    medium: z.enum(MEDIUMS),
    quick: z.boolean(),
    tools: Tools,
    lessons: z.array(z.string().regex(EXERCISE_ID)).max(3).optional(),
    focus: Loc.optional(),
    twist: Loc.optional(),
  })
  .strict();

export type ExerciseFields = z.infer<typeof ExerciseFieldsSchema>;
export type ChallengeFields = z.infer<typeof ChallengeFieldsSchema>;

/** A text as the form sends it (zod's inference marks the parts optional while strictNullChecks is off). */
type LocIn = { en?: string; he?: string };
type RefIn = { assetId?: string; alt?: LocIn; credit?: LocIn };

const blank = (text: LocIn | undefined) => !text || (!(text.en ?? '').trim() && !(text.he ?? '').trim());
const trimmed = (text: LocIn | undefined) => ({ en: (text?.en ?? '').trim(), he: (text?.he ?? '').trim() });

/** A picture reference as stored; an empty credit is removed rather than kept empty (an empty one would count as unfinished). */
function tidyRef(ref: RefIn): { assetId: string; alt: { en: string; he: string }; credit?: { en: string; he: string } } {
  return { assetId: ref.assetId ?? '', alt: trimmed(ref.alt), ...(ref.credit && !blank(ref.credit) ? { credit: trimmed(ref.credit) } : {}) };
}

/** The stored item with the form's fields applied: everything the form does not edit (and anything a newer release added) kept. */
function applyExercise(stored: LearnExercise, fields: ExerciseFields): LearnExercise {
  const next: Record<string, unknown> = { ...stored };
  const set = (key: string, value: unknown) => (value === undefined ? delete next[key] : (next[key] = value));
  set('groupId', fields.groupId);
  set('access', fields.access);
  for (const key of ['title', 'objective', 'materials', 'instruction', 'success'] as const) set(key, trimmed(fields[key]));
  for (const key of ['guide', 'skill', 'create'] as const) set(key, blank(fields[key]) ? undefined : trimmed(fields[key]));
  set('mistake', { ...stored.mistake, mistake: trimmed(fields.mistake.mistake), fix: trimmed(fields.mistake.fix), image: fields.mistake.image ? tidyRef(fields.mistake.image) : undefined });
  if (!fields.mistake.image) delete (next.mistake as Record<string, unknown>).image;
  set('references', fields.references.map(tidyRef));
  set('worksheet', fields.worksheet);
  set('tools', [...new Set(fields.tools)]);
  set('optional', fields.optional ? true : undefined);
  set('minutes', fields.minutes ?? undefined);
  set('demo', fields.demo?.length ? fields.demo.map((frame) => ({ image: tidyRef(frame.image), caption: trimmed(frame.caption) })) : undefined);
  set(
    'steps',
    fields.steps?.length
      ? fields.steps.map((step) => ({
          text: trimmed(step.text),
          ...(step.image ? { image: tidyRef(step.image) } : {}),
          ...(step.tool ? { tool: { tool: step.tool.tool, label: trimmed(step.tool.label), ...(step.tool.preset && Object.keys(step.tool.preset).length ? { preset: step.tool.preset } : {}) } } : {}),
          ...(step.worksheet ? { worksheet: true } : {}),
        }))
      : undefined,
  );
  // A lesson's old self-check questions are kept only while it stays a draft (they are never shown, ADR-0020).
  return next as unknown as LearnExercise;
}

function applyChallenge(stored: LearnChallenge, fields: ChallengeFields): LearnChallenge {
  const next: Record<string, unknown> = { ...stored };
  const set = (key: string, value: unknown) => (value === undefined ? delete next[key] : (next[key] = value));
  set('groupId', fields.groupId);
  set('access', fields.access);
  for (const key of ['title', 'prompt', 'skill'] as const) set(key, trimmed(fields[key]));
  for (const key of ['focus', 'twist'] as const) set(key, blank(fields[key]) ? undefined : trimmed(fields[key]));
  set('level', fields.level);
  set('skillArea', fields.skillArea);
  set('reference', fields.reference);
  set('references', fields.references.map(tidyRef));
  set('medium', fields.medium);
  set('quick', fields.quick);
  set('tools', [...new Set(fields.tools)]);
  set('lessons', fields.lessons?.length ? [...new Set(fields.lessons)] : undefined);
  return next as unknown as LearnChallenge;
}

// ─── Reading the live content ──────────────────────────────────────────────────

interface Live {
  content: LearnContent;
  version: number | null;
}

async function readLive(db: Db): Promise<Live | { blocked: string }> {
  if (await getDraft(db, learnContentSpec)) {
    return { blocked: 'An imported draft is waiting for review below. Publish or discard it first; until then nothing is saved from the tables.' };
  }
  const published = await getPublished(db, learnContentSpec);
  if (!published) return { content: emptyContent(), version: null };
  const parsed = LearnContentSchema.safeParse(published.document);
  if (!parsed.success) return { blocked: `The live content (version ${published.version}) cannot be read by this version of the app, so nothing can be saved here.` };
  return { content: parsed.data as LearnContent, version: published.version };
}

const findItem = (content: LearnContent, id: string): LearnItem | undefined => itemsOf(content).find((item) => item.id === id);

/** Put an item's new values back in the content (the item keeps its kind's own list). */
function replaceItem(content: LearnContent, item: LearnItem): void {
  const { kind, ...rest } = item;
  if (kind === 'exercise') {
    const at = content.exercises.findIndex((e) => e.id === item.id);
    const value = rest as unknown as LearnExercise;
    if (at >= 0) content.exercises[at] = value;
    else content.exercises.push(value);
  } else {
    const { collection: _collection, ...challenge } = rest as unknown as LearnChallenge & { collection: 'challenges' };
    const at = content.challenges.findIndex((c) => c.id === item.id);
    if (at >= 0) content.challenges[at] = challenge;
    else content.challenges.push(challenge);
  }
}

/** Every item with its place, for the placement rules: archived items do not count (they are not in the tables' order), except `keep`. */
const placedOf = (content: LearnContent, keep: string | null = null): Placed[] =>
  itemsOf(content)
    .filter((item) => !item.archived || item.id === keep)
    .map(({ id, collection, groupId, order }) => ({ id, collection, groupId, order }));

function applyOrders(content: LearnContent, orders: Map<string, number>): void {
  for (const item of [...content.exercises, ...content.challenges]) {
    const order = orders.get(item.id);
    if (order !== undefined) item.order = order;
  }
}

/** Keep the old flag in step with the mode (ADR-0023). */
function settle<T extends { access?: AccessMode; archived?: boolean; published: boolean }>(item: T, legacy: LegacyLearn, collection: LearnCollection, id: string): T {
  const mode = item.access ?? accessModeOf({ id, collection, published: item.published }, legacy);
  return { ...item, access: mode, published: publishedFlagFor(mode, item.archived === true) };
}

interface Change {
  content: LearnContent;
  id: string;
  /** The version's note, which each item's history shows. */
  note: string;
  action: string;
  /** For the activity log. */
  extra?: Record<string, string | number | boolean | null>;
}

type Built = Change | Exclude<EditResult, { status: 'saved' }>;

/**
 * Read what is live, apply one change to it, and publish the result if
 * nothing was published meanwhile; otherwise apply it again to the newer
 * content (up to five times).
 */
async function commit(db: Db, actor: string, build: (live: Live) => Built | Promise<Built>): Promise<EditResult> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const live = await readLive(db);
    if ('blocked' in live) return { status: 'blocked', message: live.blocked };
    const built = await build({ content: structuredClone(live.content), version: live.version });
    if ('status' in built) return built;
    const result = await publishIfUnchanged(db, learnContentSpec, built.content, { version: live.version }, actor, built.note, new Date(), { keys: built.id === '*' ? [] : [built.id] });
    if (result.status === 'changed') continue;
    if (result.status === 'draft_exists') return { status: 'blocked', message: 'An imported draft appeared meanwhile: publish or discard it first.' };
    if (result.status === 'invalid') return { status: 'invalid', issues: result.issues };
    await recordAudit(db, { type: 'admin.learn_item_changed', userId: null, actor, metadata: { itemId: built.id, action: built.action, version: result.version, ...(built.extra ?? {}) } });
    return { status: 'saved', version: result.version, id: built.id, message: built.note };
  }
  return { status: 'conflict', message: 'Other changes were being published at the same moment. Nothing was saved; try again.' };
}

// ─── New IDs ───────────────────────────────────────────────────────────────────

/** The next challenge ID never used by any version (CH-115 after CH-114). */
function nextChallengeId(used: Set<string>): string | null {
  let max = 0;
  for (const id of used) if (CHALLENGE_ID.test(id)) max = Math.max(max, Number(id.slice(3)));
  return max >= 999 ? null : `CH-${String(max + 1).padStart(3, '0')}`;
}

/** The next exercise ID with this prefix (D-LINE-05 after D-LINE-04), never used by any version. */
function nextExerciseId(used: Set<string>, letter: 'D' | 'C', code: string): string | null {
  let max = 0;
  const pattern = new RegExp(`^${letter}-${code}-(\\d{2})$`);
  for (const id of used) {
    const match = pattern.exec(id);
    if (match) max = Math.max(max, Number(match[1]));
  }
  return max >= 99 ? null : `${letter}-${code}-${String(max + 1).padStart(2, '0')}`;
}

const codeOf = (id: string) => /^[DC]-([A-Z]{2,8})-\d{2}$/.exec(id)?.[1] ?? null;

/**
 * A new lesson's ID: the code its group's items use (D-VAL-03 in the values
 * unit), or one made from the group's name, never one any version held.
 */
function newExerciseId(content: LearnContent, used: Set<string>, collection: 'curriculum' | 'color', groupId: string, like: string | null): string | null {
  const letter = collection === 'curriculum' ? 'D' : 'C';
  const fromGroup = content.exercises
    .filter((e) => e.groupId === groupId && e.collection === collection)
    .sort((a, b) => b.order - a.order)
    .map((e) => codeOf(e.id))
    .filter((code): code is string => code !== null);
  const fromName = groupId.replace(/[^a-z]/g, '').toUpperCase().slice(0, 8);
  const candidates = [...(like ? [codeOf(like)] : []), ...fromGroup, ...(fromName.length >= 2 ? [fromName] : []), 'NEW', 'MORE', 'EXTRA'];
  for (const code of candidates) {
    if (!code) continue;
    const id = nextExerciseId(used, letter, code);
    if (id) return id;
  }
  return null;
}

// ─── The operations ────────────────────────────────────────────────────────────

/** Why a group cannot hold an item of this collection, if it cannot. */
function groupProblem(content: LearnContent, groupId: string, collection: LearnCollection): string | null {
  const group = content.groups.find((g) => g.id === groupId);
  if (!group) return `the group ${groupId} does not exist`;
  if (group.collection !== collection) return `the group ${groupId} belongs to another collection`;
  return null;
}

const describeAccess = (mode: AccessMode) => ACCESS_LABELS[mode];

export type ItemFields = { kind: 'exercise'; collection: 'curriculum' | 'color'; fields: ExerciseFields } | { kind: 'challenge'; fields: ChallengeFields };

/** Parse what the form sent, for its kind. */
export function parseFields(kind: unknown, collection: unknown, fields: unknown): ItemFields | { issues: string[] } {
  if (kind === 'challenge') {
    const parsed = ChallengeFieldsSchema.safeParse(fields);
    return parsed.success ? { kind, fields: parsed.data } : { issues: parsed.error.issues.map((i) => `${i.path.join('.') || 'form'}: ${i.message}`) };
  }
  if (kind === 'exercise' && (collection === 'curriculum' || collection === 'color')) {
    const parsed = ExerciseFieldsSchema.safeParse(fields);
    return parsed.success ? { kind, collection, fields: parsed.data } : { issues: parsed.error.issues.map((i) => `${i.path.join('.') || 'form'}: ${i.message}`) };
  }
  return { issues: ['the kind of item is not known'] };
}

/** Save an existing item's fields, unless it changed since `baseHash` was read. */
export async function saveItem(db: Db, actor: string, input: { id: string; baseHash: string; data: ItemFields; legacy: LegacyLearn }): Promise<EditResult> {
  return commit(db, actor, ({ content }) => {
    const stored = findItem(content, input.id);
    if (!stored) return { status: 'not_found' };
    if (stored.kind !== input.data.kind) return { status: 'invalid', issues: ['the item is of another kind'] };
    const { kind: _kind, ...storedRaw } = stored;
    if (itemHash(storedRaw) !== input.baseHash) {
      return { status: 'conflict', message: `${input.id} was changed by someone else since you opened it. Your text is still in the form: copy what you need, close it and open the item again.` };
    }
    const problem = groupProblem(content, input.data.fields.groupId, stored.collection);
    if (problem) return { status: 'invalid', issues: [`${input.id}: ${problem}`] };
    const raw =
      input.data.kind === 'exercise'
        ? applyExercise(storedRaw as unknown as LearnExercise, input.data.fields)
        : applyChallenge(storedRaw as unknown as LearnChallenge, input.data.fields);
    const settled = settle(raw, input.legacy, stored.collection, input.id);
    const next = { ...settled, kind: stored.kind } as LearnItem;
    replaceItem(content, next);
    // A new group: the item goes to that group's end.
    if (next.groupId !== stored.groupId) applyOrders(content, placeAfter(placedOf(content, input.id), stored.collection, input.id, endOfGroup(placedOf(content), content.groups, stored.collection, next.groupId, input.id)));
    const fields = changedFields(stored, { ...next, order: stored.order } as LearnItem);
    const accessChanged = accessModeOf(stored, input.legacy) !== settled.access;
    const parts = [...(fields.length ? [fields.join(', ')] : []), ...(accessChanged ? [`access ${describeAccess(accessModeOf(stored, input.legacy))} → ${describeAccess(settled.access!)}`] : [])];
    if (parts.length === 0) return { status: 'invalid', issues: ['Nothing changed.'] };
    return { content, id: input.id, note: `Edited ${input.id}: ${parts.join('; ')}`, action: 'edit', extra: { fields: fields.join(',').slice(0, 300), access: settled.access ?? null } };
  });
}

/** Add a new lesson or challenge from the form: the next free ID, at the end of its group. */
export async function createItem(db: Db, actor: string, input: { data: ItemFields }): Promise<EditResult> {
  const used = await everUsedIds(db);
  return commit(db, actor, ({ content }) => {
    const collection: LearnCollection = input.data.kind === 'challenge' ? 'challenges' : input.data.collection;
    const problem = groupProblem(content, input.data.fields.groupId, collection);
    if (problem) return { status: 'invalid', issues: [problem] };
    for (const item of itemsOf(content)) used.add(item.id);
    const id = input.data.kind === 'challenge' ? nextChallengeId(used) : newExerciseId(content, used, input.data.collection, input.data.fields.groupId, null);
    if (!id) return { status: 'invalid', issues: ['No free ID is left for this group.'] };
    const base = { id, groupId: input.data.fields.groupId, order: 0, published: false, access: input.data.fields.access };
    const raw =
      input.data.kind === 'exercise'
        ? applyExercise({ ...base, collection: input.data.collection, title: { en: '', he: '' }, objective: { en: '', he: '' }, materials: { en: '', he: '' }, instruction: { en: '', he: '' }, mistake: { mistake: { en: '', he: '' }, fix: { en: '', he: '' } }, success: { en: '', he: '' }, references: [], worksheet: { kind: 'none' }, tools: [] }, input.data.fields)
        : applyChallenge({ ...base, title: { en: '', he: '' }, prompt: { en: '', he: '' }, level: 'beginner', skill: { en: '', he: '' }, skillArea: 1, reference: 'memory', references: [], medium: 'pencil', quick: false, tools: [] }, input.data.fields);
    const settled = settle(raw, { free: null, pro: null }, collection, id);
    replaceItem(content, { ...settled, kind: input.data.kind, ...(input.data.kind === 'challenge' ? { collection: 'challenges' } : {}) } as LearnItem);
    applyOrders(content, placeAfter(placedOf(content), collection, id, endOfGroup(placedOf(content), content.groups, collection, settled.groupId, id)));
    return { content, id, note: `Added ${id} (${describeAccess(settled.access!)})`, action: 'create', extra: { access: settled.access ?? null } };
  });
}

/** Change only an item's access mode. */
export async function setAccess(db: Db, actor: string, input: { id: string; access: AccessMode; legacy: LegacyLearn }): Promise<EditResult> {
  return commit(db, actor, ({ content }) => {
    const stored = findItem(content, input.id);
    if (!stored) return { status: 'not_found' };
    const before = accessModeOf(stored, input.legacy);
    if (before === input.access && stored.access !== undefined) return { status: 'invalid', issues: [`${input.id} is already ${describeAccess(input.access)}.`] };
    const { kind, ...raw } = stored;
    replaceItem(content, { ...settle({ ...raw, access: input.access }, input.legacy, stored.collection, input.id), kind } as LearnItem);
    return { content, id: input.id, note: `${input.id}: access ${describeAccess(before)} → ${describeAccess(input.access)}`, action: 'access', extra: { from: before, to: input.access } };
  });
}

/** Set several items' access at once (one version): the operator's switch-over, or a bulk change. */
export async function setAccessMany(db: Db, actor: string, input: { ids: string[]; access: AccessMode; legacy: LegacyLearn; note: string }): Promise<EditResult> {
  return commit(db, actor, ({ content }) => {
    const changed: string[] = [];
    for (const id of input.ids) {
      const stored = findItem(content, id);
      if (!stored) return { status: 'invalid', issues: [`${id} is not in the live content`] };
      if (stored.access === input.access) continue;
      const { kind, ...raw } = stored;
      replaceItem(content, { ...settle({ ...raw, access: input.access }, input.legacy, stored.collection, id), kind } as LearnItem);
      changed.push(id);
    }
    if (changed.length === 0) return { status: 'invalid', issues: ['Nothing changed.'] };
    return { content, id: changed[0], note: input.note, action: 'access-many', extra: { to: input.access, count: changed.length } };
  });
}

/** Write each item's mode as it is decided now (the old rules for items without one): access unchanged for everyone. */
export async function writeModes(db: Db, actor: string, input: { legacy: LegacyLearn; note: string }): Promise<EditResult> {
  return commit(db, actor, ({ content }) => {
    const changed: string[] = [];
    for (const item of [...content.exercises, ...content.challenges]) {
      if (item.access !== undefined) continue;
      const collection = 'collection' in item ? item.collection : 'challenges';
      const mode = accessModeOf({ id: item.id, collection, published: item.published }, input.legacy);
      item.access = mode;
      item.published = publishedFlagFor(mode, item.archived === true);
      changed.push(item.id);
    }
    if (changed.length === 0) return { status: 'invalid', issues: ['Every item already has its access mode.'] };
    return { content, id: changed[0], note: input.note, action: 'write-modes', extra: { count: changed.length } };
  });
}

/** Archive an item (deleted, recoverable), or bring it back with the access it had. */
export async function setArchived(db: Db, actor: string, input: { id: string; archived: boolean; legacy: LegacyLearn }): Promise<EditResult> {
  return commit(db, actor, ({ content }) => {
    const stored = findItem(content, input.id);
    if (!stored) return { status: 'not_found' };
    if ((stored.archived === true) === input.archived) return { status: 'invalid', issues: [`${input.id} is ${input.archived ? 'already archived' : 'not archived'}.`] };
    const { kind, ...raw } = stored;
    const next: Record<string, unknown> = { ...raw };
    if (input.archived) next.archived = true;
    else delete next.archived;
    replaceItem(content, { ...settle(next as unknown as LearnExercise, input.legacy, stored.collection, input.id), kind } as LearnItem);
    return input.archived
      ? { content, id: input.id, note: `Archived ${input.id}`, action: 'archive' }
      : { content, id: input.id, note: `Restored ${input.id} from the archive (${describeAccess(accessModeOf(stored, input.legacy))})`, action: 'unarchive' };
  });
}

/** A copy of an item with the next free ID, right after the original, Admin only. */
export async function duplicateItem(db: Db, actor: string, input: { id: string }): Promise<EditResult> {
  const used = await everUsedIds(db);
  return commit(db, actor, ({ content }) => {
    const stored = findItem(content, input.id);
    if (!stored) return { status: 'not_found' };
    for (const item of itemsOf(content)) used.add(item.id);
    const id = stored.kind === 'challenge' ? nextChallengeId(used) : newExerciseId(content, used, stored.collection as 'curriculum' | 'color', stored.groupId, stored.id);
    if (!id) return { status: 'invalid', issues: ['No free ID is left for this group.'] };
    const { kind, ...raw } = structuredClone(stored);
    const copy = { ...raw, id, access: 'admin' as AccessMode, published: false, title: { en: `${raw.title.en} (copy)`.trim(), he: `${raw.title.he} (עותק)`.trim() } } as Record<string, unknown>;
    delete copy.archived;
    replaceItem(content, { ...copy, kind } as unknown as LearnItem);
    applyOrders(content, placeAfter(placedOf(content, stored.id), stored.collection, id, stored.id));
    return { content, id, note: `Added ${id}, a copy of ${input.id} (Admin only)`, action: 'duplicate', extra: { from: input.id } };
  });
}

/** Move an item one place up or down within its group. */
export async function moveItem(db: Db, actor: string, input: { id: string; direction: 'up' | 'down' }): Promise<EditResult> {
  return commit(db, actor, ({ content }) => {
    const stored = findItem(content, input.id);
    if (!stored) return { status: 'not_found' };
    const orders = moveWithinGroup(placedOf(content, input.id), stored.collection, input.id, input.direction);
    if (orders.size === 0) return { status: 'invalid', issues: [`${input.id} is already ${input.direction === 'up' ? 'first' : 'last'} in its group.`] };
    applyOrders(content, orders);
    return { content, id: input.id, note: `Moved ${input.id} ${input.direction}`, action: 'move', extra: { direction: input.direction } };
  });
}

/** Restore an item's texts and pictures from an earlier version; its group, place, access and archive state stay as they are. */
export async function restoreItemCopy(db: Db, actor: string, input: { id: string; version: number }): Promise<EditResult> {
  const source = await collections(db).configVersions.findOne({ kind: 'learn_content', version: input.version, status: { $in: ['published', 'archived'] } });
  if (!source) return { status: 'not_found' };
  const parsed = LearnContentSchema.safeParse(source.document);
  const old = parsed.success ? findItem(parsed.data as LearnContent, input.id) : undefined;
  if (!old) return { status: 'invalid', issues: [`Version ${input.version} has no readable copy of ${input.id}.`] };
  return commit(db, actor, ({ content }) => {
    const stored = findItem(content, input.id);
    if (!stored) return { status: 'not_found' };
    const keep = { id: stored.id, groupId: stored.groupId, order: stored.order, published: stored.published, ...(stored.access !== undefined ? { access: stored.access } : {}), ...(stored.archived ? { archived: true } : {}) };
    const { kind, ...oldRaw } = structuredClone(old);
    const restored = { ...oldRaw, ...keep } as Record<string, unknown>;
    if (!stored.archived) delete restored.archived;
    if (stored.access === undefined) delete restored.access;
    replaceItem(content, { ...restored, kind } as unknown as LearnItem);
    const fields = changedFields(stored, { ...restored, kind } as unknown as LearnItem);
    if (fields.length === 0) return { status: 'invalid', issues: [`${input.id} already reads as in version ${input.version}.`] };
    return { content, id: input.id, note: `Restored ${input.id} from version ${input.version}: ${fields.join(', ')}`, action: 'restore-item', extra: { from: input.version } };
  });
}

/** What restoring a whole earlier version would change, for the confirmation. */
export async function previewVersionRestore(db: Db, version: number): Promise<{ changes: string[] } | { problem: string }> {
  const source = await collections(db).configVersions.findOne({ kind: 'learn_content', version, status: { $in: ['published', 'archived'] } });
  if (!source) return { problem: 'That version does not exist.' };
  const parsed = LearnContentSchema.safeParse(source.document);
  if (!parsed.success) return { problem: `Version ${version} cannot be read by this version of the app.` };
  const live = await readLive(db);
  if ('blocked' in live) return { problem: live.blocked };
  const restored = await learnContentSpec.restoreDocument!(db, parsed.data as LearnContent, version);
  return { changes: describeContentChanges(live.content, restored.document) };
}

/** Make the whole content as it was in an earlier version (IDs added since kept, archived). */
export async function restoreVersion(db: Db, actor: string, input: { version: number }): Promise<EditResult> {
  const source = await collections(db).configVersions.findOne({ kind: 'learn_content', version: input.version, status: { $in: ['published', 'archived'] } });
  if (!source) return { status: 'not_found' };
  const parsed = LearnContentSchema.safeParse(source.document);
  if (!parsed.success) return { status: 'invalid', issues: [`Version ${input.version} cannot be read by this version of the app.`] };
  return commit(db, actor, async ({ content }) => {
    const restored = await learnContentSpec.restoreDocument!(db, structuredClone(parsed.data as LearnContent), input.version);
    if (describeContentChanges(content, restored.document).length === 0) return { status: 'invalid', issues: [`The live content already is version ${input.version}.`] };
    return { content: restored.document, id: '*', note: restored.note, action: 'restore-version', extra: { from: input.version } };
  });
}

// ─── Reading for the editor ────────────────────────────────────────────────────

export interface ItemHistoryEntry {
  version: number;
  live: boolean;
  at: string | null;
  by: string | null;
  note: string | null;
}

/** The versions that changed an item, newest first. */
export async function itemHistory(db: Db, id: string, limit = 40): Promise<ItemHistoryEntry[]> {
  const versions = await collections(db)
    .configVersions.find({ kind: 'learn_content', status: { $in: ['published', 'archived'] }, items: id }, { sort: { version: -1 }, limit, projection: { document: 0 } })
    .toArray();
  return versions.map((v) => ({ version: v.version, live: v.status === 'published', at: v.publishedAt?.toISOString() ?? null, by: v.publishedBy, note: v.note }));
}

/** An item as stored now, its fingerprint for saving, and the live version. */
export async function itemForEdit(db: Db, id: string): Promise<{ item: LearnItem; hash: string; version: number | null } | null> {
  const live = await readLive(db).catch(() => null);
  const published = live && !('blocked' in live) ? live : null;
  let content = published?.content;
  let version = published?.version ?? null;
  if (!content) {
    // While a draft waits, the editor still opens what is live (saving is paused).
    const doc = await getPublished(db, learnContentSpec);
    const parsed = doc ? LearnContentSchema.safeParse(doc.document) : null;
    if (!parsed?.success) return null;
    content = parsed.data as LearnContent;
    version = doc!.version;
  }
  const item = findItem(content, id);
  if (!item) return null;
  const { kind: _kind, ...raw } = item;
  return { item, hash: itemHash(raw), version };
}
