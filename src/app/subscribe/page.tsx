import type { Metadata } from 'next';
import Link from 'next/link';
import { BrandMark } from '@/components/shell/BrandMark';
import { getRequestLocale, getT } from '@/i18n/server';
import { formatMoney } from '@/lib/money';
import { formatRate } from '@/server/billing/fx';
import { getPayPalClient, type PayPalClient } from '@/server/billing/paypal/client';
import { checkoutCurrency, checkoutEligibility, quoteFor } from '@/server/billing/paypal/subscriptions';
import { getDb } from '@/server/db/client';
import { toObjectId } from '@/server/db/collections';
import { requireStudioAccount } from '@/server/studio-account';
import { SubscribeForm } from './SubscribeForm';

// Checkout (docs/billing/03-paypal.md): the exact monthly amount in the
// account's currency, how renewal, stopping and refunds work, and the
// consent, before anything is sent to PayPal.

export const metadata: Metadata = { title: 'Subscribe · Studio Companion', robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';

function paypal(): PayPalClient | null {
  try {
    return getPayPalClient();
  } catch {
    return null;
  }
}

export default async function SubscribePage() {
  const { account } = await requireStudioAccount('/subscribe');
  const t = await getT('billing');
  const locale = await getRequestLocale();
  const db = getDb();
  const userId = toObjectId(account.id)!;
  const client = paypal();
  const date = (at: Date) => new Intl.DateTimeFormat(locale, { dateStyle: 'long' }).format(at);

  let unavailable: string | null = null;
  let offer: Awaited<ReturnType<typeof quoteFor>> | null = null;
  if (!client) unavailable = t('unavailable.no_price');
  else {
    const eligible = await checkoutEligibility(db, userId);
    if (eligible.ok === false) unavailable = eligible.reason === 'paid_until' ? t('unavailable.paid_until', { date: date(eligible.until!) }) : t(`unavailable.${eligible.reason as 'no_price'}`);
    else {
      offer = await quoteFor(db, checkoutCurrency(account.currency));
      if (offer.ok === false) unavailable = t(`unavailable.${offer.reason}`);
    }
  }
  const quote = offer && offer.ok ? offer.quote : null;
  const price = quote ? formatMoney(quote.amountMinor, quote.currency, locale) : '';

  return (
    <main className="min-h-[100dvh] bg-background" style={{ paddingTop: 'env(safe-area-inset-top)', paddingBottom: 'env(safe-area-inset-bottom)' }}>
      <div className="mx-auto w-full max-w-xl px-4 pb-12 pt-5 md:px-6 md:pt-8">
        <header className="flex items-center justify-between gap-4">
          <Link href="/app" aria-label={t('checkout.back')} className="rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <BrandMark />
          </Link>
          <Link href="/app" className="rounded-lg px-3 py-2 text-sm font-medium text-foreground hover:bg-secondary">
            {t('checkout.back')}
          </Link>
        </header>

        <h1 className="mt-8 text-[28px] font-bold leading-tight tracking-tight text-foreground">{t('checkout.title')}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t('checkout.lead')}</p>

        {client?.environment === 'sandbox' && (
          <p role="note" className="mt-4 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-foreground">
            {t('sandbox')}
          </p>
        )}

        {unavailable || !quote ? (
          <section className="mt-6 rounded-2xl border border-border bg-card p-5 shadow-sm">
            <h2 className="font-semibold text-foreground">{t('unavailable.title')}</h2>
            <p className="mt-2 text-sm text-muted-foreground">{unavailable}</p>
            <Link href="/app/profile" className="mt-4 inline-flex text-sm font-medium text-primary underline-offset-2 hover:underline">
              {t('unavailable.account')}
            </Link>
          </section>
        ) : (
          <section className="mt-6 rounded-2xl border border-border bg-card p-5 shadow-sm md:p-6">
            <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">{t('checkout.price')}</p>
            <p className="mt-1 text-3xl font-bold tracking-tight text-foreground">{t('perMonth', { price })}</p>
            <p className="mt-2 text-sm text-foreground">{t('checkout.renews')}</p>
            {quote.fx && (
              <p className="mt-2 text-sm text-muted-foreground">
                {t('checkout.converted', { usd: formatMoney(quote.base.amountMinor, 'USD', locale), rate: formatRate(quote.fx.rateMicros), date: date(new Date(`${quote.fx.rateDate}T12:00:00Z`)) })}
              </p>
            )}
            <p className="mt-2 text-sm text-muted-foreground">{t('checkout.keep')}</p>
            <div id="subscribe-terms" className="mt-4 space-y-2 border-t border-border pt-4 text-sm text-muted-foreground">
              <p>{t('checkout.cancelTerms')}</p>
              <p>{t('checkout.refundTerms')}</p>
              <p>
                {t('checkout.currency', { currency: quote.currency })}{' '}
                <Link href="/app/profile" className="font-medium text-primary underline-offset-2 hover:underline">
                  {t('checkout.changeCurrency')}
                </Link>
              </p>
            </div>
            <SubscribeForm shown={{ amountMinor: quote.amountMinor, currency: quote.currency, rateDate: quote.fx?.rateDate ?? null }} priceLabel={price} />
          </section>
        )}
      </div>
    </main>
  );
}
