import 'server-only';
import type { Db } from 'mongodb';
import { z } from 'zod';
import { TOOL_IDS } from '@/lib/account';
import { defaultConfig } from '@/lib/companion/defaults';
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
  actionIssues,
  type CompanionConfig,
  type CompanionTip,
} from '@/lib/companion/model';
import { publishedDocument, getPublished, type ConfigSpec } from '@/server/config/versions';

// ─── Sketchy's configuration: one versioned document (kind `companion`) ──────
// Settings, the access of each of his capabilities, and every tip, in
// English and Hebrew (ADR-0024). Versioned like the plan catalog and Learn
// (ADR-0006): each save in Admin → Companion publishes a new version at once
// (src/server/companion/editor.ts), every version is kept and any can be
// restored. Until the first save the code's defaults apply
// (src/lib/companion/defaults.ts).
//
// Read tolerantly (ADR-0014): fields and values a newer release adds are
// kept as they are; a tip whose trigger, animation, action or screen this
// release does not know is shown to nobody (src/server/companion/live.ts),
// and the document is not written back until such values are gone.

const Text = (max: number) => z.string().max(max);
const Loc = (max: number) => z.object({ en: Text(max), he: Text(max) }).passthrough();
/** Read tolerantly: a value from a newer release is kept (and its tip shown to nobody here). */
const Name = z.string().min(1).max(40);

const ActionSchema = z
  .object({
    type: Name,
    label: Loc(LIMITS.label),
    tool: Name.optional(),
    mood: Name.optional(),
    page: Name.optional(),
    itemId: z.string().max(20).optional(),
  })
  .passthrough();

const TipSchema = z
  .object({
    id: z.string().regex(TIP_ID),
    order: z.number().int().min(0).max(1_000_000),
    category: Name,
    title: Loc(LIMITS.title).optional(),
    text: Loc(LIMITS.text),
    screens: z.array(Name).max(10),
    afterTools: z.array(Name).max(10).optional(),
    audience: z.array(Name).max(10),
    trigger: Name,
    animation: Name,
    action: ActionSchema,
    access: Name,
    weight: z.number().int().min(LIMITS.weight.min).max(LIMITS.weight.max),
    archived: z.boolean().optional(),
  })
  .passthrough();

const Bounded = (limits: { min: number; max: number }) => z.number().int().min(limits.min).max(limits.max);

const SettingsSchema = z
  .object({
    enabled: z.boolean(),
    size: Bounded(LIMITS.size),
    frequency: Name,
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
    animations: z.record(z.boolean()),
  })
  .passthrough();

export const CompanionConfigSchema = z
  .object({
    settings: SettingsSchema,
    access: z.record(Name),
    tips: z.array(TipSchema).max(LIMITS.tips),
    /** The highest tip number ever given (IDs are never reused, even after a restore). */
    tipSeq: z.number().int().min(0).max(9999).optional(),
  })
  .passthrough();

export type StoredCompanionConfig = CompanionConfig & { tipSeq?: number };

const known = <T extends string>(list: readonly T[], value: unknown): value is T => (list as readonly unknown[]).includes(value);

/** Whether this release knows every value of a tip (else it is shown to nobody and the document is not written back). */
export function tipIssues(tip: CompanionTip): string[] {
  const issues: string[] = [];
  const where = `${tip.id}:`;
  if (!known(TIP_CATEGORIES, tip.category)) issues.push(`${where} unknown category "${tip.category}"`);
  if (!known(TRIGGERS, tip.trigger)) issues.push(`${where} unknown moment "${tip.trigger}"`);
  if (!known(TIP_ANIMATIONS, tip.animation)) issues.push(`${where} unknown animation "${tip.animation}"`);
  if (!known(ACCESS_MODES, tip.access)) issues.push(`${where} unknown access "${tip.access}"`);
  if (!known(ACTION_TYPES, tip.action.type)) issues.push(`${where} unknown button action "${tip.action.type}"`);
  if (tip.screens.length === 0 && tip.trigger !== 'menu') issues.push(`${where} choose at least one screen`);
  for (const s of tip.screens) if (!known(SCREENS, s)) issues.push(`${where} unknown screen "${s}"`);
  for (const a of tip.audience) if (!known(AUDIENCES, a)) issues.push(`${where} unknown audience "${a}"`);
  for (const t of tip.afterTools ?? []) if (!known(TOOL_IDS, t)) issues.push(`${where} unknown tool "${t}"`);
  if (tip.action.tool !== undefined && !known(TOOL_IDS, tip.action.tool)) issues.push(`${where} unknown tool "${tip.action.tool}"`);
  if (tip.action.page !== undefined && !known(LEARN_PAGES, tip.action.page)) issues.push(`${where} unknown Learn page "${tip.action.page}"`);
  if (tip.action.mood !== undefined && !known(MOODS, tip.action.mood)) issues.push(`${where} unknown roulette mood "${tip.action.mood}"`);
  if (known(ACTION_TYPES, tip.action.type)) for (const issue of actionIssues(tip.action)) issues.push(`${where} ${issue}`);
  return issues;
}

/** What stops a tip from being shown to people: both languages, within the lengths. */
export function tipTextIssues(tip: CompanionTip): string[] {
  const issues: string[] = [];
  if (!tip.text.en.trim() || !tip.text.he.trim()) issues.push(`${tip.id}: the text needs both English and Hebrew`);
  if (tip.title && (!tip.title.en.trim() !== !tip.title.he.trim())) issues.push(`${tip.id}: the heading needs both languages, or neither`);
  return issues;
}

/** Everything this release cannot write: unknown values anywhere, duplicate IDs, incomplete texts of tips people see. */
export function configIssues(config: CompanionConfig): string[] {
  const issues: string[] = [];
  if (!known(FREQUENCIES, config.settings.frequency)) issues.push(`unknown frequency "${config.settings.frequency}"`);
  for (const id of Object.keys(config.settings.animations)) if (!known(ANIMATIONS, id)) issues.push(`unknown animation "${id}"`);
  for (const [feature, mode] of Object.entries(config.access)) {
    if (!known(COMPANION_FEATURES, feature)) issues.push(`unknown capability "${feature}"`);
    if (!known(ACCESS_MODES, mode)) issues.push(`unknown access "${mode}" for ${feature}`);
  }
  const seen = new Set<string>();
  for (const tip of config.tips) {
    if (seen.has(tip.id)) issues.push(`${tip.id}: used twice`);
    seen.add(tip.id);
    issues.push(...tipIssues(tip));
    if (!tip.archived && tip.access !== 'blocked') issues.push(...tipTextIssues(tip));
  }
  return issues;
}

export const companionSpec: ConfigSpec<StoredCompanionConfig> = {
  kind: 'companion',
  schema: CompanionConfigSchema as unknown as z.ZodType<StoredCompanionConfig>,
  defaults: defaultConfig,
  check: configIssues,
  changedKeys: (previous, next) => {
    const before = new Map((previous?.tips ?? []).map((tip) => [tip.id, JSON.stringify(tip)]));
    const changed = next.tips.filter((tip) => before.get(tip.id) !== JSON.stringify(tip)).map((tip) => tip.id);
    const settings = JSON.stringify(previous?.settings ?? null) !== JSON.stringify(next.settings) ? ['settings'] : [];
    const access = JSON.stringify(previous?.access ?? null) !== JSON.stringify(next.access) ? ['access'] : [];
    return [...settings, ...access, ...changed].sort();
  },
  restoreDocument: async (db: Db, document, version) => {
    // IDs are never reused: the counter keeps the highest number ever given.
    const live = await getPublished(db, companionSpec);
    const liveSeq = (live?.document as StoredCompanionConfig | undefined)?.tipSeq ?? 0;
    return { document: { ...document, tipSeq: Math.max(liveSeq, document.tipSeq ?? 0, highestTipNumber(document.tips)) }, note: `Restored from version ${version}` };
  },
};

/** The highest tip number in a list (T-012 → 12). */
export const highestTipNumber = (tips: readonly Pick<CompanionTip, 'id'>[]): number => tips.reduce((max, tip) => Math.max(max, Number(tip.id.slice(2)) || 0), 0);

/** The live configuration (the defaults until an admin saves); throws UnreadableConfigError if this release cannot read it. */
export async function publishedCompanion(db: Db): Promise<StoredCompanionConfig> {
  return publishedDocument(db, companionSpec);
}
