import type { Metadata } from 'next';
import Link from 'next/link';
import { LanguageSwitch } from '@/components/common/LanguageSwitch';
import { PlanComparison } from '@/components/plans/PlanComparison';
import { BrandMark } from '@/components/shell/BrandMark';
import { localizedPath } from '@/i18n/config';
import { getRequestLocale, getT } from '@/i18n/server';
import { registrationMode } from '@/server/auth';

// Public plan comparison, linked from the landing page. No prices and nothing
// to buy: Free is available, Pro is coming soon.

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT('meta');
  return { title: t('pricingTitle'), description: t('pricingDescription'), alternates: { languages: { en: '/pricing', he: '/he/pricing' } } };
}

// The call to action follows the server's registration setting.
export const dynamic = 'force-dynamic';

export default async function PricingPage() {
  const registration = registrationMode();
  const locale = await getRequestLocale();
  const t = await getT('plans');
  const tc = await getT('common');
  const tl = await getT('landing');
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
        <p className="mt-2 max-w-xl text-sm leading-relaxed text-muted-foreground md:text-base">{t('lead')}</p>

        <div className="mt-6">
          <PlanComparison
            current={null}
            freeAction={
              registration === 'open'
                ? { href: `${localizedPath('/sign-in', locale)}?callbackURL=%2Fapp`, label: tl('startFree') }
                : { href: '/app', label: tc('openStudio') }
            }
            registration={registration}
          />
        </div>
      </div>
    </main>
  );
}
