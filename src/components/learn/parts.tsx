import Link from 'next/link';
import { useCallback } from 'react';
import { useLocale, useTranslations } from 'use-intl';
import { Check, ChevronLeft, ImageOff, Loader2, Lock, PencilLine, RotateCw, Sparkles } from 'lucide-react';
import type { Localized } from '@/lib/learn/model';
import { LearnRequestError, assetUrl } from './data';
import { ClassModeBanner } from './ClassMode';

// Small pieces every Learn screen shares (ADR-0018).

/** Learn's content in the page language (published content always has both). */
export function useLocalized(): (text: Localized | undefined | null) => string {
  const locale = useLocale();
  return useCallback((text) => (text ? (locale === 'he' ? text.he : text.en) : ''), [locale]);
}

/** A screen's top: where it sits in Learn (a link back), its title and lead, and class mode when it is on. */
export function LearnHeader({
  back,
  title,
  lead,
  eyebrow,
  children,
}: {
  back?: { href: string; label: string };
  title: string;
  lead?: string;
  eyebrow?: React.ReactNode;
  children?: React.ReactNode;
}) {
  const t = useTranslations('learn');
  return (
    <header className="mb-5 md:mb-7">
      {back && (
        <nav aria-label={t('breadcrumb')} className="mb-2">
          <Link
            href={back.href}
            className="-ms-1.5 inline-flex min-h-[44px] items-center gap-1 rounded-lg px-1.5 text-sm font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <ChevronLeft className="h-4 w-4 shrink-0 rtl:-scale-x-100" aria-hidden="true" />
            {back.label}
          </Link>
        </nav>
      )}
      <ClassModeBanner />
      {eyebrow}
      <h1 className="text-2xl font-bold leading-tight tracking-tight text-foreground md:text-3xl" data-sketchy-avoid="">
        {title}
      </h1>
      {lead && (
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground md:text-base" data-sketchy-avoid="">
          {lead}
        </p>
      )}
      {children}
    </header>
  );
}

/** A small picture of an item (a thumbnail the server allowed), or a calm placeholder. */
export function Thumb({ assetId, kind, className = '' }: { assetId: string | null; kind: 'exercise' | 'challenge'; className?: string }) {
  const Icon = kind === 'exercise' ? PencilLine : Sparkles;
  return (
    <span className={`relative flex shrink-0 items-center justify-center overflow-hidden rounded-xl bg-secondary ${className}`}>
      {assetId ? (
        // eslint-disable-next-line @next/next/no-img-element -- a private image from the authorized Learn route
        <img src={assetUrl(assetId)} alt="" loading="lazy" decoding="async" className="absolute inset-0 h-full w-full object-cover" />
      ) : (
        <Icon className="h-6 w-6 text-muted-foreground/70" aria-hidden="true" />
      )}
    </span>
  );
}

export function LockBadge({ pro }: { pro?: boolean }) {
  const t = useTranslations('learn');
  return (
    <span data-locked-badge className="inline-flex shrink-0 items-center gap-1 rounded-full bg-secondary px-2 py-0.5 text-[11px] font-semibold text-foreground/80">
      <Lock className="h-3 w-3" aria-hidden="true" /> {pro ? t('partOfPro') : t('locked')}
    </span>
  );
}

export function DraftBadge() {
  const t = useTranslations('learn');
  return <span className="inline-flex shrink-0 items-center rounded-full border border-dashed border-primary/60 px-2 py-0.5 text-[11px] font-semibold text-primary">{t('draft')}</span>;
}

/** "Completed 3 times", with a tick. */
export function DoneTick({ count }: { count: number }) {
  const t = useTranslations('learn');
  if (count <= 0) return null;
  return (
    <span data-done-count={count} className="inline-flex shrink-0 items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[11px] font-semibold text-emerald-300">
      <Check className="h-3 w-3" aria-hidden="true" /> {t('doneCount', { count })}
    </span>
  );
}

export function Loading() {
  const t = useTranslations('learn');
  return (
    <div role="status" className="flex items-center gap-2 py-10 text-sm text-muted-foreground">
      <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> {t('loading')}
    </div>
  );
}

/** Something could not be loaded: say why, offer to try again. */
export function Failed({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  const t = useTranslations('learn');
  const tooMany = error instanceof LearnRequestError && error.status === 429;
  return (
    <div role="alert" className="flex flex-col items-start gap-3 rounded-2xl border border-border bg-card p-4 text-sm text-foreground">
      <p className="flex items-center gap-2">
        <ImageOff className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        {tooMany ? t('tooMany') : t('failed')}
      </p>
      <button
        type="button"
        onClick={onRetry}
        className="inline-flex min-h-[44px] items-center gap-2 rounded-xl bg-secondary px-4 font-semibold text-foreground hover:bg-secondary/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <RotateCw className="h-4 w-4" aria-hidden="true" /> {t('tryAgain')}
      </button>
    </div>
  );
}

export const buttonPrimary =
  'inline-flex min-h-[48px] items-center justify-center gap-2 rounded-xl bg-primary px-5 text-[15px] font-semibold text-primary-foreground transition-colors hover:bg-primary/90 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:opacity-60';
export const buttonSecondary =
  'inline-flex min-h-[48px] items-center justify-center gap-2 rounded-xl border border-border bg-card px-5 text-[15px] font-semibold text-foreground transition-colors hover:bg-secondary active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60';
export const chip =
  'inline-flex min-h-[44px] items-center gap-2 rounded-full border border-border bg-secondary/40 px-4 text-sm font-medium text-foreground transition-colors hover:border-primary/50 hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60';
