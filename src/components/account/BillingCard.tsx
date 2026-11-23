'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { CreditCard } from 'lucide-react';
import { useLocale, useTranslations } from 'use-intl';
import { requestMyRefund, stopMyRenewal } from '@/app/app/profile/actions';
import type { AccountSummary } from '@/lib/account';
import { formatMoney } from '@/lib/money';

// The account page's billing (docs/billing/03-paypal.md): the subscription as
// PayPal last reported it, its payments, and the two separate actions —
// stopping automatic renewal (Pro stays until the paid period ends) and
// asking to cancel with a refund (the owner decides). Every value comes from
// the server; the buttons only ask it to act.

const PAYPAL_AUTOPAY = { live: 'https://www.paypal.com/myaccount/autopay/', sandbox: 'https://www.sandbox.paypal.com/myaccount/autopay/' };

export function BillingCard({ account, onChanged }: { account: AccountSummary; onChanged?: () => void | Promise<void> }) {
  const t = useTranslations('billing.account');
  const locale = useLocale();
  const [open, setOpen] = useState<'stop' | 'refund' | null>(null);
  const [reason, setReason] = useState('');
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);
  const [pending, startTransition] = useTransition();
  const billing = account.billing;
  const sub = billing?.subscription ?? null;
  if (!billing || (!sub && billing.payments.length === 0)) return null;

  const date = (iso: string | null) => (iso ? new Intl.DateTimeFormat(locale, { dateStyle: 'long' }).format(new Date(iso)) : '—');
  const price = (minor: number, currency: 'USD' | 'ILS') => formatMoney(minor, currency, locale);
  const stillPaid = sub?.paidThrough ? new Date(sub.paidThrough).getTime() > Date.now() : false;
  const status = !sub ? null : sub.status === 'past_due' ? t('pastDue') : sub.renewing ? t('active') : stillPaid ? t('stopped') : t('ended');
  const refundOpen = billing.refundRequest?.status === 'open';

  function act(kind: 'stop' | 'refund') {
    setMessage(null);
    startTransition(async () => {
      const result = kind === 'stop' ? await stopMyRenewal() : await requestMyRefund({ reason: reason.trim() || undefined });
      setMessage(result.ok ? { tone: 'ok', text: result.message ?? '' } : { tone: 'error', text: result.message });
      setOpen(null);
      await onChanged?.();
    });
  }

  return (
    <section aria-label={t('section')} className="mt-4 rounded-2xl border border-border bg-card p-4 shadow-sm md:p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">{t('section')}</p>
          {sub && <p className="mt-1 text-xl font-semibold text-foreground">{t('amount', { price: price(sub.amountMinor, sub.currency) })}</p>}
          {status && <p className="mt-1 text-sm text-muted-foreground">{status}</p>}
        </div>
        <CreditCard className="h-6 w-6 shrink-0 text-primary" aria-hidden="true" />
      </div>

      {sub && (
        <dl className="mt-3 space-y-1 text-sm">
          {sub.renewing && sub.nextBillingAt ? (
            <Row label={t('nextPayment')} value={date(sub.nextBillingAt)} />
          ) : (
            stillPaid && <Row label={t('proUntil')} value={date(sub.paidThrough)} />
          )}
          <Row label={t('paidWith')} value={t('paypal')} />
        </dl>
      )}
      {sub?.status === 'past_due' && <p className="mt-3 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-foreground">{t('pastDueHelp')}</p>}
      {billing.refundRequest && (
        <p className="mt-3 text-sm text-muted-foreground">{refundOpen ? t('refundOpen', { date: date(billing.refundRequest.requestedAt) }) : t('refundClosed')}</p>
      )}
      {message && (
        <p role={message.tone === 'error' ? 'alert' : 'status'} className={`mt-3 rounded-lg border px-3 py-2 text-sm text-foreground ${message.tone === 'error' ? 'border-destructive/40 bg-destructive/10' : 'border-primary/40 bg-primary/10'}`}>
          {message.text}
        </p>
      )}

      {sub && (sub.renewing || (stillPaid && !refundOpen)) && open === null && (
        <div className="mt-4 flex flex-wrap gap-2">
          {sub.renewing && (
            <button type="button" onClick={() => setOpen('stop')} className="h-10 rounded-xl border border-border px-4 text-sm font-medium text-foreground hover:bg-secondary">
              {t('stop')}
            </button>
          )}
          {stillPaid && !refundOpen && (
            <button type="button" onClick={() => setOpen('refund')} className="h-10 rounded-xl border border-border px-4 text-sm font-medium text-foreground hover:bg-secondary">
              {t('refund')}
            </button>
          )}
          <Link
            href={sub.sandbox ? PAYPAL_AUTOPAY.sandbox : PAYPAL_AUTOPAY.live}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex h-10 items-center rounded-xl px-2 text-sm font-medium text-primary underline-offset-2 hover:underline"
          >
            {t('managePayPal')}
          </Link>
        </div>
      )}

      {open && sub && (
        <div role="group" aria-label={open === 'stop' ? t('stopTitle') : t('refundTitle')} className="mt-4 rounded-xl border border-border bg-background p-4">
          <p className="font-semibold text-foreground">{open === 'stop' ? t('stopTitle') : t('refundTitle')}</p>
          <p className="mt-1 text-sm text-muted-foreground">{open === 'stop' ? t('stopBody', { date: date(sub.paidThrough) }) : t('refundBody')}</p>
          {open === 'refund' && (
            <label className="mt-3 block text-sm text-foreground">
              {t('refundReason')}
              <textarea value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} rows={3} className="mt-1 block w-full rounded-lg border border-border bg-background px-3 py-2 text-sm" />
            </label>
          )}
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              disabled={pending}
              onClick={() => act(open)}
              className="h-10 rounded-xl bg-destructive px-4 text-sm font-semibold text-destructive-foreground hover:opacity-90 disabled:opacity-50"
            >
              {open === 'stop' ? t('stopConfirm') : t('refundConfirm')}
            </button>
            <button type="button" disabled={pending} onClick={() => setOpen(null)} className="h-10 rounded-xl border border-border px-4 text-sm font-medium text-foreground hover:bg-secondary">
              {open === 'stop' ? t('keep') : t('cancel')}
            </button>
          </div>
        </div>
      )}

      {billing.payments.length > 0 && (
        <div className="mt-4 border-t border-border pt-3">
          <p className="text-sm font-medium text-foreground">{t('payments')}</p>
          <ul className="mt-2 space-y-1 text-sm">
            {billing.payments.map((p, i) => (
              <li key={`${p.at}-${i}`} className="flex justify-between gap-3">
                <span className="text-muted-foreground">{date(p.at)}</span>
                <span className="text-foreground">
                  {price(p.amountMinor, p.currency)} · {p.kind === 'refund' ? t('refunded') : p.kind === 'chargeback' ? t('reversed') : p.status === 'failed' ? t('failed') : t('paid')}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-medium text-foreground">{value}</dd>
    </div>
  );
}
