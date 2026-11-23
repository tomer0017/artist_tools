'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';
import { Check, Crown, FileText, Film, GraduationCap, Image as ImageIcon, Layers, Maximize2, NotebookPen, Palette, Sparkles, Trophy, type LucideIcon } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'use-intl';
import { useAccount } from '@/components/shell/account';
import { TOOLS } from '@/components/shell/tools';
import type { AccountSummary } from '@/lib/account';
import { formatMoney } from '@/lib/money';
import { featureRows } from '@/lib/plans';
import { proPerks, type ProPerk } from '@/lib/pro-perks';

// ─── Pro, wherever Free stops (docs/billing/03-paypal.md) ─────────────────────
// The upgrade surfaces share one look, a painting's gilt frame and a museum-
// label serif (`.gilt-frame`, `font-display`), and one source of truth: what
// Pro adds is read from the account's plan offer (tools, exports) and from the
// server (how many more lessons and challenges Pro opens for this account),
// never written by hand, so it stays true when the owner changes the plans.
// They appear only while this account may subscribe (PayPal set up, a price
// published, subscriptions open to it); otherwise nothing is shown.

const SUBSCRIBE = '/subscribe';

/** Whether to offer Pro to this account now. */
export function proOfferFor(account: AccountSummary | null | undefined): boolean {
  return Boolean(account?.billing?.available && account.role !== 'admin' && account.plan.effective !== 'pro' && !account.billing.subscription?.renewing);
}

interface Upsell {
  extra: { curriculum: number; color: number; challenges: number };
}

/** One thing Pro adds, named and drawn. */
export interface Perk {
  key: string;
  label: string;
  icon: LucideIcon;
}

const ROW_ICONS: Partial<Record<string, LucideIcon>> = {
  images: ImageIcon,
  gifs: Film,
  large: Maximize2,
  difference: Layers,
  pdf: FileText,
  worksheets: NotebookPen,
  learnCurriculum: GraduationCap,
  learnColor: Palette,
  learnChallenges: Trophy,
};

/** The account's monthly price, formatted, and what Pro adds for it, as plain sentences. */
export function useProOffer() {
  const account = useAccount()?.account ?? null;
  const tg = useTranslations();
  const t = useTranslations('billing.pro');
  const locale = useLocale();
  const enabled = proOfferFor(account);
  const upsell = useQuery({
    queryKey: ['billing', 'upsell', account?.id, account?.learn.key],
    enabled,
    staleTime: 5 * 60 * 1000,
    queryFn: async (): Promise<Upsell | null> => {
      const response = await fetch('/api/billing/upsell', { credentials: 'same-origin', cache: 'no-store' });
      return response.ok ? ((await response.json()) as Upsell) : null;
    },
  });
  if (!account || !enabled) return { enabled: false as const };
  const mine = new Set(account.features);
  const pro = account.offer.pro;
  const rows = featureRows([pro, account.features]).filter((row) => row.features.every((f) => pro.includes(f)) && !row.features.every((f) => mine.has(f)));
  const perk = (p: ProPerk): Perk =>
    p.kind === 'count'
      ? { key: p.key, label: t(p.collection === 'curriculum' ? 'lessons' : 'challenges', { count: p.count }), icon: p.collection === 'curriculum' ? GraduationCap : Trophy }
      : p.row.kind === 'tool'
        ? { key: p.key, label: tg(`tools.${p.row.id}.title`), icon: TOOLS[p.row.id].icon }
        : { key: p.key, label: tg(`plans.rows.${p.row.id}.label`), icon: ROW_ICONS[p.row.id] ?? Sparkles };
  const perks = proPerks(rows, upsell.data?.extra).map(perk);
  const offer = account.billing?.offer ?? null;
  return {
    enabled: true as const,
    perks,
    price: offer ? formatMoney(offer.amountMinor, offer.currency, locale) : null,
  };
}

/** A gilt "Pro" mark on something Pro opens (a tool on Home, a lesson or a challenge in a list). */
export function ProMark() {
  return (
    <span data-locked-badge data-pro-mark className="gilt-seal inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-bold leading-4">
      <Crown className="h-3 w-3" aria-hidden="true" /> Pro
    </span>
  );
}

/** The top bar's way to Pro: a small gilt-framed pill (the label hides on narrow screens). */
export function UpgradeButton({ compact = false }: { compact?: boolean }) {
  const t = useTranslations('billing.pro');
  const account = useAccount()?.account;
  if (!proOfferFor(account)) return null;
  return (
    <Link
      href={SUBSCRIBE}
      data-upgrade-button
      aria-label={t('upgrade')}
      className="gilt-frame inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full px-3 text-[13px] font-semibold text-ivory transition-[filter] hover:brightness-125 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <Crown className="h-3.5 w-3.5 text-primary" aria-hidden="true" />
      <span>{compact ? t('navLabel') : t('upgrade')}</span>
    </Link>
  );
}

function Price({ price, size = 'lg' }: { price: string; size?: 'lg' | 'md' }) {
  const t = useTranslations('billing.pro');
  return (
    <p className="flex items-baseline gap-2 text-ivory">
      <span className={`font-display font-bold leading-none tabular-nums ${size === 'lg' ? 'text-[40px]' : 'text-[30px]'}`}>{price}</span>
      <span className="text-sm text-foreground/70">{t('perMonthUnit')}</span>
    </p>
  );
}

function Perks({ perks }: { perks: Perk[] }) {
  return (
    <ul className="space-y-2.5">
      {perks.map((perk) => (
        <li key={perk.key} className="flex items-start gap-2.5 text-sm leading-snug text-foreground">
          <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
          <span>{perk.label}</span>
        </li>
      ))}
    </ul>
  );
}

const ctaClass =
  'flex h-12 w-full items-center justify-center gap-2 rounded-lg bg-primary text-[15px] font-semibold text-primary-foreground shadow-[0_10px_30px_-12px_hsl(var(--primary)/0.7)] transition-[filter] hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background';

/** A soft gallery light behind a framed offer. */
const spotlight = 'bg-[radial-gradient(55%_45%_at_50%_40%,hsl(var(--primary)/0.10),transparent_75%)]';

/**
 * In place of something Pro opens (a tool, a lesson, a challenge): what it is,
 * what else upgrading opens, the price, and the way to subscribe. Returns
 * null when Pro is not on offer to this account (the caller then shows its
 * plain locked screen).
 */
export function ProPaywall({ title, icon, back }: { title: string; icon: ReactNode; back: { href: string; label: string } }) {
  const t = useTranslations('billing.pro');
  const offer = useProOffer();
  if (!offer.enabled) return null;
  return (
    <section aria-labelledby="pro-paywall-title" data-pro-paywall className={`flex min-h-0 flex-1 items-start justify-center overflow-y-auto overscroll-contain px-4 py-8 md:items-center ${spotlight}`}>
      <div className="gilt-frame w-full max-w-md rounded-[14px] p-6 shadow-[0_30px_80px_-40px_rgba(0,0,0,0.9)] md:p-8">
        <div className="relative flex h-14 w-14 items-center justify-center rounded-xl bg-background/70 text-muted-foreground ring-1 ring-white/5">
          {icon}
          <span className="gilt-seal absolute -bottom-1.5 -end-1.5 flex h-6 w-6 items-center justify-center rounded-full ring-2 ring-[hsl(var(--mat))]">
            <Crown className="h-3.5 w-3.5" aria-hidden="true" />
          </span>
        </div>
        <h1 id="pro-paywall-title" className="mt-5 text-balance font-display text-[26px] font-bold leading-tight text-ivory md:text-[28px]">
          {title}
        </h1>
        {offer.perks.length > 0 && (
          <>
            <p className="mt-2 text-sm leading-relaxed text-foreground/75">{t('lead')}</p>
            <div className="mt-4">
              <Perks perks={offer.perks} />
            </div>
          </>
        )}
        <div className="mt-6 border-t border-white/10 pt-5">
          {offer.price && <Price price={offer.price} />}
          <Link href={SUBSCRIBE} className={`mt-4 ${ctaClass}`}>
            <Crown className="h-4 w-4" aria-hidden="true" /> {t('upgrade')}
          </Link>
          <p className="mt-3 text-center text-xs leading-relaxed text-muted-foreground">{t('assurance')}</p>
          <div className="mt-4 flex items-center justify-between gap-3 border-t border-white/10 pt-3 text-sm">
            <Link href={back.href} className="rounded-md px-1 py-1 text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              {back.label}
            </Link>
            <Link href="/app/plans" className="rounded-md px-1 py-1 font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              {t('comparePlans')}
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}

/** How many perks the banner names before "+N more". */
const BANNER_PERKS = 3;

/** A framed strip that says, up front, what Pro adds and what it costs (Home and the account page). */
export function ProBanner({ className = '' }: { className?: string }) {
  const t = useTranslations('billing.pro');
  const offer = useProOffer();
  if (!offer.enabled) return null;
  const shown = offer.perks.slice(0, BANNER_PERKS);
  const more = offer.perks.length - shown.length;
  return (
    <section aria-labelledby="pro-banner-title" data-pro-banner className={className}>
      <div className="gilt-frame flex flex-col gap-4 rounded-[14px] p-4 shadow-[0_24px_60px_-36px_rgba(0,0,0,0.9)] md:flex-row md:items-center md:gap-8 md:p-5">
        <div className="flex min-w-0 flex-1 items-start gap-3.5">
          <span className="gilt-seal mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-full">
            <Crown className="h-5 w-5" aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <h2 id="pro-banner-title" className="font-display text-xl font-bold leading-snug text-ivory md:text-[22px]">
              {t('bannerTitle')}
            </h2>
            {shown.length > 0 && (
              <ul className="mt-2.5 flex flex-wrap gap-1.5" aria-label={t('youGet')}>
                {shown.map(({ key, label, icon: Icon }) => (
                  <li key={key} className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-[12.5px] font-medium leading-none text-foreground/90">
                    <Icon className="h-3.5 w-3.5 shrink-0 text-primary" aria-hidden="true" />
                    {label}
                  </li>
                ))}
                {more > 0 && (
                  <li>
                    <Link
                      href="/app/plans"
                      className="inline-flex items-center rounded-full border border-primary/30 px-2.5 py-1 text-[12.5px] font-semibold leading-none text-primary hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      {t('more', { count: more })}
                    </Link>
                  </li>
                )}
              </ul>
            )}
          </div>
        </div>
        <div className="flex items-center justify-between gap-4 border-t border-white/10 pt-4 md:justify-end md:border-0 md:pt-0">
          {offer.price && <Price price={offer.price} size="md" />}
          <Link
            href={SUBSCRIBE}
            className="flex h-11 shrink-0 items-center gap-2 rounded-lg bg-primary px-5 text-sm font-semibold text-primary-foreground shadow-[0_10px_30px_-12px_hsl(var(--primary)/0.7)] transition-[filter] hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          >
            <Crown className="h-4 w-4" aria-hidden="true" /> {t('upgrade')}
          </Link>
        </div>
      </div>
    </section>
  );
}
