import type { Metadata } from 'next';
import Link from 'next/link';
import { Check, Crown, ShieldCheck } from 'lucide-react';
import { BrandMark } from '@/components/shell/BrandMark';
import { getRequestLocale, getT } from '@/i18n/server';
import { formatMoney } from '@/lib/money';
import { formatRate } from '@/server/billing/fx';
import { getPayPalClient, type PayPalClient } from '@/server/billing/paypal/client';
import { checkoutCurrency, checkoutEligibility, quoteFor } from '@/server/billing/paypal/subscriptions';
import { proPerks } from '@/lib/pro-perks';
import { proExtraFor } from '@/server/billing/upsell';
import { getDb } from '@/server/db/client';
import { toObjectId } from '@/server/db/collections';
import { getEntitlements } from '@/server/entitlements';
import { requireStudioAccount } from '@/server/studio-account';
import { SubscribeForm } from './SubscribeForm';

// Checkout (docs/billing/03-paypal.md): what Pro opens for this account (read
// from the published plans and content), and, in the gilt-framed order
// summary, the exact monthly amount in the account's currency, how renewal,
// stopping and refunds work, and the consent, before anything goes to PayPal.

export const metadata: Metadata = { title: 'Subscribe · SketchyArtLab', robots: { index: false, follow: false } };
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
  const ttools = await getT('tools');
  const tplans = await getT('plans');
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

  // What Pro opens for this account, in plain sentences (tools, then Learn, then exports).
  const perks: { key: string; label: string }[] = [];
  if (quote) {
    const extra = await proExtraFor(db, await getEntitlements(db, userId));
    for (const perk of proPerks(extra.rows, extra.learn))
      perks.push({
        key: perk.key,
        label:
          perk.kind === 'count'
            ? t(perk.collection === 'curriculum' ? 'pro.lessons' : 'pro.challenges', { count: perk.count })
            : perk.row.kind === 'tool'
              ? ttools(`${perk.row.id}.title`)
              : tplans(`rows.${perk.row.id}.label`),
      });
  }

  return (
    <main className="min-h-[100dvh] bg-background" style={{ paddingTop: 'env(safe-area-inset-top)', paddingBottom: 'env(safe-area-inset-bottom)' }}>
      <div className="mx-auto w-full max-w-5xl px-4 pb-14 pt-5 md:px-6 md:pt-8">
        <header className="flex items-center justify-between gap-4">
          <Link href="/app" aria-label={t('checkout.back')} className="rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <BrandMark />
          </Link>
          <Link href="/app" className="rounded-lg px-3 py-2 text-sm font-medium text-foreground hover:bg-secondary">
            {t('checkout.back')}
          </Link>
        </header>

        {client?.environment === 'sandbox' && (
          <p role="note" className="mt-6 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-foreground">
            {t('sandbox')}
          </p>
        )}

        {unavailable || !quote ? (
          <section className="mx-auto mt-10 max-w-xl rounded-2xl border border-border bg-card p-6 shadow-sm">
            <h1 className="text-xl font-semibold text-foreground">{t('unavailable.title')}</h1>
            <p className="mt-2 text-sm text-muted-foreground">{unavailable}</p>
            <Link href="/app/profile" className="mt-4 inline-flex text-sm font-medium text-primary underline-offset-2 hover:underline">
              {t('unavailable.account')}
            </Link>
          </section>
        ) : (
          // Phones read top to bottom: what it is, then the order (price, consent,
          // PayPal, the terms), then the details. Wider screens put the order
          // beside both, kept in view while scrolling.
          <div className="mt-8 grid gap-8 md:mt-12 md:grid-cols-[minmax(0,1fr)_minmax(0,25rem)] md:grid-rows-[auto_1fr] md:gap-x-12 md:gap-y-8">
            <header className="md:col-start-1 md:row-start-1">
              <h1 id="subscribe-title" className="flex items-center gap-3 font-display text-[34px] font-bold leading-[1.1] text-ivory md:text-[44px]">
                <Crown className="h-8 w-8 shrink-0 text-primary md:h-10 md:w-10" aria-hidden="true" />
                {t('pro.summaryTitle')}
              </h1>
              <p className="mt-3 max-w-md text-base leading-relaxed text-foreground/75">{t('checkout.lead')}</p>
            </header>

            {/* The order: the exact amount, the consent, the way to PayPal, and the terms under it. */}
            <aside
              aria-labelledby="subscribe-order"
              className="gilt-frame rounded-[14px] p-6 shadow-[0_30px_80px_-40px_rgba(0,0,0,0.9)] md:sticky md:top-8 md:col-start-2 md:row-span-2 md:row-start-1 md:self-start md:p-7"
            >
              <h2 id="subscribe-order" className="text-sm font-semibold text-foreground">
                {t('checkout.price')}
              </h2>
              <p className="mt-3 flex items-baseline gap-2 text-ivory">
                <span className="font-display text-[48px] font-bold leading-none tabular-nums">{price}</span>
                <span className="text-sm text-foreground/70">{t('pro.perMonthUnit')}</span>
              </p>
              <p className="mt-3 text-sm leading-relaxed text-foreground/80">{t('checkout.renews')}</p>
              {quote.fx && (
                <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                  {t('checkout.converted', { usd: formatMoney(quote.base.amountMinor, 'USD', locale), rate: formatRate(quote.fx.rateMicros), date: date(new Date(`${quote.fx.rateDate}T12:00:00Z`)) })}
                </p>
              )}
              <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                {t('checkout.keep')}{' '}
                {t('checkout.currency', { currency: quote.currency })}{' '}
                <Link href="/app/profile" className="font-medium text-primary underline-offset-2 hover:underline">
                  {t('checkout.changeCurrency')}
                </Link>
              </p>
              <SubscribeForm shown={{ amountMinor: quote.amountMinor, currency: quote.currency, rateDate: quote.fx?.rateDate ?? null }} priceLabel={price} />
              <div id="subscribe-terms" className="mt-5 space-y-2 border-t border-white/10 pt-4 text-xs leading-relaxed text-muted-foreground">
                <p className="flex items-start gap-2">
                  <ShieldCheck className="mt-px h-4 w-4 shrink-0 text-primary/80" aria-hidden="true" />
                  <span>{t('checkout.cancelTerms')}</span>
                </p>
                <p className="ps-6">{t('checkout.refundTerms')}</p>
              </div>
            </aside>

            {/* What Pro opens, read from the published plans and content. */}
            {perks.length > 0 && (
              <section aria-labelledby="subscribe-perks" className="md:col-start-1 md:row-start-2">
                <h2 id="subscribe-perks" className="text-sm font-semibold text-foreground">
                  {t('pro.youGet')}
                </h2>
                <ul className="mt-3 space-y-2.5">
                  {perks.map((perk) => (
                    <li key={perk.key} className="flex items-start gap-3 text-[15px] leading-snug text-foreground">
                      <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
                      <span>{perk.label}</span>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </div>
        )}
      </div>
    </main>
  );
}
