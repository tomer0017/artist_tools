import type { Metadata } from 'next';
import Link from 'next/link';
import { LanguageSwitch } from '@/components/common/LanguageSwitch';
import { PlanComparison } from '@/components/plans/PlanComparison';
import { BrandMark } from '@/components/shell/BrandMark';
import { localizedPath } from '@/i18n/config';
import { getRequestLocale, getT } from '@/i18n/server';
import { formatMoney } from '@/lib/money';
import { hasAllTools, isDefaultSplit } from '@/lib/plans';
import { registrationMode } from '@/server/auth';
import { basePrice } from '@/server/billing/paypal/subscriptions';
import { paypalConfig } from '@/server/env';
import { getDb } from '@/server/db/client';
import { describablePlanOffer } from '@/server/entitlements';

// Public plan comparison, linked from the landing page. Until subscriptions
// open (PayPal set up and a price published) there is nothing to buy and Pro
// reads "coming soon"; afterwards Pro shows its monthly price and leads to checkout.

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT('meta');
  const offer = await describablePlanOffer(getDb);
  return {
    title: t('pricingTitle'),
    description: offer && hasAllTools(offer.free) ? t('pricingDescription') : t('pricingDescriptionPartial'),
    alternates: { languages: { en: '/pricing', he: '/he/pricing' } },
  };
}

// The call to action follows the server's registration setting.
export const dynamic = 'force-dynamic';

export default async function PricingPage() {
  const registration = registrationMode();
  // What each plan includes as published: the comparison says what the studio opens.
  const offer = await describablePlanOffer(getDb);
  const locale = await getRequestLocale();
  const t = await getT('plans');
  const tc = await getT('common');
  const tl = await getT('landing');
  const tb = await getT('billing');
  // Once subscriptions are open: Pro's monthly price (in USD; signed-in accounts see their own currency at checkout).
  const base = await (async () => {
    try {
      return paypalConfig() ? await basePrice(getDb()) : null;
    } catch {
      return null;
    }
  })();
  return (
    <main className="min-h-[100dvh] bg-background" style={{ paddingTop: 'env(safe-area-inset-top)', paddingBottom: 'env(safe-area-inset-bottom)' }}>
      <div className="mx-auto w-full max-w-4xl px-4 pb-12 pt-5 md:px-6 md:pt-8">
        <header className="flex items-center justify-between gap-4">
          <Link href={localizedPath('/', locale)} aria-label={tc('home')} className="rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <BrandMark />
          </Link>
          <div className="flex items-center gap-2">
            <LanguageSwitch />
            <Link href="/app" className="rounded-lg px-3 py-2 text-sm font-medium text-foreground hover:bg-secondary">
              {tc('openStudio')}
            </Link>
          </div>
        </header>

        <h1 className="mt-10 text-[30px] font-bold leading-tight tracking-tight text-foreground md:text-[40px]">{t('title')}</h1>
        <p className="mt-2 max-w-xl text-sm leading-relaxed text-muted-foreground md:text-base">{offer && isDefaultSplit(offer) ? t('lead') : t('leadPartial')}</p>

        <div className="mt-6">
          {offer ? (
            <PlanComparison
              offer={offer}
              current={null}
              freeAction={
                registration === 'open'
                  ? { href: `${localizedPath('/sign-in', locale)}?callbackURL=%2Fapp`, label: tl('startFree') }
                  : { href: '/app', label: tc('openStudio') }
              }
              registration={registration}
              proAction={base ? { href: '/subscribe', label: tb('subscribe'), price: tb('perMonth', { price: formatMoney(base.amountMinor, 'USD', locale) }), note: tb('planNote') } : null}
            />
          ) : (
            // The database could not be read: no comparison rather than a wrong one.
            <p role="status" className="rounded-xl border border-border bg-card px-4 py-3 text-sm text-muted-foreground">{t('unavailable')}</p>
          )}
        </div>
      </div>
    </main>
  );
}
