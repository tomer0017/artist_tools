import { useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'use-intl';
import { ChevronRight, Lock, PencilLine, Sparkles } from 'lucide-react';
import { classModeOn } from '@/lib/learn/class-mode';
import { LEARN_MODULE, type LearnCollection } from '@/lib/learn/model';
import { learnPath } from '@/lib/learn/routes';
import { useAccount, useLearnSummary } from '@/components/shell/account';
import { useCourseStart } from './useCourseStart';
import { buttonPrimary } from './parts';

// Learn on Home (ADR-0018, A4; ADR-0019): the same two doors as the Learn
// home, for accounts Learn is shown to (an admin, or a module some published
// plan offers). The course's door leads straight to the next lesson ("Start:
// Lesson 1 · …", "Continue: Lesson 3 · …"); the challenges' door to the
// challenges. Phones reach Learn from here; wider screens also from the top
// bar. In class mode (this tab) nothing about the person's history is asked
// for, as everywhere in Learn.

const tabClassMode = () => {
  try {
    return classModeOn(window.sessionStorage);
  } catch {
    return false;
  }
};

export default function LearnOnHome() {
  const t = useTranslations('learn.homeSection');
  const tl = useTranslations('learn');
  const summary = useLearnSummary();
  const account = useAccount()?.account;
  const [classMode] = useState(tabClassMode);
  const showCourse = summary.modules.curriculum !== null || summary.modules.color !== null;
  const course = useCourseStart(summary.visible && summary.modules.curriculum !== null && !classMode);
  if (!summary.visible) return null;
  const lockOf = (collection: LearnCollection) =>
    summary.modules[collection] !== 'locked' ? null : account?.offer.pro.includes(LEARN_MODULE[collection]) && account.plan.effective !== 'pro' ? 'pro' : 'plan';
  const doors = [
    showCourse
      ? {
          key: 'course',
          title: t('course'),
          lead: t('courseLead'),
          Icon: PencilLine,
          lock: lockOf('curriculum'),
          action: summary.modules.curriculum !== null && !course.loading ? { href: course.href, label: course.label } : { href: learnPath({ screen: 'curriculum' }), label: t('openCourse') },
          more: { href: learnPath({ screen: 'curriculum' }), label: tl('home.allLessons') },
        }
      : null,
    summary.modules.challenges !== null
      ? {
          key: 'challenges',
          title: t('challenges'),
          lead: t('challengesLead'),
          Icon: Sparkles,
          lock: lockOf('challenges'),
          action: { href: learnPath({ screen: 'challenges' }), label: t('pick') },
          more: null,
        }
      : null,
  ].filter((door) => door !== null);

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
        {doors.map(({ key, title, lead, Icon, lock, action, more }) => (
          <li key={key} className="flex h-full min-w-0 flex-col rounded-2xl border border-border bg-card p-3 shadow-sm md:p-4" data-home-door={key}>
            <div className="flex items-center gap-3 md:gap-4">
              <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-primary/15 text-primary md:h-14 md:w-14">
                <Icon className="h-6 w-6" aria-hidden="true" />
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
            </div>
            <div className="mt-3 flex flex-col gap-1.5 sm:flex-row sm:items-center">
              <Link href={action.href} className={`${buttonPrimary} min-h-[44px] py-2 text-center sm:flex-1`} data-home-action={key}>
                <span className="min-w-0">{action.label}</span>
              </Link>
              {more && (
                <Link
                  href={more.href}
                  className="inline-flex min-h-[44px] items-center justify-center gap-1 rounded-lg px-2 text-sm font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {more.label}
                  <ChevronRight className="h-4 w-4 rtl:-scale-x-100" aria-hidden="true" />
                </Link>
              )}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
