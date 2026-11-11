'use client';

import Link from 'next/link';
import { useTranslations } from 'use-intl';
import { Check, Clock, Crown, Minus, Sparkles } from 'lucide-react';
import { FEATURE_MATRIX, PLAN_FEATURES, PRO_FEATURES, type PlanId } from '@/lib/plans';

// ─── Plans ────────────────────────────────────────────────────────────────────
// Free and Pro side by side, from the same matrix the server enforces
// (src/lib/plans.ts). There are no prices and nothing to buy: Free is
// available now, Pro is "coming soon", and the page says so plainly. Used by
// the public /pricing page and by the studio's /app/plans view.

const proOnly = FEATURE_MATRIX.filter((row) => row.features.some((f) => PRO_FEATURES.includes(f)));
const inFree = FEATURE_MATRIX.filter((row) => row.features.every((f) => PLAN_FEATURES.free.includes(f)));

export function PlanComparison({
  current,
  isAdmin = false,
  freeAction,
  registration,
}: {
  /** The signed-in person's plan in force, or null on the public page. */
  current: PlanId | null;
  isAdmin?: boolean;
  /** Where Free's button leads (public page); none in the studio. */
  freeAction?: { href: string; label: string } | null;
  /** Shown in the questions when known: whether anyone can sign up yet. */
  registration?: 'open' | 'invite' | null;
}) {
  const t = useTranslations('plans');
  const questions = [
    { q: t('faq.freeQ'), a: t('faq.freeA') },
    ...(registration === 'invite'
      ? [{ q: t('faq.accountQ'), a: t('faq.accountInviteA') }]
      : registration === 'open'
        ? [{ q: t('faq.accountQ'), a: t('faq.accountOpenA') }]
        : []),
    { q: t('faq.proQ'), a: t('faq.proA') },
    { q: t('faq.buyQ'), a: t('faq.buyA') },
    { q: t('faq.uploadQ'), a: t('faq.uploadA') },
  ];

  return (
    <div>
      <div className="grid gap-4 md:grid-cols-2">
        {/* Free */}
        <section aria-labelledby="plan-free" className="flex flex-col rounded-2xl border border-primary/50 bg-card p-5 shadow-sm md:p-6">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 id="plan-free" className="text-xl font-semibold text-foreground">{t('free')}</h2>
              <p className="mt-1 text-sm text-muted-foreground">{t('freeLead')}</p>
            </div>
            <span className="shrink-0 rounded-full bg-primary px-2.5 py-1 text-xs font-semibold text-primary-foreground">{t('availableNow')}</span>
          </div>
          <ul className="mt-5 space-y-3" aria-label={t('includedInFree')}>
            {inFree.map((row) => (
              <li key={row.id} className="flex gap-3">
                <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
                <span className="min-w-0">
                  <span className="block text-sm font-medium text-foreground">{t(`rows.${row.id}.label`)}</span>
                  <span className="block text-xs text-muted-foreground">{t(`rows.${row.id}.detail`)}</span>
                </span>
              </li>
            ))}
          </ul>
          <div className="mt-auto pt-6">
            {current === 'free' && !isAdmin ? (
              <p className="flex h-11 items-center justify-center rounded-xl border border-primary/40 bg-primary/10 text-sm font-semibold text-primary">{t('currentPlan')}</p>
            ) : freeAction ? (
              <Link
                href={freeAction.href}
                className="flex h-12 items-center justify-center rounded-xl bg-primary text-[15px] font-semibold text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {freeAction.label}
              </Link>
            ) : null}
          </div>
        </section>

        {/* Pro */}
        <section aria-labelledby="plan-pro" className="flex flex-col rounded-2xl border border-border bg-card p-5 shadow-sm md:p-6">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 id="plan-pro" className="flex items-center gap-1.5 text-xl font-semibold text-foreground">
                <Crown className="h-5 w-5 text-primary" aria-hidden="true" /> {t('pro')}
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">{t('proLead')}</p>
            </div>
            <span className="flex shrink-0 items-center gap-1 rounded-full border border-border bg-secondary/60 px-2.5 py-1 text-xs font-semibold text-foreground">
              <Clock className="h-3 w-3" aria-hidden="true" /> {t('comingSoon')}
            </span>
          </div>
          <p className="mt-5 text-xs font-medium uppercase tracking-wider text-muted-foreground">{t('everythingPlus')}</p>
          <ul className="mt-3 space-y-3" aria-label={t('addedInPro')}>
            {proOnly.map((row) => (
              <li key={row.id} className="flex gap-3">
                <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
                <span className="min-w-0">
                  <span className="block text-sm font-medium text-foreground">{t(`rows.${row.id}.label`)}</span>
                  <span className="block text-xs text-muted-foreground">{t(`rows.${row.id}.detail`)}</span>
                </span>
              </li>
            ))}
          </ul>
          <div className="mt-auto pt-6">
            {current === 'pro' && !isAdmin ? (
              <p className="flex h-11 items-center justify-center rounded-xl border border-primary/40 bg-primary/10 text-sm font-semibold text-primary">{t('currentPlan')}</p>
            ) : (
              <button
                type="button"
                disabled
                className="flex h-12 w-full items-center justify-center gap-2 rounded-xl border border-border bg-secondary/60 text-[15px] font-semibold text-muted-foreground"
              >
                <Clock className="h-4 w-4" aria-hidden="true" /> {t('comingSoon')}
              </button>
            )}
            <p className="mt-2 text-center text-xs text-muted-foreground">{t('cannotBuy')}</p>
          </div>
        </section>
      </div>

      {isAdmin && (
        <p className="mt-4 rounded-xl border border-primary/30 bg-primary/5 px-4 py-3 text-sm text-foreground">
          {t('adminNote')}
        </p>
      )}

      <section aria-labelledby="plans-compare" className="mt-6 overflow-hidden rounded-2xl border border-border bg-card">
        <h2 id="plans-compare" className="px-4 pb-2 pt-4 text-base font-semibold text-foreground md:px-5">{t('compare')}</h2>
        <table className="w-full text-start text-sm">
          <thead className="text-xs uppercase tracking-wide text-muted-foreground">
            <tr className="border-b border-border">
              <th scope="col" className="px-4 py-2 text-start font-medium md:px-5">{t('feature')}</th>
              <th scope="col" className="w-16 px-2 py-2 text-center font-medium md:w-24">{t('free')}</th>
              <th scope="col" className="w-16 px-2 py-2 text-center font-medium md:w-24">{t('pro')}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {FEATURE_MATRIX.map((row) => (
              <tr key={row.id}>
                <th scope="row" className="px-4 py-3 text-start font-normal md:px-5">
                  <span className="block font-medium text-foreground">{t(`rows.${row.id}.label`)}</span>
                  <span className="block text-xs text-muted-foreground">{t(`rows.${row.id}.detail`)}</span>
                </th>
                {(['free', 'pro'] as const).map((plan) => (
                  <td key={plan} className="px-2 py-3 text-center">
                    {row.features.every((f) => PLAN_FEATURES[plan].includes(f)) ? (
                      <Check className="mx-auto h-4 w-4 text-primary" aria-label={t('included')} />
                    ) : (
                      <Minus className="mx-auto h-4 w-4 text-muted-foreground" aria-label={t('notIncluded')} />
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section aria-labelledby="plans-questions" className="mt-6">
        <h2 id="plans-questions" className="text-base font-semibold text-foreground">{t('questions')}</h2>
        <dl className="mt-3 space-y-4">
          {questions.map(({ q, a }) => (
            <div key={q}>
              <dt className="text-sm font-medium text-foreground">{q}</dt>
              <dd className="mt-1 text-sm leading-relaxed text-muted-foreground">{a}</dd>
            </div>
          ))}
        </dl>
      </section>
    </div>
  );
}
