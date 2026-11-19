import Link from 'next/link';
import { useTranslations } from 'use-intl';
import { ChevronRight, Lock, PencilLine, Sparkles } from 'lucide-react';
import { LEARN_MODULE, type LearnCollection } from '@/lib/learn/model';
import { learnPath } from '@/lib/learn/routes';
import { useAccount, useLearnSummary } from '@/components/shell/account';

// Learn on Home (ADR-0018, A4): "Learn to draw" and "Pick a challenge", for
// accounts Learn is shown to (an admin, or a module some published plan
// offers). Phones reach Learn from here; wider screens also from the top bar.
// Kept small: the Learn screens themselves load only when opened.

export default function LearnOnHome() {
  const t = useTranslations('learn.homeSection');
  const tl = useTranslations('learn');
  const summary = useLearnSummary();
  const account = useAccount()?.account;
  if (!summary.visible) return null;
  const lockOf = (collection: LearnCollection) =>
    summary.modules[collection] !== 'locked' ? null : account?.offer.pro.includes(LEARN_MODULE[collection]) && account.plan.effective !== 'pro' ? 'pro' : 'plan';
  const cards = [
    summary.modules.curriculum !== null || summary.modules.color !== null
      ? { key: 'course', href: learnPath({ screen: 'curriculum' }), title: t('course'), lead: t('courseLead'), Icon: PencilLine, lock: lockOf('curriculum') }
      : null,
    summary.modules.challenges !== null
      ? { key: 'challenges', href: learnPath({ screen: 'challenges' }), title: t('challenges'), lead: t('challengesLead'), Icon: Sparkles, lock: lockOf('challenges') }
      : null,
  ].filter((card) => card !== null);

  return (
    <section aria-labelledby="home-learn-title" className="mt-7 px-4 md:px-6 lg:px-8" data-home-learn>
      <div className="mb-2.5 flex items-baseline justify-between gap-3">
        <h2 id="home-learn-title" className="text-sm font-semibold text-muted-foreground">
          {t('title')}
        </h2>
        <Link href={learnPath({ screen: 'home' })} className="inline-flex min-h-[44px] items-center text-sm font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          {t('all')}
        </Link>
      </div>
      <ul className="grid grid-cols-1 gap-3 md:grid-cols-2 md:gap-4">
        {cards.map(({ key, href, title, lead, Icon, lock }) => (
          <li key={key}>
            <Link
              href={href}
              className="group flex h-full items-center gap-3 rounded-2xl border border-border bg-card p-3 pe-3.5 shadow-sm transition-colors hover:border-primary/50 active:bg-secondary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:gap-4 md:p-4"
            >
              <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-primary/15 text-primary md:h-16 md:w-16">
                <Icon className="h-7 w-7" aria-hidden="true" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-center gap-2">
                  <span className="text-[15px] font-semibold leading-tight text-foreground md:text-lg">{title}</span>
                  {lock && (
                    <span data-locked-badge className="inline-flex shrink-0 items-center gap-1 rounded-full bg-secondary px-2 py-0.5 text-[11px] font-semibold text-foreground/80">
                      <Lock className="h-3 w-3" aria-hidden="true" /> {lock === 'pro' ? tl('partOfPro') : tl('locked')}
                    </span>
                  )}
                </span>
                <span className="mt-1 block text-[13px] leading-snug text-muted-foreground md:text-[15px]">{lead}</span>
              </span>
              <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-primary rtl:-scale-x-100 rtl:group-hover:-translate-x-0.5" aria-hidden="true" />
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
