import { CHALLENGE_ID, type CHALLENGE_LEVELS } from './model';

// ─── Challenges V2: the roulette (ADR-0021) ──────────────────────────────────
// Pure, so the rules are tested once. A mood is the effort the person feels
// like today, never a skill rating: something light, something to create, a
// challenge, or a surprise from all of them. A challenge's level is read as
// that effort (the content keeps its field). A spin picks among the
// challenges this account may open, never the one on screen and not the last
// few spun while others are left; the reel is a few other titles passed on
// the way, ending on the pick. What the person keeps (saved challenges, the
// last spins) stays in this browser, like the filters.

export const MOODS = ['light', 'create', 'challenge', 'surprise'] as const;
export type Mood = (typeof MOODS)[number];
export type Effort = Exclude<Mood, 'surprise'>;

export const EFFORT_OF_LEVEL: Record<(typeof CHALLENGE_LEVELS)[number], Effort> = { beginner: 'light', intermediate: 'create', advanced: 'challenge' };

/** What a list entry needs to be spun. */
export interface Spinnable {
  id: string;
  open: boolean;
  level?: string;
}

export const effortOf = (entry: { level?: string }): Effort | null => (entry.level && Object.prototype.hasOwnProperty.call(EFFORT_OF_LEVEL, entry.level) ? EFFORT_OF_LEVEL[entry.level as keyof typeof EFFORT_OF_LEVEL] : null);

/** The challenges a mood can land on: the open ones of its effort, or every open one for a surprise. */
export function poolOf<E extends Spinnable>(entries: readonly E[], mood: Mood): E[] {
  return entries.filter((entry) => entry.open && (mood === 'surprise' || effortOf(entry) === mood));
}

/** How many of the last spins a new spin avoids, while the pool has others. */
export const AVOID_RECENT = 8;

/** One spin: a challenge of the mood, never the one on screen (unless it is the only one), not a recent one while others are left. */
export function spin<E extends Spinnable>(
  entries: readonly E[],
  mood: Mood,
  { current = null, recent = [], random = Math.random }: { current?: string | null; recent?: readonly string[]; random?: () => number } = {},
): E | null {
  const pool = poolOf(entries, mood);
  if (pool.length === 0) return null;
  const others = pool.filter((entry) => entry.id !== current);
  if (others.length === 0) return pool[0];
  const avoid = new Set(recent.slice(0, AVOID_RECENT));
  const fresh = others.filter((entry) => !avoid.has(entry.id));
  const from = fresh.length > 0 ? fresh : others;
  return from[Math.min(from.length - 1, Math.floor(random() * from.length))];
}

/** The reel: up to `length - 1` other challenges of the pool, no two alike in a row, then the pick. */
export function reelOf<E extends Spinnable>(pool: readonly E[], pick: E, length = 10, random = Math.random): E[] {
  const others = pool.filter((entry) => entry.id !== pick.id);
  const reel: E[] = [];
  for (let i = 0; i < length - 1 && others.length > 0; i++) {
    const choices = others.length > 1 ? others.filter((entry) => entry !== reel.at(-1)) : others;
    reel.push(choices[Math.min(choices.length - 1, Math.floor(random() * choices.length))]);
  }
  return [...reel, pick];
}

/** Where this browser keeps the mood, the challenge on screen, the last spins and the saved challenges. */
/** Every key the playground and its timer keep in this browser starts with this (cleared with this device's work). */
export const PLAYGROUND_PREFIX = 'studio-challenge-';

export const PLAYGROUND_KEYS = {
  mood: 'studio-challenge-mood',
  current: 'studio-challenge-current',
  recent: 'studio-challenge-recent',
  saved: 'studio-challenge-saved',
} as const;

export const MAX_SAVED = 200;

export const readMood = (value: unknown): Mood => ((MOODS as readonly unknown[]).includes(value) ? (value as Mood) : 'surprise');

/** Challenge IDs read back from this browser: anything else dropped, no repeats, at most `max`. */
export function readIds(value: unknown, max: number): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((id): id is string => typeof id === 'string' && CHALLENGE_ID.test(id)))].slice(0, max);
}

/** Saving or unsaving one challenge: the newest first. */
export const toggleSaved = (saved: readonly string[], id: string): string[] => (saved.includes(id) ? saved.filter((x) => x !== id) : [id, ...saved].slice(0, MAX_SAVED));

/** The last spins with a new one on top. */
export const withSpin = (recent: readonly string[], id: string): string[] => [id, ...recent.filter((x) => x !== id)].slice(0, 20);
