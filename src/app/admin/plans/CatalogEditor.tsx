'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { FEATURES, FEATURE_LABELS, PLAN_IDS, PLAN_NAMES, type FeatureId, type PlanId } from '@/lib/plans';
import type { ActionResult } from '../actions';
import { saveConfigDraft } from '../config-actions';

// The plan catalog as a form: for each feature, which plans include it, an
// optional quota per plan (per day or per calendar month, UTC), and whether
// it is switched off for everyone but admins. Read-only until a draft exists.

type Quota = { limit: number; period: 'day' | 'month' };
export interface CatalogForm {
  plans: Record<PlanId, { features: FeatureId[]; quotas: Partial<Record<FeatureId, Quota>> }>;
  disabled: FeatureId[];
}

export function CatalogEditor({ catalog, editable }: { catalog: CatalogForm; editable: boolean }) {
  const [form, setForm] = useState<CatalogForm>(catalog);
  const [result, setResult] = useState<ActionResult | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  const toggle = (planId: PlanId, feature: FeatureId, on: boolean) =>
    setForm((f) => {
      const plan = f.plans[planId];
      const features = on ? FEATURES.filter((x) => x === feature || plan.features.includes(x)) : plan.features.filter((x) => x !== feature);
      const quotas = { ...plan.quotas };
      if (!on) delete quotas[feature];
      return { ...f, plans: { ...f.plans, [planId]: { features, quotas } } };
    });
  const setQuota = (planId: PlanId, feature: FeatureId, quota: Quota | null) =>
    setForm((f) => {
      const quotas = { ...f.plans[planId].quotas };
      if (quota) quotas[feature] = quota;
      else delete quotas[feature];
      return { ...f, plans: { ...f.plans, [planId]: { ...f.plans[planId], quotas } } };
    });

  return (
    <div className="mt-4">
      <ul className="grid gap-3 md:grid-cols-2">
        {FEATURES.map((feature) => {
          const off = form.disabled.includes(feature);
          return (
            <li key={feature} className="rounded-2xl border border-border bg-card p-4">
              <div className="flex items-start justify-between gap-3">
                <p className="text-sm font-semibold text-foreground">{FEATURE_LABELS[feature]}</p>
                <label className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
                  <input
                    type="checkbox"
                    checked={off}
                    disabled={!editable}
                    onChange={(e) => setForm((f) => ({ ...f, disabled: e.target.checked ? [...f.disabled, feature] : f.disabled.filter((x) => x !== feature) }))}
                    className="h-4 w-4"
                  />
                  Off for everyone
                </label>
              </div>
              <div className={`mt-3 space-y-2 ${off ? 'opacity-50' : ''}`}>
                {PLAN_IDS.map((planId) => {
                  const plan = form.plans[planId];
                  const included = plan.features.includes(feature);
                  const quota = plan.quotas[feature];
                  return (
                    <div key={planId} className="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm">
                      <label className="flex w-20 items-center gap-2 font-medium text-foreground">
                        <input type="checkbox" checked={included} disabled={!editable} onChange={(e) => toggle(planId, feature, e.target.checked)} className="h-4 w-4" />
                        {PLAN_NAMES[planId]}
                      </label>
                      {included && (
                        <span className="flex items-center gap-1.5 text-muted-foreground">
                          <input
                            type="number"
                            inputMode="numeric"
                            min={1}
                            placeholder="No limit"
                            aria-label={`${PLAN_NAMES[planId]} quota for ${FEATURE_LABELS[feature]}`}
                            disabled={!editable}
                            value={quota?.limit ?? ''}
                            onChange={(e) => {
                              const limit = Math.floor(Number(e.target.value));
                              setQuota(planId, feature, e.target.value === '' || !(limit > 0) ? null : { limit, period: quota?.period ?? 'month' });
                            }}
                            className="h-9 w-24 rounded-lg border border-border bg-background px-2 text-base text-foreground md:text-sm"
                          />
                          <select
                            aria-label={`${PLAN_NAMES[planId]} quota period for ${FEATURE_LABELS[feature]}`}
                            disabled={!editable || !quota}
                            value={quota?.period ?? 'month'}
                            onChange={(e) => quota && setQuota(planId, feature, { ...quota, period: e.target.value as Quota['period'] })}
                            className="h-9 rounded-lg border border-border bg-background px-2 text-base text-foreground md:text-sm"
                          >
                            <option value="month">per month</option>
                            <option value="day">per day</option>
                          </select>
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            </li>
          );
        })}
      </ul>
      {editable && (
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button
            type="button"
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                setResult(await saveConfigDraft({ kind: 'catalog', document: form }));
                router.refresh();
              })
            }
            className="h-11 rounded-xl bg-primary px-5 text-sm font-semibold text-primary-foreground disabled:opacity-60"
          >
            Save draft
          </button>
          <p className="text-xs text-muted-foreground">Admins always keep every feature. Quotas count per UTC day or calendar month.</p>
        </div>
      )}
      {result && (
        <p role="status" className={`mt-2 text-sm ${result.ok ? 'text-primary' : 'text-destructive'}`}>
          {result.message}
        </p>
      )}
    </div>
  );
}
