import 'server-only';
import { createHash } from 'node:crypto';
import type { Db } from 'mongodb';
import { z } from 'zod';
import { TOOL_IDS } from '@/lib/account';
import {
  ACCESS_MODES,
  ACTION_TYPES,
  ANIMATIONS,
  AUDIENCES,
  COMPANION_FEATURES,
  FREQUENCIES,
  LEARN_PAGES,
  LIMITS,
  MOODS,
  SCREENS,
  TIP_ANIMATIONS,
  TIP_CATEGORIES,
  TIP_ID,
  TRIGGERS,
  type CompanionSettings,
  type CompanionTip,
} from '@/lib/companion/model';
import { ITEM_ID } from '@/lib/learn/model';
import { recordAudit } from '@/server/audit';
import { getPublished, publishIfUnchanged } from '@/server/config/versions';
import { collections } from '@/server/db/collections';
import { CompanionConfigSchema, companionSpec, configIssues, highestTipNumber, type StoredCompanionConfig } from './config';

// ─── Admin → Companion's editor (ADR-0024) ────────────────────────────────────
// Every change an admin makes (the settings, a capability's access, a tip
// added, edited, copied, archived or restored, an earlier version brought
// back) is published at once as a new version of the `companion`
// configuration, through the same guarded step Admin → Learn uses
// (publishIfUnchanged): the live version is read, the one change is applied
// to it and checked, and the result replaces it only if nothing was published
// meanwhile (otherwise the change is applied again to the newer version). A
// tip edited by someone else since it was opened is not overwritten.

export type CompanionEditResult =
  | { status: 'saved'; version: number; id: string | null; message: string }
  | { status: 'conflict'; message: string }
  | { status: 'invalid'; issues: string[] }
  | { status: 'blocked'; message: string }
  | { status: 'not_found' };

/** A fingerprint of a tip as stored (to tell whether it changed since an editor opened it). */
export const tipHash = (tip: unknown): string => createHash('sha256').update(JSON.stringify(tip)).digest('base64url').slice(0, 22);

// ─── What the forms send ──────────────────────────────────────────────────────

const Loc = (max: number) => z.object({ en: z.string().max(max), he: z.string().max(max) }).strict();
const Bounded = (limits: { min: number; max: number }) => z.number().int().min(limits.min).max(limits.max);

export const SettingsFormSchema = z
  .object({
    enabled: z.boolean(),
    size: Bounded(LIMITS.size),
    frequency: z.enum(FREQUENCIES),
    firstDelaySec: Bounded(LIMITS.firstDelaySec),
    tipAfterSec: Bounded(LIMITS.tipAfterSec),
    cooldownMin: Bounded(LIMITS.cooldownMin),
    snoozeHours: Bounded(LIMITS.snoozeHours),
    maxPerDay: Bounded(LIMITS.maxPerDay),
    wander: z.boolean(),
    wanderEverySec: Bounded(LIMITS.wanderEverySec),
    idleLife: z.boolean(),
    celebrate: z.boolean(),
    restAfterSec: Bounded(LIMITS.restAfterSec),
    speed: Bounded(LIMITS.speed),
    animations: z.object(Object.fromEntries(ANIMATIONS.map((id) => [id, z.boolean()])) as Record<(typeof ANIMATIONS)[number], z.ZodBoolean>).strict(),
  })
  .strict();

export const AccessFormSchema = z.object(Object.fromEntries(COMPANION_FEATURES.map((f) => [f, z.enum(ACCESS_MODES)])) as Record<(typeof COMPANION_FEATURES)[number], z.ZodEnum<[...typeof ACCESS_MODES]>>).strict();

export const TipFormSchema = z
  .object({
    category: z.enum(TIP_CATEGORIES),
    title: Loc(LIMITS.title).optional(),
    text: Loc(LIMITS.text),
    screens: z.array(z.enum(SCREENS)).max(SCREENS.length),
    afterTools: z.array(z.enum(TOOL_IDS)).max(TOOL_IDS.length).optional(),
    audience: z.array(z.enum(AUDIENCES)).max(AUDIENCES.length),
    trigger: z.enum(TRIGGERS),
    animation: z.enum(TIP_ANIMATIONS),
    action: z
      .object({
        type: z.enum(ACTION_TYPES),
        label: Loc(LIMITS.label),
        tool: z.enum(TOOL_IDS).optional(),
        mood: z.enum(MOODS).optional(),
        page: z.enum(LEARN_PAGES).optional(),
        itemId: z.string().regex(ITEM_ID).optional(),
      })
      .strict(),
    access: z.enum(ACCESS_MODES),
    weight: Bounded(LIMITS.weight),
  })
  .strict();

export type SettingsForm = z.infer<typeof SettingsFormSchema>;
export type TipForm = z.infer<typeof TipFormSchema>;

const issuesOf = (error: z.ZodError) => error.issues.map((i) => `${i.path.join('.') || 'form'}: ${i.message}`);

// ─── Reading and publishing ───────────────────────────────────────────────────

interface Live {
  config: StoredCompanionConfig;
  version: number | null;
}

async function readLive(db: Db): Promise<Live | { blocked: string }> {
  const published = await getPublished(db, companionSpec);
  if (!published) return { config: companionSpec.defaults(), version: null };
  const parsed = CompanionConfigSchema.safeParse(published.document);
  if (!parsed.success) return { blocked: `The live configuration (version ${published.version}) cannot be read by this version of the app, so nothing can be saved here.` };
  return { config: parsed.data as StoredCompanionConfig, version: published.version };
}

interface Change {
  config: StoredCompanionConfig;
  /** The tip it is about, or null (settings, access, a restore). */
  id: string | null;
  note: string;
  action: string;
}

type Built = Change | Exclude<CompanionEditResult, { status: 'saved' }>;

async function commit(db: Db, actor: string, build: (live: Live) => Built): Promise<CompanionEditResult> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const live = await readLive(db);
    if ('blocked' in live) return { status: 'blocked', message: live.blocked };
    const built = build({ config: structuredClone(live.config), version: live.version });
    if ('status' in built) return built;
    const issues = configIssues(built.config);
    if (issues.length > 0) return { status: 'invalid', issues };
    const result = await publishIfUnchanged(db, companionSpec, built.config, { version: live.version }, actor, built.note, new Date(), { keys: built.id ? [built.id] : [] });
    if (result.status === 'changed') continue;
    if (result.status === 'draft_exists') return { status: 'blocked', message: 'A draft of this configuration exists (from the command line): discard it first.' };
    if (result.status === 'invalid') return { status: 'invalid', issues: result.issues };
    await recordAudit(db, { type: 'admin.companion_changed', userId: null, actor, metadata: { action: built.action, tipId: built.id, version: result.version } });
    return { status: 'saved', version: result.version, id: built.id, message: built.note };
  }
  return { status: 'conflict', message: 'Other changes were being published at the same moment. Nothing was saved; try again.' };
}

/** The next tip ID never given before (the counter survives restores). */
function nextTipId(config: StoredCompanionConfig): string | null {
  const n = Math.max(config.tipSeq ?? 0, highestTipNumber(config.tips)) + 1;
  return n > 9999 ? null : `T-${String(n).padStart(3, '0')}`;
}

const trimLoc = (text: { en?: string; he?: string } | undefined) => ({ en: (text?.en ?? '').trim(), he: (text?.he ?? '').trim() });

/** A tip as stored, from the form: empty optional parts removed, the order and ID kept. */
function tipFrom(form: TipForm, id: string, order: number, archived: boolean): CompanionTip {
  const title = form.title ? trimLoc(form.title) : null;
  const type = form.action.type;
  return {
    id,
    order,
    category: form.category,
    ...(title && (title.en || title.he) ? { title } : {}),
    text: trimLoc(form.text),
    screens: [...new Set(form.screens)],
    ...(form.afterTools?.length ? { afterTools: [...new Set(form.afterTools)] } : {}),
    audience: [...new Set(form.audience)],
    trigger: form.trigger,
    animation: form.animation,
    action: {
      type,
      label: type === 'none' ? { en: '', he: '' } : trimLoc(form.action.label),
      ...(type === 'openTool' && form.action.tool ? { tool: form.action.tool } : {}),
      ...((type === 'roulette' || type === 'classRoulette') && form.action.mood ? { mood: form.action.mood } : {}),
      ...(type === 'openLearn' && form.action.page ? { page: form.action.page } : {}),
      ...(type === 'openItem' && form.action.itemId ? { itemId: form.action.itemId } : {}),
    },
    access: form.access,
    weight: form.weight,
    ...(archived ? { archived: true } : {}),
  };
}

// ─── The operations ────────────────────────────────────────────────────────────

export async function saveSettings(db: Db, actor: string, input: unknown): Promise<CompanionEditResult> {
  const parsed = SettingsFormSchema.safeParse(input);
  if (!parsed.success) return { status: 'invalid', issues: issuesOf(parsed.error) };
  return commit(db, actor, ({ config }) => {
    // Anything a newer release added to the settings is kept as it is.
    config.settings = { ...config.settings, ...parsed.data, animations: { ...config.settings.animations, ...parsed.data.animations } as CompanionSettings['animations'] };
    return { config, id: null, note: 'Settings saved', action: 'settings' };
  });
}

export async function saveAccess(db: Db, actor: string, input: unknown): Promise<CompanionEditResult> {
  const parsed = AccessFormSchema.safeParse(input);
  if (!parsed.success) return { status: 'invalid', issues: issuesOf(parsed.error) };
  return commit(db, actor, ({ config }) => {
    config.access = { ...config.access, ...parsed.data };
    return { config, id: null, note: 'Access saved', action: 'access' };
  });
}

/** Create a tip (`id` null) or edit one; an edit is refused if the tip changed since `baseHash`. */
export async function saveTip(db: Db, actor: string, input: { id: string | null; baseHash?: string; fields: unknown }): Promise<CompanionEditResult> {
  const parsed = TipFormSchema.safeParse(input.fields);
  if (!parsed.success) return { status: 'invalid', issues: issuesOf(parsed.error) };
  if (input.id !== null && !TIP_ID.test(input.id)) return { status: 'invalid', issues: ['That tip ID is not valid.'] };
  return commit(db, actor, ({ config }) => {
    if (input.id === null) {
      const id = nextTipId(config);
      if (!id) return { status: 'invalid', issues: ['No tip IDs are left.'] };
      if (config.tips.length >= LIMITS.tips) return { status: 'invalid', issues: [`At most ${LIMITS.tips} tips (archived ones included).`] };
      const order = config.tips.reduce((max, tip) => Math.max(max, tip.order), 0) + 10;
      config.tips.push(tipFrom(parsed.data, id, order, false));
      config.tipSeq = Number(id.slice(2));
      return { config, id, note: `Tip ${id} added`, action: 'create' };
    }
    const at = config.tips.findIndex((tip) => tip.id === input.id);
    if (at < 0) return { status: 'not_found' };
    const stored = config.tips[at];
    if (input.baseHash !== tipHash(stored)) return { status: 'conflict', message: 'This tip was changed since you opened it. Your text is still in the form: copy it, close and open the tip again.' };
    // Fields a newer release added to the tip are kept.
    config.tips[at] = { ...stored, ...tipFrom(parsed.data, stored.id, stored.order, stored.archived === true) };
    if (!parsed.data.title) delete (config.tips[at] as Partial<CompanionTip>).title;
    if (!parsed.data.afterTools?.length) delete (config.tips[at] as Partial<CompanionTip>).afterTools;
    return { config, id: stored.id, note: `Tip ${stored.id} edited`, action: 'edit' };
  });
}

export async function duplicateTip(db: Db, actor: string, input: { id: string }): Promise<CompanionEditResult> {
  if (!TIP_ID.test(input.id)) return { status: 'invalid', issues: ['That tip ID is not valid.'] };
  return commit(db, actor, ({ config }) => {
    const source = config.tips.find((tip) => tip.id === input.id);
    if (!source) return { status: 'not_found' };
    const id = nextTipId(config);
    if (!id) return { status: 'invalid', issues: ['No tip IDs are left.'] };
    if (config.tips.length >= LIMITS.tips) return { status: 'invalid', issues: [`At most ${LIMITS.tips} tips (archived ones included).`] };
    // A copy starts as Admin only, so it can be checked before anyone sees it twice.
    const copy: CompanionTip = { ...structuredClone(source), id, order: source.order + 1, access: 'admin' };
    delete copy.archived;
    config.tips.push(copy);
    config.tipSeq = Number(id.slice(2));
    return { config, id, note: `Tip ${id} copied from ${source.id} (Admin only until you change its access)`, action: 'duplicate' };
  });
}

export async function setTipArchived(db: Db, actor: string, input: { id: string; archived: boolean }): Promise<CompanionEditResult> {
  if (!TIP_ID.test(input.id)) return { status: 'invalid', issues: ['That tip ID is not valid.'] };
  return commit(db, actor, ({ config }) => {
    const tip = config.tips.find((t) => t.id === input.id);
    if (!tip) return { status: 'not_found' };
    if (input.archived) tip.archived = true;
    else delete tip.archived;
    return { config, id: tip.id, note: `Tip ${tip.id} ${input.archived ? 'archived' : 'restored'}`, action: input.archived ? 'archive' : 'restore' };
  });
}

export async function moveTip(db: Db, actor: string, input: { id: string; direction: 'up' | 'down' }): Promise<CompanionEditResult> {
  if (!TIP_ID.test(input.id)) return { status: 'invalid', issues: ['That tip ID is not valid.'] };
  return commit(db, actor, ({ config }) => {
    const ordered = [...config.tips].filter((t) => !t.archived).sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
    const at = ordered.findIndex((t) => t.id === input.id);
    if (at < 0) return { status: 'not_found' };
    const other = ordered[input.direction === 'up' ? at - 1 : at + 1];
    if (!other) return { status: 'invalid', issues: [`It is already ${input.direction === 'up' ? 'first' : 'last'}.`] };
    // Renumber in tens, then swap the two.
    ordered.forEach((tip, i) => (tip.order = (i + 1) * 10));
    [ordered[at].order, other.order] = [other.order, ordered[at].order];
    const byId = new Map(ordered.map((t) => [t.id, t.order]));
    for (const tip of config.tips) if (byId.has(tip.id)) tip.order = byId.get(tip.id)!;
    return { config, id: input.id, note: `Tip ${input.id} moved ${input.direction}`, action: 'move' };
  });
}

/** Publish an earlier version's configuration again, as a new version (tip IDs are still never reused). */
export async function restoreCompanionVersion(db: Db, actor: string, input: { version: number }): Promise<CompanionEditResult> {
  const source = await collections(db).configVersions.findOne({ kind: 'companion', version: input.version, status: { $in: ['published', 'archived'] } });
  if (!source) return { status: 'not_found' };
  const parsed = CompanionConfigSchema.safeParse(source.document);
  if (!parsed.success) return { status: 'blocked', message: `Version ${input.version} cannot be read by this version of the app.` };
  return commit(db, actor, ({ config }) => {
    const restored = structuredClone(parsed.data) as StoredCompanionConfig;
    restored.tipSeq = Math.max(config.tipSeq ?? 0, highestTipNumber(config.tips), restored.tipSeq ?? 0, highestTipNumber(restored.tips));
    return { config: restored, id: null, note: `Version ${input.version} restored`, action: 'restore_version' };
  });
}

/** The live configuration as the editor shows it, with each tip's fingerprint. */
export async function companionForEdit(db: Db): Promise<{ config: StoredCompanionConfig; version: number | null; hashes: Record<string, string> } | { blocked: string }> {
  const live = await readLive(db);
  if ('blocked' in live) return live;
  return { ...live, hashes: Object.fromEntries(live.config.tips.map((tip) => [tip.id, tipHash(tip)])) };
}
