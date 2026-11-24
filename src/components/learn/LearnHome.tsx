import { Suspense, lazy, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'use-intl';
import { Dices, History, PencilLine, Sparkles, Timer } from 'lucide-react';
import type { LearnCollection } from '@/lib/learn/model';
import { DEFAULT_FILTERS, pickChallenge } from '@/lib/learn/pick';
import { itemPath, learnPath } from '@/lib/learn/routes';
import { useAccount, useLearnSummary } from '@/components/shell/account';
import { useCompletions, useLearnList, type CompletionsAnswer } from './data';
import { ClassModeSwitch, useClassMode } from './ClassMode';
import { useCourseStart } from './useCourseStart';
import { LearnHeader, LockBadge, buttonPrimary, buttonSecondary, useLocalized } from './parts';

// S1 · The Learn home (ADR-0019): two doors. The drawing course teaches step
// by step ("Start: Lesson 1", or "Continue" from the person's own
// completions, with the optional baseline drawing offered first); the
// challenges are subjects to draw on one's own (Random, Quick, All).
// Experienced artists can open any lesson or go straight to the challenges.
// Class mode, for teachers, sits at the bottom. No progress bars, streaks or
// badges.

// Sketchy, the studio companion (ADR-0024), beside the Learn home's title where there is room.
const CompanionStage = lazy(() => import('@/components/companion/CompanionStage'));

/** Whether a collection is locked for this account: only Pro items are in it for them (ADR-0023), so Pro has it ("Part of Pro"). */
export function useModuleLock(collection: LearnCollection): null | 'pro' | 'plan' {
  const summary = useLearnSummary();
  const account = useAccount()?.account;
  if (summary.modules[collection] !== 'locked') return null;
  return account?.plan.effective !== 'pro' ? 'pro' : 'plan';
}

/** Challenges completed, most recent first (Random skips the latest few). */
export const recentlyDone = (completions: CompletionsAnswer | undefined): string[] =>
  Object.entries(completions?.summary.items ?? {})
    .filter(([id]) => id.startsWith('CH-'))
    .sort((a, b) => b[1].last.localeCompare(a[1].last))
    .map(([id]) => id);

export default function LearnHome() {
  const t = useTranslations('learn');
  const loc = useLocalized();
  const router = useRouter();
  const summary = useLearnSummary();
  const classMode = useClassMode();
  const courseLock = useModuleLock('curriculum');
  const challengesLock = useModuleLock('challenges');
  const showCourse = summary.modules.curriculum !== null || summary.modules.color !== null;
  const showChallenges = summary.modules.challenges !== null;
  const challenges = useLearnList('challenges', showChallenges);
  // The person's own history: never asked for in class mode.
  const completions = useCompletions(!classMode.on);
  const [none, setNone] = useState(false);
  const courseAction = useCourseStart(!classMode.on);
  const page = useRef<HTMLDivElement>(null);
  const companion = useAccount()?.account.companion?.show === true;

  const pick = (quickOnly: boolean) => {
    const id = pickChallenge(challenges.data?.items ?? [], {
      filters: DEFAULT_FILTERS,
      quickOnly,
      recentlyDone: classMode.on ? [] : recentlyDone(completions.data),
      recentlySeen: classMode.recent,
    });
    setNone(id === null);
    if (id) router.push(`${itemPath(id)}?pick=${quickOnly ? 'quick' : 'all'}`);
  };

  return (
    <div ref={page} className="relative">
      <LearnHeader title={t('title')} lead={t('lead')} />
      {/* Sketchy stands on top of these cards, beside the title (ADR-0024). */}
      <div className="grid gap-4 md:grid-cols-2" data-sketchy-floor="">
        {showCourse && (
          <section aria-labelledby="learn-course-title" data-learn-choice="curriculum" className="flex min-w-0 flex-col rounded-2xl border border-border bg-card p-5 shadow-sm md:p-6">
            <div className="flex items-center gap-3">
              <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-primary/15 text-primary">
                <PencilLine className="h-6 w-6" aria-hidden="true" />
              </span>
              <h2 id="learn-course-title" className="text-xl font-bold text-foreground">
                {t('home.courseTitle')}
              </h2>
              {courseLock && <LockBadge pro={courseLock === 'pro'} />}
            </div>
            <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{t('home.courseLead')}</p>
            {courseAction.where && (
              <p className="mt-2 text-xs font-medium text-muted-foreground" data-course-where>
                {courseAction.where}
              </p>
            )}
            <div className="mt-auto flex flex-col gap-2 pt-5">
              <Link href={courseAction.href} className={`${buttonPrimary} py-2.5 text-center`} data-course-action>
                <span className="min-w-0">{courseAction.label}</span>
              </Link>
              <Link href={learnPath({ screen: 'curriculum' })} className={buttonSecondary}>
                {t('home.allLessons')}
              </Link>
              {courseAction.baseline && (
                <Link
                  href={itemPath(courseAction.baseline.id)}
                  className="inline-flex min-h-[44px] items-center justify-center rounded-lg px-2 text-center text-sm font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  data-course-baseline
                >
                  {t('home.baseline', { title: loc(courseAction.baseline.title) })}
                </Link>
              )}
            </div>
            <p className="mt-3 text-xs leading-relaxed text-muted-foreground">{t('home.experienced')}</p>
          </section>
        )}
        {showChallenges && (
          <section aria-labelledby="learn-challenges-title" data-learn-choice="challenges" className="flex min-w-0 flex-col rounded-2xl border border-border bg-card p-5 shadow-sm md:p-6">
            <div className="flex items-center gap-3">
              <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-primary/15 text-primary">
                <Sparkles className="h-6 w-6" aria-hidden="true" />
              </span>
              <h2 id="learn-challenges-title" className="text-xl font-bold text-foreground">
                {t('home.challengesTitle')}
              </h2>
              {challengesLock && <LockBadge pro={challengesLock === 'pro'} />}
            </div>
            <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{t('home.challengesLead')}</p>
            <div className="mt-auto grid grid-cols-2 gap-2 pt-5">
              <button type="button" onClick={() => pick(false)} disabled={!challenges.data} className={buttonPrimary}>
                <Dices className="h-5 w-5" aria-hidden="true" /> {t('home.random')}
              </button>
              <button type="button" onClick={() => pick(true)} disabled={!challenges.data} className={buttonSecondary}>
                <Timer className="h-5 w-5" aria-hidden="true" /> {t('home.quick')}
              </button>
              <Link href={learnPath({ screen: 'challenges' })} className={`${buttonSecondary} col-span-2`}>
                {t('home.browse')}
              </Link>
            </div>
            {none && (
              <p role="status" className="mt-3 text-sm text-muted-foreground">
                {t('home.noneOpen')}
              </p>
            )}
          </section>
        )}
      </div>
      {!classMode.on && (
        <p className="mt-6">
          <Link
            href={learnPath({ screen: 'history' })}
            className="inline-flex min-h-[44px] items-center gap-2 rounded-lg px-1 text-sm font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <History className="h-4 w-4" aria-hidden="true" /> {t('home.history')}
          </Link>
        </p>
      )}
      <section aria-labelledby="learn-teachers-title" className="mt-8" data-learn-teachers>
        <h2 id="learn-teachers-title" className="mb-2 text-sm font-semibold text-muted-foreground">
          {t('home.teachers')}
        </h2>
        <ClassModeSwitch />
      </section>
      {companion && (
        <>
          {/* Room to scroll the last lines above Sketchy where he floats. */}
          <div aria-hidden="true" className="h-28 md:h-16" data-sketchy-room="" />
          <Suspense fallback={null}>
            <CompanionStage screen="learn" containerRef={page} />
          </Suspense>
        </>
      )}
    </div>
  );
}
