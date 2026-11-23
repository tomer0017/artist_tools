'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { formatMoney, fromMinor, toMinor } from '@/lib/money';
import type { ActionResult } from '../actions';
import { saveConfigDraft } from '../config-actions';

// The one Pro price: monthly, in USD (docs/billing/03-paypal.md). Typed in
// dollars ("9.90"), stored as cents. Saved as a draft and published from the
// bar above, like every versioned setting; only the owner may. A new price
// applies to subscriptions started after it is published: everyone already
// subscribed keeps the amount they agreed to.

export const BASE_PRICE_ID = 'pro-month-usd';

export function BasePriceEditor({ amountMinor, editable }: { amountMinor: number | null; editable: boolean }) {
  const [amount, setAmount] = useState(amountMinor === null ? '' : fromMinor(amountMinor, 'USD'));
  const [result, setResult] = useState<ActionResult | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const minor = toMinor(amount, 'USD');

  function save() {
    if (minor === null || minor < 100) {
      setResult({ ok: false, message: `“${amount}” is not a price. Use digits like 9.90 (at least 1.00).` });
      return;
    }
    const document = { prices: [{ id: BASE_PRICE_ID, planId: 'pro', interval: 'month', currency: 'USD', amountMinor: minor, trialDays: null, active: true, providerRefs: {} }] };
    startTransition(async () => {
      setResult(await saveConfigDraft({ kind: 'pricing', document }));
      router.refresh();
    });
  }

  return (
    <section aria-labelledby="base-price" className="mt-4 rounded-2xl border border-border bg-card p-4 md:p-5">
      <h2 id="base-price" className="text-base font-semibold text-foreground">
        Monthly Pro price
      </h2>
      <div className="mt-3 flex flex-wrap items-end gap-3">
        <label className="text-xs font-medium text-muted-foreground">
          USD per month
          <input
            inputMode="decimal"
            value={amount}
            disabled={!editable || pending}
            onChange={(e) => setAmount(e.target.value)}
            aria-invalid={(amount !== '' && minor === null) || undefined}
            className="mt-1 block h-10 w-36 rounded-lg border border-border bg-background px-2 text-base text-foreground aria-[invalid=true]:border-destructive md:text-sm"
          />
        </label>
        {editable && (
          <button type="button" onClick={save} disabled={pending} className="h-10 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground disabled:opacity-50">
            Save draft
          </button>
        )}
        <span className="pb-2 text-sm text-muted-foreground">{minor !== null ? `${formatMoney(minor, 'USD')} a month` : 'No price yet: nobody can subscribe.'}</span>
      </div>
      {!editable && <p className="mt-2 text-xs text-muted-foreground">Start a draft above to change it.</p>}
      {result && (
        <p role={result.ok ? 'status' : 'alert'} className="mt-3 text-sm text-foreground">
          {result.message}
        </p>
      )}
    </section>
  );
}
