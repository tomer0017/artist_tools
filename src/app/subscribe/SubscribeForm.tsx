'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'use-intl';
import { beginCheckout } from './actions';

// The consent and the button: nothing is sent until the box is ticked, and
// what is sent is exactly the offer this page showed (the server refuses if
// the price moved since). PayPal opens in this window, which works the same
// on an iPhone as on a computer.

export function SubscribeForm({ shown, priceLabel }: { shown: { amountMinor: number; currency: 'USD' | 'ILS'; rateDate: string | null }; priceLabel: string }) {
  const t = useTranslations('billing');
  const router = useRouter();
  const [agreed, setAgreed] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function go() {
    setMessage(null);
    startTransition(async () => {
      const result = await beginCheckout({ ...shown, consent: agreed });
      if ('url' in result) {
        setLeaving(true);
        window.location.assign(result.url);
        return;
      }
      const failure = result as Extract<typeof result, { ok: false }>;
      setMessage(failure.message);
      if (failure.refresh) router.refresh();
    });
  }

  const busy = pending || leaving;
  return (
    <div className="mt-5">
      <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-border bg-background p-3 text-sm text-foreground">
        <input
          type="checkbox"
          checked={agreed}
          onChange={(event) => setAgreed(event.target.checked)}
          className="mt-0.5 h-5 w-5 shrink-0 accent-primary"
          aria-describedby="subscribe-terms"
        />
        <span>{t('checkout.consent', { price: priceLabel })}</span>
      </label>
      <button
        type="button"
        onClick={go}
        disabled={!agreed || busy}
        className="mt-4 flex h-12 w-full items-center justify-center rounded-xl bg-primary text-[15px] font-semibold text-primary-foreground transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:opacity-50"
      >
        {busy ? t('checkout.continuing') : t('checkout.continue')}
      </button>
      {message && (
        <p role="alert" className="mt-3 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-foreground">
          {message}
        </p>
      )}
    </div>
  );
}
