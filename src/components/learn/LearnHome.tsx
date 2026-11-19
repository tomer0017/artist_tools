import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'use-intl';
import { Dices, History, PencilLine, Sparkles, Timer } from 'lucide-react';
import { LEARN_MODULE, type LearnCollection } from '@/lib/learn/model';
import { DEFAULT_FILTERS, pickChallenge } from '@/lib/learn/pick';
import { itemPath, learnPath } from '@/lib/learn/routes';
import { useAccount, useLearnSummary } from '@/components/shell/account';
import { useCompletions, useLearnList, type CompletionsAnswer } from './data';
import { ClassModeSwitch, useClassMode } from './ClassMode';
import { LearnHeader, LockBadge, buttonPrimary, buttonSecondary, useLocalized } from './parts';

// S1 · The Learn home: two choices — the drawing course (with "Continue" from
// the person's own completions) and the challenges (Random, Quick, All) — and
// the class mode switch. Nothing else: no progress bars, streaks or badges.

/** Whether a collection is locked for this account, and whether Pro has it ("Part of Pro"). */
export function useModuleLock(collection: LearnCollection): null | 'pro' | 'plan' {
  const summary = useLearnSummary();
  const account = useAccount()?.account;
  if (summary.modules[collection] !== 'locked') return null;
  return account?.offer.pro.includes(LEARN_MODULE[collection]) && account.plan.effective !== 'pro' ? 'pro' : 'plan';
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
  const course = useLearnList('curriculum', summary.modules.curriculum !== null);
  const challenges = useLearnList('challenges', showChallenges);
  // The person's own history: never asked for in class mode.
  const completions = useCompletions(!classMode.on);
  const [none, setNone] = useState(false);

  const openExercises = course.data?.items.filter((item) => item.open) ?? [];
  const done = classMode.on ? {} : (completions.data?.summary.items ?? {});
  const started = Object.keys(done).some((id) => openExercises.some((item) => item.id === id));
  const next = openExercises.find((item) => !done[item.id]) ?? null;
  const courseAction =
    started && next
      ? { href: itemPath(next.id), label: t('home.continue', { title: loc(next.title) }) }
      : !started && openExercises[0]
        ? { href: itemPath(openExercises[0].id), label: t('home.start', { title: loc(openExercises[0].title) }) }
        : { href: learnPath({ screen: 'curriculum' }), label: t('home.openCourse') };

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
    <>
      <LearnHeader title={t('title')} lead={t('lead')} />
      <ClassModeSwitch />
      <div className="mt-5 grid gap-4 md:grid-cols-2">
        {showCourse && (
          <section aria-labelledby="learn-course-title" data-learn-choice="curriculum" className="flex flex-col rounded-2xl border border-border bg-card p-5 shadow-sm md:p-6">
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
            <div className="mt-auto flex flex-col gap-2 pt-5">
              <Link href={courseAction.href} className={buttonPrimary} data-course-action>
                <span className="min-w-0 truncate">{courseAction.label}</span>
              </Link>
              <Link href={learnPath({ screen: 'curriculum' })} className={buttonSecondary}>
                {t('home.allExercises')}
              </Link>
            </div>
          </section>
        )}
        {showChallenges && (
          <section aria-labelledby="learn-challenges-title" data-learn-choice="challenges" className="flex flex-col rounded-2xl border border-border bg-card p-5 shadow-sm md:p-6">
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
    </>
  );
}
