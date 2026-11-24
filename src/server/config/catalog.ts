import 'server-only';
import type { Db } from 'mongodb';
import { z, type ZodError } from 'zod';
import { FEATURES, FEATURE_LABELS, PLAN_FEATURES, PLAN_IDS, PLAN_NAMES, hasQuota, isLearnFeature, isPlanId, isToolFeature, type FeatureId, type PlanId } from '@/lib/plans';
import { learnAccess, legacyLearnOf } from '@/lib/learn/access';
import { COLLECTION_LABELS, LEARN_COLLECTIONS, NO_LEARN_ACCESS, collectionOfId, defaultLearnSection, itemsOf, ruleText, sameRule, type LearnContent, type LearnSection } from '@/lib/learn/model';
import { collections, type PlanDoc } from '@/server/db/collections';
import { LearnSectionSchema, learnAccessOf, mergeLearnSection, planLearnAccess, readLearnSection, withheldRuleNote, type WithheldRule } from './learn-access';
import { publishedLearnContent } from '@/server/learn/content';
import { getDraft, getPublished, saveDraft, type ConfigSpec, type SaveResult } from './versions';

// ─── The plan catalog ─────────────────────────────────────────────────────────
// Which features each plan includes, usage quotas per plan (per day or per
// calendar month, UTC), and features switched off for everyone but admins.
// Feature ids are code (a feature needs code that checks it); everything else
// here is the owner's to change. Version 1 is today's matrix: Free keeps all
// five tools and every save, no quotas, nothing switched off. Publishing a
// version writes it to `plans`, which entitlements read on every request
// (and which older releases still understand: monthly quotas stay in
// `limits`).
//
// A tool is on or off per plan; quotas are for what is saved or exported,
// which the server counts. A tool has no unit to count, so a quota on one is
// dropped from an edit rather than kept as a setting that would do nothing.
// The Learn modules are on or off the same way; which items each opens is the
// Learn section (src/server/config/learn-access.ts, ADR-0017).
//
// Rolling back is safe (ADR-0014). A catalog written by a newer release may
// hold feature ids and sections this release does not know: it reads them,
// keeps them exactly as they are (editing and publishing here never drop
// them) and applies none of them. A setting it knows but cannot apply (a
// quota it cannot count, or a malformed one) withholds that feature from that
// plan: fail closed, never more than was published. A document it cannot read
// at all is never replaced by the code's defaults: `plans` stays as it is
// (src/server/db/migrate.ts), and the admin page says so.

const Feature = z.enum(FEATURES);
const Quota = z.object({ limit: z.number().int().min(1).max(1_000_000), period: z.enum(['day', 'month']) });
const PlanEntry = z.object({
  features: z.array(Feature).max(FEATURES.length),
  quotas: z
    .record(Feature, Quota)
    .default({})
    .transform((quotas) => Object.fromEntries(Object.entries(quotas).filter(([feature]) => hasQuota(feature as FeatureId))) as typeof quotas),
});

/**
 * A catalog as admins edit it: only the features this release knows. Used to
 * validate what the editor sends; what is stored is read with
 * StoredCatalogSchema, which keeps what a newer release added.
 */
export const CatalogSchema = z
  .object({
    plans: z.object({ free: PlanEntry, pro: PlanEntry }),
    disabled: z.array(Feature).default([]),
    /** Learn access (ADR-0017); a catalog without it opens no Learn item. */
    learn: LearnSectionSchema.optional(),
  })
  .superRefine((catalog, ctx) => {
    for (const planId of PLAN_IDS) {
      const plan = catalog.plans[planId];
      if (new Set(plan.features).size !== plan.features.length) ctx.addIssue({ code: 'custom', path: ['plans', planId, 'features'], message: 'lists a feature twice' });
      for (const feature of Object.keys(plan.quotas) as FeatureId[]) {
        if (!plan.features.includes(feature)) {
          ctx.addIssue({ code: 'custom', path: ['plans', planId, 'quotas', feature], message: 'has a quota but is not included' });
        }
      }
    }
  });

export type Catalog = z.infer<typeof CatalogSchema>;

/** A catalog's Learn section as it applies: a catalog without one opens nothing. */
export const learnSectionOf = (catalog: Pick<Catalog, 'learn'>): LearnSection => (catalog.learn as LearnSection | undefined) ?? defaultLearnSection();
export type Quota = z.infer<typeof Quota>;

/** A feature id as stored: any short string, so a newer release's ids are kept (and never applied). */
const StoredFeatureId = z.string().min(1).max(100);
const StoredPlanEntry = z
  .object({
    features: z.array(StoredFeatureId).max(500),
    quotas: z.record(StoredFeatureId, z.unknown()).default({}),
  })
  .passthrough();

/**
 * A catalog as stored: the shape every release writes, with anything else
 * kept as it is — feature ids, quota settings and sections a newer release
 * added. Only a document without this shape cannot be read.
 */
export const StoredCatalogSchema = z
  .object({
    plans: z.object({ free: StoredPlanEntry, pro: StoredPlanEntry }).passthrough(),
    disabled: z.array(StoredFeatureId).max(500).default([]),
  })
  .passthrough();

export type StoredCatalog = z.infer<typeof StoredCatalogSchema>;

export function defaultCatalog(): Catalog {
  return {
    plans: { free: { features: [...PLAN_FEATURES.free], quotas: {} }, pro: { features: [...PLAN_FEATURES.pro], quotas: {} } },
    disabled: [],
  };
}

const KNOWN: ReadonlySet<string> = new Set(FEATURES);
const isKnown = (id: string): id is FeatureId => KNOWN.has(id);

/** The known ids of a stored list, in their stored order, each once. */
const knownIn = (ids: readonly string[]): FeatureId[] => [...new Set(ids.filter(isKnown))];

export const issuesOf = (error: ZodError): string[] => error.issues.map((i) => `${i.path.join('.') || 'document'}: ${i.message}`);

export interface WithheldFeature {
  plan: PlanId;
  feature: FeatureId;
  /** Why this release cannot apply the setting, in words. */
  reason: string;
}

export type CatalogRead =
  | {
      /** `partial`: some features are withheld because a setting on them cannot be applied here. */
      status: 'ok' | 'partial';
      /** What this release applies: features it knows, minus anything withheld. */
      catalog: Catalog;
      /** The document as stored, everything kept. */
      stored: StoredCatalog;
      /** What this release does not know: kept as it is, never applied. */
      unknown: { features: string[]; sections: string[] };
      withheld: WithheldFeature[];
      /** Learn rules this release cannot apply in full: None instead (ADR-0017). */
      withheldRules: WithheldRule[];
    }
  | { status: 'unreadable'; issues: string[] };

const describeValue = (value: unknown) => {
  const text = JSON.stringify(value) ?? String(value);
  return text.length > 80 ? `${text.slice(0, 77)}…` : text;
};

/**
 * Read a stored catalog: what this release applies, and what it keeps without
 * applying. Never falls back to the defaults, and never applies more than the
 * document grants.
 */
export function readCatalog(document: unknown): CatalogRead {
  const parsed = StoredCatalogSchema.safeParse(document);
  if (!parsed.success) return { status: 'unreadable', issues: issuesOf(parsed.error) };
  const stored = parsed.data;
  const unknownFeatures = new Set<string>();
  const withheld: WithheldFeature[] = [];
  const plans = {} as Catalog['plans'];
  for (const planId of PLAN_IDS) {
    const entry = stored.plans[planId];
    for (const id of [...entry.features, ...Object.keys(entry.quotas)]) if (!isKnown(id)) unknownFeatures.add(id);
    const features: FeatureId[] = [];
    const quotas: Catalog['plans'][PlanId]['quotas'] = {};
    // In the stored order, so a catalog an earlier release wrote reads exactly as it did.
    for (const feature of knownIn(entry.features)) {
      const setting = entry.quotas[feature];
      if (setting === undefined) {
        features.push(feature);
      } else if (!hasQuota(feature)) {
        const what = isToolFeature(feature) ? 'a tool' : isLearnFeature(feature) ? 'a Learn module' : 'a feature';
        withheld.push({ plan: planId, feature, reason: `a quota on ${what}, which this version of the app cannot count (${describeValue(setting)})` });
      } else {
        const quota = Quota.strict().safeParse(setting);
        if (quota.success) {
          features.push(feature);
          quotas[feature] = quota.data;
        } else {
          withheld.push({ plan: planId, feature, reason: `a quota this version of the app cannot apply (${describeValue(setting)})` });
        }
      }
    }
    plans[planId] = { features, quotas };
  }
  for (const id of stored.disabled) if (!isKnown(id)) unknownFeatures.add(id);
  const learn = readLearnSection(stored.learn);
  const sections = [
    ...Object.keys(stored).filter((key) => key !== 'plans' && key !== 'disabled' && key !== 'learn'),
    ...learn.unknown,
    ...Object.keys(stored.plans).filter((key) => !isPlanId(key)).map((key) => `plans.${key}`),
    ...PLAN_IDS.flatMap((planId) => Object.keys(stored.plans[planId]).filter((key) => key !== 'features' && key !== 'quotas').map((key) => `plans.${planId}.${key}`)),
  ];
  return {
    status: withheld.length > 0 || learn.withheld.length > 0 ? 'partial' : 'ok',
    catalog: { plans, disabled: knownIn(stored.disabled), ...(learn.present ? { learn: learn.section } : {}) },
    stored,
    unknown: { features: [...unknownFeatures].sort(), sections: sections.sort() },
    withheld,
    withheldRules: learn.withheld,
  };
}

/** What a read says, for the admin page and the operator tools. */
export function catalogReadNotes(read: CatalogRead): string[] {
  if (read.status === 'unreadable') return read.issues.slice(0, 5);
  const notes: string[] = [];
  if (read.unknown.features.length > 0) notes.push(`Feature ids this version of the app does not know: ${read.unknown.features.join(', ')}.`);
  if (read.unknown.sections.length > 0) notes.push(`Settings this version of the app does not know: ${read.unknown.sections.join(', ')}.`);
  for (const w of read.withheld) notes.push(`${PLAN_NAMES[w.plan]}: ${FEATURE_LABELS[w.feature]} is withheld here, because it has ${w.reason}.`);
  for (const w of read.withheldRules) notes.push(withheldRuleNote(w));
  return notes;
}

/**
 * A stored id list with its known ids set to `known`: ids kept where they
 * were (unknown ones untouched), known ones no longer wanted removed, new
 * ones added at the end in the canonical order. An unchanged edit writes the
 * list back exactly.
 */
function mergeIds(before: readonly string[], known: readonly FeatureId[]): string[] {
  const seen = new Set<string>();
  const kept = before.filter((id) => {
    if (!isKnown(id)) return true;
    if (!known.includes(id) || seen.has(id)) return false;
    seen.add(id);
    return true;
  });
  return [...kept, ...FEATURES.filter((f) => known.includes(f) && !seen.has(f))];
}

/**
 * `stored` with the features this release knows replaced by `edited`, and
 * everything else kept as it was: a newer release's feature ids (with their
 * quotas, and where they are switched off) and its sections.
 */
export function mergeKnown(stored: StoredCatalog, edited: Catalog): StoredCatalog {
  const plans: StoredCatalog['plans'] = { ...stored.plans };
  for (const planId of PLAN_IDS) {
    const before = stored.plans[planId];
    plans[planId] = {
      ...before,
      features: mergeIds(before.features, edited.plans[planId].features),
      quotas: { ...Object.fromEntries(Object.entries(before.quotas).filter(([id]) => !isKnown(id))), ...edited.plans[planId].quotas },
    };
  }
  const merged: StoredCatalog = { ...stored, plans, disabled: mergeIds(stored.disabled, edited.disabled) };
  // The Learn section the same way: what this release knows from the edit, the rest as it was.
  const learn = mergeLearnSection(stored.learn, edited.learn as LearnSection | undefined);
  if (learn === undefined) delete merged.learn;
  else merged.learn = learn;
  return merged;
}

type PlanState = Pick<PlanDoc, 'active' | 'features' | 'limits' | 'dailyLimits'>;
type WantedPlan = Omit<PlanDoc, '_id' | 'updatedAt'> & { learn: NonNullable<PlanDoc['learn']> };

/**
 * The plans in force as a catalog (for a database whose catalog history was
 * lost, and to show what applies when the published catalog cannot be read):
 * each plan's features and caps, a missing or switched-off plan with nothing.
 */
export function catalogFromPlans(plans: Partial<Record<PlanId, PlanState>>): Catalog {
  const entry = (planId: PlanId): Catalog['plans'][PlanId] => {
    const plan = plans[planId];
    if (!plan?.active) return { features: [], quotas: {} };
    const features = FEATURES.filter((f) => plan.features.includes(f));
    const quotas: Catalog['plans'][PlanId]['quotas'] = {};
    for (const feature of features) {
      if (!hasQuota(feature)) continue;
      const month = plan.limits?.[feature];
      const day = plan.dailyLimits?.[feature];
      // `plans` holds one cap per feature (the catalog has one quota per feature).
      if (month !== undefined) quotas[feature] = { limit: month, period: 'month' };
      else if (day !== undefined) quotas[feature] = { limit: day, period: 'day' };
    }
    return { features, quotas };
  };
  return { plans: { free: entry('free'), pro: entry('pro') }, disabled: [] };
}

/** What version 1 holds when no catalog was ever published: the plans in force if there are any (the catalog's history was lost), else the defaults. */
export async function initialCatalog(db: Db): Promise<{ document: Catalog; note: string }> {
  const docs = await collections(db).plans.find({}, { projection: { active: 1, features: 1, limits: 1, dailyLimits: 1 } }).toArray();
  if (docs.length === 0) return { document: defaultCatalog(), note: 'Defaults from the code' };
  const plans = Object.fromEntries(docs.map((p) => [p._id, p])) as Partial<Record<PlanId, PlanState>>;
  return { document: catalogFromPlans(plans), note: 'From the plans in force (no catalog had been published)' };
}

const sameJson = (a: unknown, b: unknown) => JSON.stringify(a ?? {}) === JSON.stringify(b ?? {});

/**
 * The `plans` documents a catalog asks for: features (minus switched-off
 * ones, in the canonical order), quotas, and the plan's Learn access (its
 * rules and what locked items show).
 */
export function planDocsFor(catalog: Catalog): Record<PlanId, WantedPlan> {
  const learn = learnSectionOf(catalog);
  return Object.fromEntries(
    PLAN_IDS.map((planId) => {
      const entry = catalog.plans[planId];
      const limits: Partial<Record<FeatureId, number>> = {};
      const dailyLimits: Partial<Record<FeatureId, number>> = {};
      for (const feature of FEATURES) {
        const quota = hasQuota(feature) ? entry.quotas[feature] : undefined;
        if (quota?.period === 'month') limits[feature] = quota.limit;
        if (quota?.period === 'day') dailyLimits[feature] = quota.limit;
      }
      const features = FEATURES.filter((f) => entry.features.includes(f) && !catalog.disabled.includes(f));
      return [planId, { name: PLAN_NAMES[planId], active: true, features, limits, dailyLimits, learn: planLearnAccess(learn, planId) }];
    }),
  ) as Record<PlanId, WantedPlan>;
}

/**
 * Whether a stored plan document already says what `wanted` says. Its Learn
 * access is compared as entitlements read it, so a plan written before M4
 * (no Learn field: nothing opens) matches a catalog that opens nothing, and is
 * not rewritten.
 */
export const planDocMatches = (stored: Partial<PlanDoc> | null, wanted: WantedPlan): boolean =>
  stored !== null &&
  stored.name === wanted.name &&
  stored.active === wanted.active &&
  sameJson(stored.features, wanted.features) &&
  sameJson(stored.limits, wanted.limits) &&
  sameJson(stored.dailyLimits, wanted.dailyLimits) &&
  sameJson(learnAccessOf(stored.learn, String(stored._id ?? ''), () => undefined), wanted.learn);

/**
 * Bring `plans` in step with a catalog. Only plans that differ are written.
 * A plan's Learn access is written only once it says something (a rule other
 * than None, or thumbnails for locked items) or the plan already has one: a
 * plan without it opens nothing, so plans stay as earlier releases wrote them
 * until Learn is published (ADR-0017).
 */
export async function syncPlans(db: Db, catalog: Catalog, now = new Date()): Promise<{ inserted: number; updated: number }> {
  const { plans } = collections(db);
  let inserted = 0;
  let updated = 0;
  for (const [planId, wanted] of Object.entries(planDocsFor(catalog)) as [PlanId, WantedPlan][]) {
    const stored = await plans.findOne({ _id: planId });
    const { learn, ...rest } = wanted;
    const silent = sameJson(learn, NO_LEARN_ACCESS());
    if (!stored) {
      await plans.insertOne({ _id: planId, ...(silent ? rest : wanted), updatedAt: now });
      inserted += 1;
    } else if (!planDocMatches(stored, wanted)) {
      await plans.updateOne({ _id: planId }, { $set: { ...(silent && stored.learn === undefined ? rest : wanted), updatedAt: now } });
      updated += 1;
    }
  }
  return { inserted, updated };
}

export const catalogSpec: ConfigSpec<StoredCatalog> = {
  kind: 'catalog',
  schema: StoredCatalogSchema,
  defaults: defaultCatalog,
  // A version this release cannot apply in full is kept, never written or published from here.
  check: (stored) => {
    const read = readCatalog(stored);
    if (read.status === 'unreadable') return read.issues;
    return [...read.withheld.map((w) => `${PLAN_NAMES[w.plan]}: ${FEATURE_LABELS[w.feature]} has ${w.reason}`), ...read.withheldRules.map(withheldRuleNote)];
  },
  // Selected lists may name only items of the published Learn content (ADR-0017).
  checkWithDb: async (db, stored, stage) => {
    if (stage !== 'publish') return [];
    const read = readCatalog(stored);
    if (read.status === 'unreadable' || !read.catalog.learn) return [];
    const live = await getPublished(db, catalogSpec);
    const liveRead = live ? readCatalog(live.document) : null;
    const liveLearn = liveRead && liveRead.status !== 'unreadable' ? learnSectionOf(liveRead.catalog) : defaultLearnSection();
    return learnListIssues(read.catalog.learn as LearnSection, liveLearn, await publishedLearnContent(db));
  },
  onPublish: async (db, stored) => {
    const read = readCatalog(stored);
    if (read.status !== 'unreadable') await syncPlans(db, read.catalog);
  },
};

/**
 * Save the editor's form as the draft. The form can change only the features
 * this release knows; everything else in the draft (or, without one, in what
 * is live) is kept exactly as it is. A draft this release cannot fully apply
 * is not edited from here.
 */
export async function saveCatalogEdit(db: Db, form: unknown, actor: string, note: string | null = null): Promise<SaveResult> {
  const edited = CatalogSchema.safeParse(form);
  if (!edited.success) return { status: 'invalid', issues: issuesOf(edited.error) };
  const base = (await getDraft(db, catalogSpec)) ?? (await getPublished(db, catalogSpec));
  const read = readCatalog(base?.document ?? defaultCatalog());
  if (read.status !== 'ok') {
    return { status: 'invalid', issues: [`version ${base?.version ?? '—'} has settings this version of the app cannot edit safely`, ...catalogReadNotes(read)] };
  }
  return saveDraft(db, catalogSpec, mergeKnown(read.stored, edited.data), actor, note);
}

/**
 * Why a Learn section must not be published against this content: a
 * Selected list may name only items of the published content, in its own
 * collection, and an item newly added to a list must be published. An item
 * already in the live list may have been unpublished since: it keeps its
 * place (hidden from everyone), so publishing it again restores the same
 * access (ADR-0017).
 */
export function learnListIssues(next: LearnSection, live: LearnSection, content: LearnContent): string[] {
  const items = new Map(itemsOf(content).map((item) => [item.id, item]));
  const issues: string[] = [];
  for (const planId of PLAN_IDS) {
    for (const collection of LEARN_COLLECTIONS) {
      const rule = next.access[planId][collection];
      if (rule.mode !== 'selected') continue;
      const before = live.access[planId][collection];
      const kept = new Set(before.mode === 'selected' ? before.items : []);
      const where = `${PLAN_NAMES[planId]} · ${COLLECTION_LABELS[collection]}`;
      for (const id of rule.items) {
        const item = items.get(id);
        if (!item) issues.push(`${where}: ${id} is not in the published Learn content`);
        else if (item.collection !== collection || collectionOfId(id) !== collection) issues.push(`${where}: ${id} belongs to another collection`);
        else if (!item.published && !kept.has(id)) issues.push(`${where}: ${id} is not published, so it cannot be added`);
      }
      if (rule.made?.by === 'first' && rule.made.n < 1) issues.push(`${where}: First N needs N of at least 1`);
    }
  }
  return issues;
}

/**
 * The Learn items each plan opens with this catalog and content, in order:
 * each item's own access mode (ADR-0023); the catalog's old rules decide
 * only items written before modes.
 */
export function planOpens(catalog: Catalog, content: LearnContent): Record<PlanId, string[]> {
  const docs = planDocsFor(catalog);
  const legacy = legacyLearnOf({ free: { active: true, features: docs.free.features, learn: docs.free.learn }, pro: { active: true, features: docs.pro.features, learn: docs.pro.learn } });
  return Object.fromEntries(
    PLAN_IDS.map((planId) => {
      const view = learnAccess({ active: true, admin: false, pro: planId === 'pro', legacy }, content);
      return [planId, LEARN_COLLECTIONS.flatMap((collection) => view.opens(collection))];
    }),
  ) as Record<PlanId, string[]>;
}

const opensUnder = (catalog: Catalog, content: LearnContent) =>
  Object.fromEntries(Object.entries(planOpens(catalog, content)).map(([planId, ids]) => [planId, new Set(ids)])) as Record<PlanId, Set<string>>;

const quotaText = (quota: Quota | undefined) => (quota ? `${quota.limit} per ${quota.period}` : 'unlimited');

/**
 * What publishing `next` would change compared with `current`, in words.
 * With the published Learn content, the Learn items each plan gains and
 * loses as well.
 */
export function describeCatalogChanges(current: Catalog, next: Catalog, content: LearnContent | null = null): string[] {
  const changes: string[] = [];
  for (const planId of PLAN_IDS) {
    const before = current.plans[planId];
    const after = next.plans[planId];
    for (const feature of FEATURES) {
      const had = before.features.includes(feature);
      const has = after.features.includes(feature);
      if (had && !has) changes.push(`${PLAN_NAMES[planId as PlanId]}: removes ${FEATURE_LABELS[feature]}`);
      if (!had && has) changes.push(`${PLAN_NAMES[planId as PlanId]}: adds ${FEATURE_LABELS[feature]}`);
      const q1 = quotaText(before.quotas[feature]);
      const q2 = quotaText(after.quotas[feature]);
      if (has && q1 !== q2) changes.push(`${PLAN_NAMES[planId as PlanId]}: ${FEATURE_LABELS[feature]} ${q1} → ${q2}`);
    }
  }
  for (const feature of FEATURES) {
    const was = current.disabled.includes(feature);
    const is = next.disabled.includes(feature);
    if (!was && is) changes.push(`Switches off ${FEATURE_LABELS[feature]} for everyone except admins`);
    if (was && !is) changes.push(`Switches ${FEATURE_LABELS[feature]} back on`);
  }
  const learnBefore = learnSectionOf(current);
  const learnAfter = learnSectionOf(next);
  for (const planId of PLAN_IDS) {
    for (const collection of LEARN_COLLECTIONS) {
      const a = learnBefore.access[planId][collection];
      const b = learnAfter.access[planId][collection];
      if (!sameRule(a, b)) changes.push(`${PLAN_NAMES[planId]} · ${COLLECTION_LABELS[collection]}: ${ruleText(a)} → ${ruleText(b)}`);
    }
  }
  if (learnBefore.previews !== learnAfter.previews) {
    const text = (p: string) => (p === 'thumbnail' ? 'the title and a thumbnail' : 'the title only');
    changes.push(`Locked Learn items in lists show ${text(learnBefore.previews)} → ${text(learnAfter.previews)}`);
  }
  if (content) {
    const before = opensUnder(current, content);
    const after = opensUnder(next, content);
    for (const planId of PLAN_IDS) {
      const gains = [...after[planId]].filter((id) => !before[planId].has(id));
      const losses = [...before[planId]].filter((id) => !after[planId].has(id));
      if (gains.length > 0) changes.push(`${PLAN_NAMES[planId]}: gains ${gains.join(', ')}`);
      if (losses.length > 0) changes.push(`${PLAN_NAMES[planId]}: loses ${losses.join(', ')}`);
    }
  }
  return changes;
}
