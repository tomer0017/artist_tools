import { useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { abilitiesOf, canRun, type Abilities } from '@/lib/companion/registry';
import type { CompanionFeature, Mood, TipAction } from '@/lib/companion/model';
import { itemPath, learnPath } from '@/lib/learn/routes';
import { useAccount } from '@/components/shell/account';
import { pathForView } from '@/components/shell/tools';
import { COMPANION_PREFIX, type FeatureState } from './state';

// What Sketchy's buttons do (ADR-0024): each of the fixed action types, done
// with the person's own access. Navigation goes through the studio's router
// (so the tools stay alive behind it); the roulette, a drawing tip and the
// guided menus open in place. Nothing here can reach an address or a
// function an admin typed: only these cases exist.

export type MenuView = 'main' | 'tip' | 'improve' | 'choose' | 'lesson' | 'sheets' | 'class' | 'about' | 'hide';

export interface ActionHost {
  openRoulette: (options: { mood?: Mood; classMode?: boolean }) => void;
  openMenu: (view: MenuView) => void;
  /** The next lesson's address (the course's Start/Continue), when known. */
  nextLessonHref: string | null;
}

/** Asked of Create a Grid: open "Prepare worksheets" when it has a photo (read once by GridTab). */
export const WORKSHEETS_REQUEST = `${COMPANION_PREFIX}-open-worksheets`;

export function requestWorksheets() {
  try {
    window.sessionStorage.setItem(WORKSHEETS_REQUEST, String(Date.now()));
  } catch {
    // Without storage the person presses the button in the tool themselves.
  }
}

/** Taken once: whether Sketchy asked for the worksheets in the last minute. */
export function takeWorksheetsRequest(): boolean {
  try {
    const at = Number(window.sessionStorage.getItem(WORKSHEETS_REQUEST));
    window.sessionStorage.removeItem(WORKSHEETS_REQUEST);
    return Number.isFinite(at) && Date.now() - at < 60_000;
  } catch {
    return false;
  }
}

/** What the person can do now (from the account the server sent) and Sketchy's capabilities for them. */
export function useAbilities(features: Partial<Record<CompanionFeature, FeatureState>> | undefined): Abilities {
  const account = useAccount()?.account ?? null;
  return useMemo(() => abilitiesOf(account, features ?? {}), [account, features]);
}

export function useRunAction(host: ActionHost, can: Abilities) {
  const router = useRouter();
  return useCallback(
    (action: TipAction): boolean => {
      if (!canRun(action, can)) return false;
      switch (action.type) {
        case 'none':
          return true;
        case 'openTool':
          router.push(pathForView(action.tool!));
          return true;
        case 'roulette':
          host.openRoulette({ mood: action.mood });
          return true;
        case 'classRoulette':
          host.openRoulette({ mood: action.mood, classMode: true });
          return true;
        case 'nextLesson':
          if (host.nextLessonHref) router.push(host.nextLessonHref);
          else host.openMenu('lesson');
          return true;
        case 'openLearn':
          router.push(learnPath({ screen: action.page ?? 'home' }));
          return true;
        case 'openItem':
          router.push(itemPath(action.itemId!));
          return true;
        case 'worksheets':
          requestWorksheets();
          router.push(pathForView('grid'));
          return true;
        case 'drawingTip':
          host.openMenu('tip');
          return true;
        case 'improve':
          host.openMenu('improve');
          return true;
        case 'chooseTool':
          host.openMenu('choose');
          return true;
        default:
          return false;
      }
    },
    [can, host, router],
  );
}
