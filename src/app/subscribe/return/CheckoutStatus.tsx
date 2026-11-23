'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'use-intl';
import { checkCheckout, type CheckoutStateResult } from '../actions';

// After PayPal: what the server read from PayPal, asked again every few
// seconds while the payment is being confirmed (for up to two minutes; after
// that the account still updates on its own once PayPal confirms).

const EVERY_MS = 3000;
const TRIES = 40;

export function CheckoutStatus({ sessionId, initial }: { sessionId: string | null; initial: CheckoutStateResult }) {
  const t = useTranslations('billing.result');
  const locale = useLocale();
  const [status, setStatus] = useState(initial);
  const [tries, setTries] = useState(0);

  useEffect(() => {
    if (!sessionId || status.state !== 'pending' || tries >= TRIES) return;
    const timer = window.setTimeout(async () => {
      const next = await checkCheckout(sessionId).catch(() => null);
      if (next) setStatus(next);
      setTries((n) => n + 1);
    }, EVERY_MS);
    return () => window.clearTimeout(timer);
  }, [sessionId, status, tries]);

  const date = status.paidThrough ? new Intl.DateTimeFormat(locale, { dateStyle: 'long' }).format(new Date(status.paidThrough)) : null;
  const waiting = status.state === 'pending';
  return (
    <section aria-live="polite" className="mt-6 rounded-2xl border border-border bg-card p-5 shadow-sm md:p-6">
      <p role="status" className="text-lg font-semibold text-foreground">
        {waiting ? (tries >= TRIES ? t('pendingLong') : t('pending')) : t(status.state)}
      </p>
      {status.state === 'active' && date && <p className="mt-2 text-sm text-muted-foreground">{t('activeUntil', { date })}</p>}
      <div className="mt-5 flex flex-wrap gap-3">
        <Link href="/app" className="inline-flex h-11 items-center rounded-xl bg-primary px-5 text-sm font-semibold text-primary-foreground hover:opacity-90">
          {t('openStudio')}
        </Link>
        <Link href="/app/profile" className="inline-flex h-11 items-center rounded-xl border border-border px-5 text-sm font-medium text-foreground hover:bg-secondary">
          {t('account')}
        </Link>
        {(status.state === 'cancelled' || status.state === 'expired') && (
          <Link href="/subscribe" className="inline-flex h-11 items-center rounded-xl border border-border px-5 text-sm font-medium text-foreground hover:bg-secondary">
            {t('tryAgain')}
          </Link>
        )}
      </div>
    </section>
  );
}
