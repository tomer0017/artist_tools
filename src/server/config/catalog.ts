import 'server-only';
import type { Db } from 'mongodb';
import { z } from 'zod';
import { FEATURES, FEATURE_LABELS, PLAN_FEATURES, PLAN_IDS, PLAN_NAMES, type FeatureId, type PlanId } from '@/lib/plans';
import { collections } from '@/server/db/collections';
import { clearPlanCache } from '@/server/entitlements';
import type { ConfigSpec } from './versions';

// ─── The plan catalog ─────────────────────────────────────────────────────────
// Which features each plan includes, usage quotas per plan (per day or per
// calendar month, UTC), and features switched off for everyone but admins.
// Feature ids are code (a feature needs code that checks it); everything else
// here is the owner's to change. Version 1 is today's matrix: Free keeps all
// five tools and every save, no quotas, nothing switched off. Publishing a
// version writes it to `plans`, which entitlements read (and which older
// releases still understand: monthly quotas stay in `limits`).

const Feature = z.enum(FEATURES);
const Quota = z.object({ limit: z.number().int().min(1).max(1_000_000), period: z.enum(['day', 'month']) });
const PlanEntry = z.object({
  features: z.array(Feature).max(FEATURES.length),
  quotas: z.record(Feature, Quota).default({}),
});

export const CatalogSchema = z
  .object({
    plans: z.object({ free: PlanEntry, pro: PlanEntry }),
    disabled: z.array(Feature).default([]),
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
export type Quota = z.infer<typeof Quota>;

export function defaultCatalog(): Catalog {
  return {
    plans: { free: { features: [...PLAN_FEATURES.free], quotas: {} }, pro: { features: [...PLAN_FEATURES.pro], quotas: {} } },
    disabled: [],
  };
}

const sameJson = (a: unknown, b: unknown) => JSON.stringify(a ?? {}) === JSON.stringify(b ?? {});

/**
 * Bring `plans` in step with a catalog: features (minus switched-off ones, in
 * the canonical order) and quotas. Only plans that differ are written.
 */
export async function syncPlans(db: Db, catalog: Catalog, now = new Date()): Promise<{ inserted: number; updated: number }> {
  const { plans } = collections(db);
  let inserted = 0;
  let updated = 0;
  for (const planId of PLAN_IDS) {
    const entry = catalog.plans[planId];
    const limits: Partial<Record<FeatureId, number>> = {};
    const dailyLimits: Partial<Record<FeatureId, number>> = {};
    for (const feature of FEATURES) {
      const quota = entry.quotas[feature];
      if (quota?.period === 'month') limits[feature] = quota.limit;
      if (quota?.period === 'day') dailyLimits[feature] = quota.limit;
    }
    const wanted = {
      name: PLAN_NAMES[planId],
      active: true,
      features: FEATURES.filter((f) => entry.features.includes(f) && !catalog.disabled.includes(f)),
      limits,
      dailyLimits,
    };
    const stored = await plans.findOne({ _id: planId });
    if (!stored) {
      await plans.insertOne({ _id: planId, ...wanted, updatedAt: now });
      inserted += 1;
    } else if (
      stored.name !== wanted.name ||
      stored.active !== wanted.active ||
      !sameJson(stored.features, wanted.features) ||
      !sameJson(stored.limits, wanted.limits) ||
      !sameJson(stored.dailyLimits, wanted.dailyLimits)
    ) {
      await plans.updateOne({ _id: planId }, { $set: { ...wanted, updatedAt: now } });
      updated += 1;
    }
  }
  clearPlanCache();
  return { inserted, updated };
}

export const catalogSpec: ConfigSpec<Catalog> = {
  kind: 'catalog',
  schema: CatalogSchema,
  defaults: defaultCatalog,
  onPublish: async (db, catalog) => {
    await syncPlans(db, catalog);
  },
};

const quotaText = (quota: Quota | undefined) => (quota ? `${quota.limit} per ${quota.period}` : 'unlimited');

/** What publishing `next` would change compared with `current`, in words. */
export function describeCatalogChanges(current: Catalog, next: Catalog): string[] {
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
  return changes;
}
