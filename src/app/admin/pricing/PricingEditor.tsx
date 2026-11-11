'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, Trash2 } from 'lucide-react';
import { CURRENCIES, type Currency } from '@/lib/locale';
import { formatMoney, fromMinor, toMinor } from '@/lib/money';
import type { ActionResult } from '../actions';
import { saveConfigDraft } from '../config-actions';

// Price entries for Pro: one per interval and currency, typed in normal units
// ("9.90") and stored as integer minor units (990). Read-only until a draft
// exists. Nothing here is shown to customers until paid plans launch.

export interface PriceRow {
  id: string;
  planId: 'pro';
  interval: 'month' | 'year';
  currency: Currency;
  amountMinor: number;
  trialDays: number | null;
  active: boolean;
  providerRefs: Record<string, string>;
}

type Editing = Omit<PriceRow, 'amountMinor'> & { amount: string };

const idFor = (row: Pick<PriceRow, 'interval' | 'currency'>, taken: string[]) => {
  const base = `pro-${row.interval}-${row.currency.toLowerCase()}`;
  let id = base;
  for (let n = 2; taken.includes(id); n++) id = `${base}-${n}`;
  return id;
};

export function PricingEditor({ prices, editable }: { prices: PriceRow[]; editable: boolean }) {
  const [rows, setRows] = useState<Editing[]>(prices.map((p) => ({ ...p, amount: fromMinor(p.amountMinor, p.currency) })));
  const [result, setResult] = useState<ActionResult | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const update = (i: number, change: Partial<Editing>) => setRows((list) => list.map((r, j) => (j === i ? { ...r, ...change } : r)));

  function save() {
    const bad = rows.find((r) => toMinor(r.amount, r.currency) === null);
    if (bad) {
      setResult({ ok: false, message: `“${bad.amount}” is not an amount. Use digits like 9.90.` });
      return;
    }
    const document = {
      prices: rows.map(({ amount, ...r }) => ({ ...r, amountMinor: toMinor(amount, r.currency)! })),
    };
    startTransition(async () => {
      setResult(await saveConfigDraft({ kind: 'pricing', document }));
      router.refresh();
    });
  }

  return (
    <div className="mt-4">
      {rows.length === 0 && <p className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">No prices yet: none have been decided.</p>}
      <ul className="space-y-3">
        {rows.map((r, i) => {
          const minor = toMinor(r.amount, r.currency);
          return (
            <li key={`${r.id}-${i}`} className="rounded-2xl border border-border bg-card p-4">
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
                <label className="text-xs font-medium text-muted-foreground">
                  Billed
                  <select value={r.interval} disabled={!editable} onChange={(e) => update(i, { interval: e.target.value as Editing['interval'] })} className="mt-1 block h-10 w-full rounded-lg border border-border bg-background px-2 text-base text-foreground md:text-sm">
                    <option value="month">Monthly</option>
                    <option value="year">Yearly</option>
                  </select>
                </label>
                <label className="text-xs font-medium text-muted-foreground">
                  Currency
                  <select value={r.currency} disabled={!editable} onChange={(e) => update(i, { currency: e.target.value as Currency })} className="mt-1 block h-10 w-full rounded-lg border border-border bg-background px-2 text-base text-foreground md:text-sm">
                    {CURRENCIES.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="text-xs font-medium text-muted-foreground">
                  Amount
                  <input inputMode="decimal" value={r.amount} disabled={!editable} onChange={(e) => update(i, { amount: e.target.value })} aria-invalid={minor === null || undefined} className="mt-1 block h-10 w-full rounded-lg border border-border bg-background px-2 text-base text-foreground aria-[invalid=true]:border-destructive md:text-sm" />
                </label>
                <label className="text-xs font-medium text-muted-foreground">
                  Free trial (days)
                  <input
                    type="number"
                    inputMode="numeric"
                    min={0}
                    max={90}
                    placeholder="None"
                    value={r.trialDays ?? ''}
                    disabled={!editable}
                    onChange={(e) => update(i, { trialDays: e.target.value === '' ? null : Math.max(0, Math.min(90, Math.floor(Number(e.target.value)))) })}
                    className="mt-1 block h-10 w-full rounded-lg border border-border bg-background px-2 text-base text-foreground md:text-sm"
                  />
                </label>
                <label className="flex items-end gap-2 pb-2 text-sm text-foreground">
                  <input type="checkbox" checked={r.active} disabled={!editable} onChange={(e) => update(i, { active: e.target.checked })} className="h-4 w-4" />
                  Offered
                </label>
              </div>
              <div className="mt-2 flex items-center justify-between gap-3 text-xs text-muted-foreground">
                <span>
                  Pro, {r.interval === 'month' ? 'monthly' : 'yearly'}: {minor === null ? '—' : formatMoney(minor, r.currency)}
                  {r.trialDays ? ` · ${r.trialDays}-day trial` : ''} · id {r.id}
                </span>
                {editable && (
                  <button type="button" onClick={() => setRows((list) => list.filter((_, j) => j !== i))} aria-label={`Remove price ${r.id}`} className="flex h-9 w-9 items-center justify-center rounded-lg border border-border hover:bg-secondary">
                    <Trash2 className="h-4 w-4" aria-hidden="true" />
                  </button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
      {editable && (
        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() =>
              setRows((list) => {
                const next = { interval: 'month' as const, currency: 'USD' as Currency };
                return [...list, { ...next, id: idFor(next, list.map((r) => r.id)), planId: 'pro', amount: '0.00', trialDays: null, active: false, providerRefs: {} }];
              })
            }
            className="flex h-11 items-center gap-2 rounded-xl border border-border px-4 text-sm font-semibold text-foreground hover:bg-secondary"
          >
            <Plus className="h-4 w-4" aria-hidden="true" /> Add a price
          </button>
          <button type="button" disabled={pending} onClick={save} className="h-11 rounded-xl bg-primary px-5 text-sm font-semibold text-primary-foreground disabled:opacity-60">
            Save draft
          </button>
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
