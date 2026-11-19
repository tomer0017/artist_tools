import { useEffect } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useTranslations } from 'use-intl';
import { GraduationCap } from 'lucide-react';
import { LEARN_ROOT, isLearnPath, learnRouteOf } from '@/lib/learn/routes';
import { useLearnSummary } from '@/components/shell/account';
import { pathForView } from '@/components/shell/tools';
import { ClassModeProvider } from './ClassMode';
import LearnHome from './LearnHome';
import CurriculumScreen from './CurriculumScreen';
import ChallengesScreen from './ChallengesScreen';
import ItemScreen from './ItemScreen';
import HistoryScreen from './HistoryScreen';
import { buttonPrimary } from './parts';

// ─── Learn in the studio (ADR-0018) ───────────────────────────────────────────
// One studio view with a screen per address (src/lib/learn/routes.ts), so the
// tools stay alive behind it: opening Create a Grid from an exercise and
// coming back loses nothing. What a screen shows comes from the Learn API,
// decided on the server for this account on every request (./data.ts); the
// studio only shapes it. Designed for drawing on paper: choose a task in a
// few taps, put the screen down, come back when help is needed.

export default function LearnView() {
  const pathname = usePathname();
  const router = useRouter();
  const route = learnRouteOf(pathname);
  const summary = useLearnSummary();

  // An address in Learn that does not exist leads to the Learn home. (An
  // address outside Learn is the studio moving to another view, e.g. a tool
  // shortcut: this view is about to give way, so it must not pull it back.)
  const unknownInLearn = !route && isLearnPath(pathname);
  useEffect(() => {
    if (unknownInLearn) router.replace(LEARN_ROOT);
  }, [unknownInLearn, router]);

  // Access ended while Learn was open (the account copy refreshes every minute): say so, nothing else.
  if (!summary.visible) return <LearnGone />;
  if (!route) return null;

  return (
    <ClassModeProvider>
      {/* A new scroll position for each screen. It scrolls up and down only: right to left, WebKit with visible
          scrollbars (Safari on a Mac, the emulated iPhone) counts the scrollbar's width as sideways overflow. */}
      <div key={pathname} data-learn-screen={route.screen} className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-contain bg-background">
        <div className="mx-auto w-full max-w-5xl px-4 pb-[calc(env(safe-area-inset-bottom)+40px)] pt-4 md:px-6 md:pt-6 lg:px-8">
          {route.screen === 'home' && <LearnHome />}
          {route.screen === 'curriculum' && <CurriculumScreen />}
          {route.screen === 'challenges' && <ChallengesScreen />}
          {route.screen === 'history' && <HistoryScreen />}
          {(route.screen === 'exercise' || route.screen === 'challenge') && <ItemScreen key={route.id} id={route.id} kind={route.screen} />}
        </div>
      </div>
    </ClassModeProvider>
  );
}

function LearnGone() {
  const t = useTranslations('learn');
  const tl = useTranslations('studio.locked');
  return (
    <section className="flex min-h-0 flex-1 items-center justify-center overflow-y-auto bg-background px-4 py-8" aria-labelledby="learn-gone-title">
      <div className="w-full max-w-md rounded-2xl border border-border bg-card p-6 text-center shadow-sm">
        <GraduationCap className="mx-auto h-10 w-10 text-muted-foreground" aria-hidden="true" />
        <h1 id="learn-gone-title" className="mt-4 text-xl font-bold text-foreground">
          {t('lockedItem.titleUnknown')}
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">{t('lockedItem.reason.off')}</p>
        <Link href={pathForView('home')} className={`${buttonPrimary} mt-6 w-full`}>
          {tl('back')}
        </Link>
      </div>
    </section>
  );
}
