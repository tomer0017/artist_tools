import { CHALLENGE_ID, EXERCISE_ID } from './model';

// ─── Learn's addresses in the studio (ADR-0018) ───────────────────────────────
// Learn is one studio view with screens of its own, each at its own address,
// so links, reloads and the back gesture work as everywhere else:
//   /app/learn                       S1 Learn home
//   /app/learn/curriculum            S2 the drawing course (and colour)
//   /app/learn/exercises/<id>        S3 an exercise
//   /app/learn/challenges            S4 the challenges
//   /app/learn/challenges/<id>       S5 a challenge
//   /app/learn/history               S8 the person's own history
// Pure, shared by the server pages and the studio.

export const LEARN_ROOT = '/app/learn';

export type LearnRoute =
  | { screen: 'home' }
  | { screen: 'curriculum' }
  | { screen: 'challenges' }
  | { screen: 'history' }
  | { screen: 'exercise'; id: string }
  | { screen: 'challenge'; id: string };

export function learnPath(route: LearnRoute): string {
  switch (route.screen) {
    case 'home':
      return LEARN_ROOT;
    case 'exercise':
      return `${LEARN_ROOT}/exercises/${route.id}`;
    case 'challenge':
      return `${LEARN_ROOT}/challenges/${route.id}`;
    default:
      return `${LEARN_ROOT}/${route.screen}`;
  }
}

/** The address of an item's own page, from its ID (exercises and colour exercises: D- and C-; challenges: CH-). */
export const itemPath = (id: string): string => learnPath(CHALLENGE_ID.test(id) ? { screen: 'challenge', id } : { screen: 'exercise', id });

/** Whether a pathname is in Learn at all (any depth). */
export const isLearnPath = (pathname: string): boolean => pathname === LEARN_ROOT || pathname.startsWith(`${LEARN_ROOT}/`);

/** The screen a pathname shows; null for an address in Learn that does not exist (or outside Learn). */
export function learnRouteOf(pathname: string): LearnRoute | null {
  if (!isLearnPath(pathname)) return null;
  const parts = pathname.slice(LEARN_ROOT.length).split('/').filter(Boolean);
  if (parts.length === 0) return { screen: 'home' };
  const [first, second, ...rest] = parts;
  if (rest.length > 0) return null;
  if (second === undefined) {
    if (first === 'curriculum' || first === 'challenges' || first === 'history') return { screen: first };
    return null;
  }
  if (first === 'exercises' && EXERCISE_ID.test(second)) return { screen: 'exercise', id: second };
  if (first === 'challenges' && CHALLENGE_ID.test(second)) return { screen: 'challenge', id: second };
  return null;
}
