'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { CURRENCIES, type Currency } from '@/lib/locale';
import { toMinor } from '@/lib/money';
import type { ActionResult } from '../actions';
import { addCoupon, changeCouponStatus } from '../config-actions';

// Create a coupon, and switch one on or off. The server validates and audits
// everything (src/server/coupons.ts); codes are never deleted.

const FIELD = 'mt-1 block h-10 w-full rounded-lg border border-border bg-background px-2 text-base text-foreground md:text-sm';

export function CouponForm() {
  const [code, setCode] = useState('');
  const [kind, setKind] = useState<'percent' | 'fixed'>('percent');
  const [percent, setPercent] = useState('20');
  const [amount, setAmount] = useState('');
  const [currency, setCurrency] = useState<Currency>('USD');
  const [targets, setTargets] = useState<string[]>([]);
  const [startsAt, setStartsAt] = useState(new Date().toISOString().slice(0, 10));
  const [endsAt, setEndsAt] = useState('');
  const [maxRedemptions, setMaxRedemptions] = useState('');
  const [maxPerUser, setMaxPerUser] = useState('1');
  const [note, setNote] = useState('');
  const [result, setResult] = useState<ActionResult | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function submit(event: React.FormEvent) {
    event.preventDefault();
    const amountMinor = kind === 'fixed' ? toMinor(amount, currency) : null;
    if (kind === 'fixed' && amountMinor === null) {
      setResult({ ok: false, message: 'Enter the discount amount, e.g. 5.00.' });
      return;
    }
    startTransition(async () => {
      const r = await addCoupon({
        code,
        kind,
        percentOff: kind === 'percent' ? Math.floor(Number(percent)) : null,
        amountOffMinor: amountMinor,
        currency: kind === 'fixed' ? currency : null,
        appliesTo: targets,
        startsAt,
        endsAt: endsAt || null,
        maxRedemptions: maxRedemptions ? Math.floor(Number(maxRedemptions)) : null,
        maxPerUser: Math.floor(Number(maxPerUser)) || 1,
        note: note || null,
      });
      setResult(r);
      if (r.ok) setCode('');
      router.refresh();
    });
  }

  return (
    <form onSubmit={submit} aria-label="New coupon" className="rounded-2xl border border-border bg-card p-4 md:p-5">
      <h2 className="text-base font-semibold text-foreground">New coupon</h2>
      <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <label className="col-span-2 text-xs font-medium text-muted-foreground">
          Code
          <input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} autoCapitalize="characters" autoComplete="off" spellCheck={false} placeholder="SPRING-ART" className={FIELD} />
        </label>
        <label className="text-xs font-medium text-muted-foreground">
          Discount
          <select value={kind} onChange={(e) => setKind(e.target.value as 'percent' | 'fixed')} className={FIELD}>
            <option value="percent">Percentage</option>
            <option value="fixed">Fixed amount</option>
          </select>
        </label>
        {kind === 'percent' ? (
          <label className="text-xs font-medium text-muted-foreground">
            Percent off
            <input type="number" inputMode="numeric" min={1} max={100} value={percent} onChange={(e) => setPercent(e.target.value)} className={FIELD} />
          </label>
        ) : (
          <div className="grid grid-cols-2 gap-2">
            <label className="text-xs font-medium text-muted-foreground">
              Amount off
              <input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="5.00" className={FIELD} />
            </label>
            <label className="text-xs font-medium text-muted-foreground">
              Currency
              <select value={currency} onChange={(e) => setCurrency(e.target.value as Currency)} className={FIELD}>
                {CURRENCIES.map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
            </label>
          </div>
        )}
        <fieldset className="col-span-2 text-xs font-medium text-muted-foreground">
          <legend>Applies to (none ticked: every Pro price)</legend>
          <div className="mt-2 flex gap-4 text-sm text-foreground">
            {[
              ['pro:month', 'Pro monthly'],
              ['pro:year', 'Pro yearly'],
            ].map(([value, text]) => (
              <label key={value} className="flex items-center gap-2">
                <input type="checkbox" checked={targets.includes(value)} onChange={(e) => setTargets((t) => (e.target.checked ? [...t, value] : t.filter((x) => x !== value)))} className="h-4 w-4" />
                {text}
              </label>
            ))}
          </div>
        </fieldset>
        <label className="text-xs font-medium text-muted-foreground">
          Starts
          <input type="date" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} className={FIELD} />
        </label>
        <label className="text-xs font-medium text-muted-foreground">
          Ends (optional)
          <input type="date" value={endsAt} onChange={(e) => setEndsAt(e.target.value)} className={FIELD} />
        </label>
        <label className="text-xs font-medium text-muted-foreground">
          Uses in total (optional)
          <input type="number" inputMode="numeric" min={1} value={maxRedemptions} onChange={(e) => setMaxRedemptions(e.target.value)} placeholder="Unlimited" className={FIELD} />
        </label>
        <label className="text-xs font-medium text-muted-foreground">
          Uses per person
          <input type="number" inputMode="numeric" min={1} max={100} value={maxPerUser} onChange={(e) => setMaxPerUser(e.target.value)} className={FIELD} />
        </label>
        <label className="col-span-2 text-xs font-medium text-muted-foreground">
          Note for admins (optional)
          <input value={note} maxLength={200} onChange={(e) => setNote(e.target.value)} className={FIELD} />
        </label>
      </div>
      <button type="submit" disabled={pending || code.trim().length < 3} className="mt-4 h-11 rounded-xl bg-primary px-5 text-sm font-semibold text-primary-foreground disabled:opacity-60">
        Create coupon
      </button>
      {result && (
        <p role="status" className={`mt-2 text-sm ${result.ok ? 'text-primary' : 'text-destructive'}`}>
          {result.message}
        </p>
      )}
    </form>
  );
}

export function CouponStatusButton({ couponId, status, code }: { couponId: string; status: 'active' | 'disabled'; code: string }) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const next = status === 'active' ? 'disabled' : 'active';
  return (
    <button
      type="button"
      disabled={pending}
      aria-label={`${next === 'disabled' ? 'Switch off' : 'Switch on'} ${code}`}
      onClick={() =>
        startTransition(async () => {
          await changeCouponStatus({ couponId, status: next });
          router.refresh();
        })
      }
      className="rounded-lg border border-border px-3 py-1.5 text-xs font-semibold text-foreground hover:bg-secondary disabled:opacity-60"
    >
      {next === 'disabled' ? 'Switch off' : 'Switch on'}
    </button>
  );
}
