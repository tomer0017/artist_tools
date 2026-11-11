import Link from 'next/link';
import { ChevronRight, Lock } from 'lucide-react';
import { LanguageSwitch } from '@/components/common/LanguageSwitch';
import { BrandMark } from '@/components/shell/BrandMark';
import LegacyHashRedirect from '@/components/shell/LegacyHashRedirect';
import { HOME_ORDER, TOOLS, TOOL_ART, pathForView } from '@/components/shell/tools';
import { getRequestLocale, getT } from '@/i18n/server';
import { localizedPath } from '@/i18n/config';
import { registrationMode } from '@/server/auth';

// Public landing page: what Studio Companion is, the five tools, and how to
// start (a free account with Google, or invite-only while testing). It reuses
// the studio's hero and tool artwork so the brand looks the same before and
// after entry.

const HERO_FADE = 'linear-gradient(to right, transparent 0%, rgba(0,0,0,0.55) 30%, #000 62%, #000 88%, transparent 100%)';

// The call to action follows the server's registration setting.
export const dynamic = 'force-dynamic';

export async function generateMetadata() {
  return { alternates: { languages: { en: '/', he: '/he' } } };
}

export default async function LandingPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const open = registrationMode() === 'open';
  const deleted = (await searchParams).account === 'deleted';
  const locale = await getRequestLocale();
  const t = await getT('landing');
  const tc = await getT('common');
  const tt = await getT('tools');
  return (
    <main className="min-h-[100dvh] bg-background" style={{ paddingTop: 'env(safe-area-inset-top)', paddingBottom: 'env(safe-area-inset-bottom)' }}>
      <LegacyHashRedirect />
      {deleted && (
        <p role="status" className="mx-auto mt-4 w-[calc(100%-2rem)] max-w-6xl rounded-xl border border-primary/40 bg-primary/10 px-4 py-3 text-sm text-foreground">
          {t('deleted')}
        </p>
      )}
      <header className="relative z-10 mx-auto flex w-full max-w-6xl items-center justify-between gap-4 px-4 pt-5 md:px-6 lg:px-8">
        <BrandMark />
        <nav aria-label={tc('site')} className="flex items-center gap-1 text-sm">
          <LanguageSwitch className="me-1 hidden sm:inline-flex" />
          <Link href={localizedPath('/pricing', locale)} className="rounded-lg px-3 py-2 font-medium text-foreground hover:bg-secondary">{tc('plans')}</Link>
          <Link href={`${localizedPath('/sign-in', locale)}?callbackURL=%2Fapp`} className="rounded-lg px-3 py-2 font-medium text-foreground hover:bg-secondary">{tc('signIn')}</Link>
        </nav>
      </header>

      <section className="relative mx-auto w-full max-w-6xl overflow-hidden px-4 pb-10 pt-8 md:px-6 md:pb-16 md:pt-12 lg:px-8">
        <div
          className="pointer-events-none absolute inset-y-0 end-0 w-[64%] md:w-[55%] rtl:-scale-x-100"
          style={{ maskImage: HERO_FADE, WebkitMaskImage: HERO_FADE }}
        >
          <img
            src="/images/home/home-hero.webp"
            alt=""
            width={1199}
            height={1312}
            fetchPriority="high"
            decoding="async"
            className="h-full w-full object-cover"
            style={{ objectPosition: '60% 35%' }}
          />
          <div className="absolute inset-0 bg-gradient-to-r from-background/80 via-background/25 to-transparent" />
          <div className="absolute inset-x-0 bottom-0 h-1/3 bg-gradient-to-t from-background to-transparent" />
        </div>

        <div className="relative">
          <h1 className="text-[28px] font-bold leading-[1.1] tracking-tight text-foreground md:text-[40px] lg:text-[46px]">
            {t('heroLine1')}
            <span className="relative block w-fit text-primary">
              {t('heroLine2')}
              <svg viewBox="0 0 200 12" preserveAspectRatio="none" aria-hidden="true"
                className="absolute -bottom-1.5 start-0 h-2.5 w-[105%] text-primary md:-bottom-2 md:h-3 rtl:-scale-x-100">
                <path d="M2 9C50 3 120 1 198 6" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
              </svg>
            </span>
          </h1>
          <p className="mt-4 max-w-[17rem] text-sm leading-relaxed text-foreground/80 md:mt-5 md:max-w-sm md:text-base">
            {t('heroLead')}
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-3">
            <Link
              href={open ? `${localizedPath('/sign-in', locale)}?callbackURL=%2Fapp` : '/app'}
              className="inline-flex h-12 items-center justify-center rounded-xl bg-primary px-6 text-[15px] font-semibold text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {open ? t('startFree') : tc('openStudio')}
            </Link>
            <Link href={localizedPath('/pricing', locale)} className="inline-flex h-12 items-center justify-center rounded-xl border border-border bg-card/70 px-5 text-[15px] font-semibold text-foreground hover:bg-secondary">
              {t('seePlans')}
            </Link>
          </div>
          <p className="mt-3 flex items-center gap-1.5 text-xs text-muted-foreground">
            {open ? (
              t('noteOpen')
            ) : (
              <>
                <Lock className="h-3 w-3" aria-hidden="true" /> {t('noteInvite')}
              </>
            )}
          </p>
        </div>
      </section>

      <section aria-labelledby="landing-tools" className="mx-auto w-full max-w-6xl px-4 pb-8 md:px-6 lg:px-8">
        <h2 id="landing-tools" className="text-lg font-semibold text-foreground md:text-xl">{t('toolsHeading')}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{t('toolsLead')}</p>
        <ul className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {HOME_ORDER.map((id) => {
            const tool = TOOLS[id];
            const art = TOOL_ART[id];
            const Icon = tool.icon;
            return (
              <li key={id}>
                <Link
                  href={pathForView(id)}
                  className="group flex h-full flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-sm transition-colors hover:border-primary/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <div className="relative aspect-[21/9] w-full overflow-hidden bg-secondary">
                    <img
                      src={art.src}
                      alt={tt(`${id}.alt`)}
                      width={art.width}
                      height={art.height}
                      loading="lazy"
                      decoding="async"
                      className="absolute inset-0 h-full w-full object-cover"
                      style={{ objectPosition: art.position }}
                    />
                  </div>
                  <div className="flex flex-1 items-start gap-2 p-4">
                    <div className="min-w-0 flex-1">
                      <h3 className="flex items-center gap-2 text-[15px] font-semibold text-foreground">
                        <Icon className="h-[18px] w-[18px] shrink-0 text-primary" aria-hidden="true" /> {tt(`${id}.title`)}
                      </h3>
                      <p className="mt-1 text-[13px] leading-snug text-muted-foreground">{tt(`${id}.description`)}</p>
                    </div>
                    <ChevronRight className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-primary rtl:rotate-180 rtl:group-hover:-translate-x-0.5" aria-hidden="true" />
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      </section>

      <section aria-labelledby="landing-plans" className="mx-auto w-full max-w-6xl px-4 pb-12 md:px-6 lg:px-8">
        <div className="flex flex-col gap-4 rounded-2xl border border-primary/30 bg-primary/5 p-5 md:flex-row md:items-center md:justify-between md:p-6">
          <div>
            <h2 id="landing-plans" className="text-base font-semibold text-foreground md:text-lg">{t('plansHeading')}</h2>
            <p className="mt-1 text-sm text-muted-foreground">{t('plansLead')}</p>
          </div>
          <Link href={localizedPath('/pricing', locale)} className="inline-flex h-11 shrink-0 items-center justify-center rounded-xl border border-border bg-card px-5 text-sm font-semibold text-foreground hover:bg-secondary">
            {tc('comparePlans')}
          </Link>
        </div>
        <p className="mt-6 text-center text-xs text-muted-foreground">{t('privacy')}</p>
        <div className="mt-4 flex justify-center sm:hidden">
          <LanguageSwitch />
        </div>
      </section>
    </main>
  );
}
