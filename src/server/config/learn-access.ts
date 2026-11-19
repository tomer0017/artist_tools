import 'server-only';
import { z } from 'zod';
import { PLAN_IDS, PLAN_NAMES, isPlanId, type PlanId } from '@/lib/plans';
import {
  COLLECTION_LABELS,
  GROUP_ID,
  ITEM_ID,
  LEARN_COLLECTIONS,
  LEARN_PREVIEWS,
  NO_LEARN_ACCESS,
  NO_RULES,
  collectionOfId,
  defaultLearnSection,
  isItemId,
  type LearnAccess,
  type LearnCollection,
  type LearnPreviews,
  type LearnRule,
  type LearnRules,
  type LearnSection,
  type SelectionOrigin,
} from '@/lib/learn/model';

// ─── The catalog's Learn access section (ADR-0017) ────────────────────────────
// For each plan and collection one rule (All, None or a frozen Selected list),
// and what locked items show in lists. Stored in the plan catalog and
// published with it; publishing copies each plan's rules into `plans`, which
// entitlements read (src/server/entitlements.ts).
//
// Read like the rest of the catalog (ADR-0014): what this release does not
// know (another collection, another setting) is kept exactly and applied
// nowhere; a rule it cannot apply in full counts as None, and locked items
// show titles only, so a reading never opens more than was published. A
// catalog without the section (every catalog before M4) opens nothing.

const MAX_SELECTED = 500;

const Origin = z.discriminatedUnion('by', [
  z.object({ by: z.literal('first'), n: z.number().int().min(1).max(1000), contentVersion: z.number().int().min(1).nullable() }).strict(),
  z.object({ by: z.literal('group'), groupId: z.string().regex(GROUP_ID), contentVersion: z.number().int().min(1).nullable() }).strict(),
  z.object({ by: z.literal('pick') }).strict(),
]);

const Rule = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('all') }).strict(),
  z.object({ mode: z.literal('none') }).strict(),
  z.object({ mode: z.literal('selected'), items: z.array(z.string().regex(ITEM_ID, 'is not an exercise or challenge ID')).max(MAX_SELECTED), made: Origin.optional() }).strict(),
]);

const PlanRules = z.object({ curriculum: Rule, color: Rule, challenges: Rule }).strict();

/** The section as the editor sends it: only what this release knows, validated. */
export const LearnSectionSchema = z
  .object({
    access: z.object({ free: PlanRules, pro: PlanRules }).strict(),
    previews: z.enum(LEARN_PREVIEWS),
  })
  .strict()
  .superRefine((section, ctx) => {
    for (const planId of PLAN_IDS) {
      for (const collection of LEARN_COLLECTIONS) {
        const rule = section.access[planId][collection];
        if (rule.mode !== 'selected') continue;
        const path = ['access', planId, collection, 'items'];
        if (new Set(rule.items).size !== rule.items.length) ctx.addIssue({ code: 'custom', path, message: 'lists an item twice' });
        for (const id of rule.items) {
          if (collectionOfId(id) !== collection) ctx.addIssue({ code: 'custom', path, message: `${id} is not in the ${COLLECTION_LABELS[collection]}` });
        }
      }
    }
  });

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

const describe = (value: unknown) => {
  const text = JSON.stringify(value) ?? String(value);
  return text.length > 80 ? `${text.slice(0, 77)}…` : text;
};

/**
 * One stored rule, as this release applies it, or why it cannot be applied in
 * full. A setting it does not know on a rule could narrow it, so the whole
 * rule is then withheld (None). How a list was made is only a note: a note it
 * cannot read is dropped, never the list.
 */
export function parseStoredRule(value: unknown, collection: LearnCollection): { rule: LearnRule } | { problem: string } {
  if (!isRecord(value)) return { problem: `is not a rule (${describe(value)})` };
  const extra = Object.keys(value).filter((key) => key !== 'mode' && !(value.mode === 'selected' && (key === 'items' || key === 'made')));
  if (value.mode !== 'all' && value.mode !== 'none' && value.mode !== 'selected') return { problem: `has a rule this version of the app does not know (${describe(value.mode)})` };
  if (extra.length > 0) return { problem: `has settings this version of the app does not know (${extra.join(', ')})` };
  if (value.mode !== 'selected') return { rule: { mode: value.mode } };
  const items = value.items;
  if (!Array.isArray(items) || items.length > MAX_SELECTED || !items.every((id) => isItemId(id) && collectionOfId(id) === collection)) {
    return { problem: `has a list this version of the app cannot read (${describe(items)})` };
  }
  const made = Origin.safeParse(value.made);
  return { rule: { mode: 'selected', items: [...new Set(items as string[])], ...(made.success ? { made: made.data as SelectionOrigin } : {}) } };
}

export interface WithheldRule {
  plan: PlanId | null;
  collection: LearnCollection | null;
  /** Why this release applies None (or titles only) instead, in words. */
  reason: string;
}

export interface LearnSectionRead {
  /** What this release applies. */
  section: LearnSection;
  /** Whether the stored catalog has a Learn section at all. */
  present: boolean;
  withheld: WithheldRule[];
  /** Settings this release does not know, kept and not applied (`learn.access.free.sculpture`). */
  unknown: string[];
}

/** Read the stored section (`catalog.learn`): never more than it grants, never failing the catalog. */
export function readLearnSection(value: unknown): LearnSectionRead {
  const section = defaultLearnSection();
  if (value === undefined) return { section, present: false, withheld: [], unknown: [] };
  const withheld: WithheldRule[] = [];
  const unknown: string[] = [];
  if (!isRecord(value)) return { section, present: true, withheld: [{ plan: null, collection: null, reason: `the Learn section cannot be read (${describe(value)})` }], unknown };
  for (const key of Object.keys(value)) if (key !== 'access' && key !== 'previews') unknown.push(`learn.${key}`);
  const access = value.access;
  if (access !== undefined && !isRecord(access)) {
    withheld.push({ plan: null, collection: null, reason: `the Learn access rules cannot be read (${describe(access)})` });
  } else if (access) {
    for (const key of Object.keys(access)) if (!isPlanId(key)) unknown.push(`learn.access.${key}`);
    for (const planId of PLAN_IDS) {
      const rules = access[planId];
      if (rules === undefined) continue;
      if (!isRecord(rules)) {
        withheld.push({ plan: planId, collection: null, reason: `its Learn rules cannot be read (${describe(rules)})` });
        continue;
      }
      for (const key of Object.keys(rules)) if (!(LEARN_COLLECTIONS as readonly string[]).includes(key)) unknown.push(`learn.access.${planId}.${key}`);
      for (const collection of LEARN_COLLECTIONS) {
        if (rules[collection] === undefined) continue;
        const parsed = parseStoredRule(rules[collection], collection);
        if ('rule' in parsed) section.access[planId][collection] = parsed.rule;
        else withheld.push({ plan: planId, collection, reason: parsed.problem });
      }
    }
  }
  if (value.previews !== undefined) {
    if ((LEARN_PREVIEWS as readonly unknown[]).includes(value.previews)) section.previews = value.previews as LearnPreviews;
    else withheld.push({ plan: null, collection: null, reason: `what locked items show cannot be read (${describe(value.previews)}): titles only` });
  }
  return { section, present: true, withheld, unknown: unknown.sort() };
}

export const withheldRuleNote = (w: WithheldRule): string =>
  w.plan && w.collection
    ? `${PLAN_NAMES[w.plan]}: the ${COLLECTION_LABELS[w.collection]} rule is withheld here (None), because it ${w.reason}.`
    : w.plan
      ? `${PLAN_NAMES[w.plan]}: Learn access is withheld here (None), because ${w.reason}.`
      : `Learn access is withheld here (None, titles only), because ${w.reason}.`;

const sameJson = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/**
 * The stored section with what this release knows replaced by `edited`, and
 * everything else kept exactly. A catalog that never had the section keeps
 * not having one while it still says nothing (None everywhere, titles only),
 * so an unchanged edit writes the catalog back exactly.
 */
export function mergeLearnSection(stored: unknown, edited: LearnSection | undefined): unknown {
  if (edited === undefined) return stored;
  if (stored === undefined && sameJson(edited, defaultLearnSection())) return undefined;
  const base = isRecord(stored) ? stored : {};
  const baseAccess = isRecord(base.access) ? base.access : {};
  const access: Record<string, unknown> = { ...baseAccess };
  for (const planId of PLAN_IDS) {
    const before = isRecord(baseAccess[planId]) ? (baseAccess[planId] as Record<string, unknown>) : {};
    access[planId] = { ...before, ...edited.access[planId] };
  }
  return { ...base, access, previews: edited.previews };
}

/** One plan's Learn access as written to `plans` (the copy entitlements read). */
export const planLearnAccess = (section: LearnSection, planId: PlanId): LearnAccess => ({ rules: structuredClone(section.access[planId]), previews: section.previews });

/**
 * A `plans` document's Learn access as entitlements apply it: a missing one
 * (every plan written before M4) is None, and anything malformed is None for
 * that collection (fail closed), reported once per process.
 */
export function learnAccessOf(value: unknown, planId: string, report: (key: string, fields: Record<string, unknown>) => void): LearnAccess {
  if (value === undefined || value === null) return NO_LEARN_ACCESS();
  if (!isRecord(value) || !isRecord(value.rules)) {
    report(`${planId}.learn`, { plan: planId, field: 'learn' });
    return NO_LEARN_ACCESS();
  }
  const rules: LearnRules = NO_RULES();
  for (const collection of LEARN_COLLECTIONS) {
    const stored = value.rules[collection];
    if (stored === undefined) continue;
    const parsed = parseStoredRule(stored, collection);
    if ('rule' in parsed) rules[collection] = parsed.rule;
    else report(`${planId}.learn.${collection}`, { plan: planId, field: `learn.${collection}` });
  }
  const previews: LearnPreviews = (LEARN_PREVIEWS as readonly unknown[]).includes(value.previews) ? (value.previews as LearnPreviews) : 'title';
  return { rules, previews };
}
