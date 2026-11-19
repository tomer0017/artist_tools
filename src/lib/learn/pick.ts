import { CHALLENGE_LEVELS } from './model';

// ─── Challenges: filters, Random and Quick (ADR-0018) ─────────────────────────
// Pure, so the rules are tested once: Random picks among the challenges the
// server says this account may open (never a locked one) that match the
// filters, skipping the ones done most recently and the ones just shown in
// this tab; Quick is Random among quick challenges only. The Skill filter is
// the course's units: a challenge's skill is the unit of the lessons it builds
// on (ADR-0019).

export type LevelFilter = 'all' | (typeof CHALLENGE_LEVELS)[number];
export type MediumFilter = 'all' | 'pencil' | 'color';

export interface ChallengeFilters {
  level: LevelFilter;
  /** A challenge group's ID, or every group. */
  group: string;
  medium: MediumFilter;
  quick: boolean;
  /** A course unit's ID (the challenge builds on one of its lessons), or every skill. */
  skill: string;
}

export const DEFAULT_FILTERS: ChallengeFilters = { level: 'all', group: 'all', medium: 'all', quick: false, skill: 'all' };

const GROUP_OR_ALL = /^(all|[a-z][a-z0-9-]{1,31})$/;

/** Where the filters are remembered on this device. */
export const FILTERS_KEY = 'studio-learn-challenge-filters';

/** Filters read back from this device: anything unknown falls back to "all". */
export function readFilters(value: unknown): ChallengeFilters {
  const v = (typeof value === 'object' && value !== null ? value : {}) as Partial<Record<keyof ChallengeFilters, unknown>>;
  return {
    level: v.level === 'all' || (CHALLENGE_LEVELS as readonly unknown[]).includes(v.level) ? (v.level as LevelFilter) : 'all',
    group: typeof v.group === 'string' && GROUP_OR_ALL.test(v.group) ? v.group : 'all',
    medium: v.medium === 'pencil' || v.medium === 'color' ? v.medium : 'all',
    quick: v.quick === true,
    skill: typeof v.skill === 'string' && GROUP_OR_ALL.test(v.skill) ? v.skill : 'all',
  };
}

export const filtersActive = (filters: ChallengeFilters): boolean =>
  filters.level !== 'all' || filters.group !== 'all' || filters.medium !== 'all' || filters.quick || filters.skill !== 'all';

/** What a list entry needs for filtering and picking. */
export interface PickableChallenge {
  id: string;
  open: boolean;
  groupId: string;
  level?: string;
  medium?: string;
  quick?: boolean;
  /** The lessons it builds on. */
  lessons?: string[];
}

/** A challenge's skills: the course units of the lessons it builds on. */
export type UnitsOf = (lessons: string[] | undefined) => string[];

/**
 * Whether a challenge matches the filters. The Skill filter needs the course
 * (`unitsOf`); without it (the course is not shown to this account, or not
 * loaded yet) it is ignored rather than hiding everything.
 */
export function matchesFilters(entry: PickableChallenge, filters: ChallengeFilters, unitsOf?: UnitsOf): boolean {
  if (filters.level !== 'all' && entry.level !== filters.level) return false;
  if (filters.group !== 'all' && entry.groupId !== filters.group) return false;
  if (filters.medium === 'pencil' && entry.medium !== 'pencil') return false;
  if (filters.medium === 'color' && entry.medium !== 'both') return false;
  if (filters.quick && entry.quick !== true) return false;
  if (filters.skill !== 'all' && unitsOf && !unitsOf(entry.lessons).includes(filters.skill)) return false;
  return true;
}

/** How many of the most recently completed challenges Random skips. */
export const SKIP_RECENTLY_DONE = 5;

export interface PickOptions {
  filters: ChallengeFilters;
  /** Quick: quick challenges only, whatever the filters say. */
  quickOnly?: boolean;
  /** Never this one (the challenge on screen, for "Another one"). */
  exclude?: string | null;
  /** Completed challenges, most recent first (from the person's history; empty in class mode). */
  recentlyDone?: string[];
  /** Challenges shown recently in this tab, most recent first. */
  recentlySeen?: string[];
  /** The course, for the Skill filter. */
  unitsOf?: UnitsOf;
  random?: () => number;
}

/**
 * One challenge to draw, or null when none is open and matching. Prefers one
 * neither done recently nor just shown; when every candidate was, it relaxes
 * those preferences rather than finding nothing, but never offers a locked
 * challenge or (when another exists) the one on screen.
 */
export function pickChallenge(entries: readonly PickableChallenge[], options: PickOptions): string | null {
  const random = options.random ?? Math.random;
  const pool = entries.filter((e) => e.open && matchesFilters(e, options.quickOnly ? { ...options.filters, quick: true } : options.filters, options.unitsOf));
  if (pool.length === 0) return null;
  const done = new Set((options.recentlyDone ?? []).slice(0, SKIP_RECENTLY_DONE));
  const seen = new Set(options.recentlySeen ?? []);
  const notCurrent = pool.filter((e) => e.id !== options.exclude);
  const tiers = [
    notCurrent.filter((e) => !done.has(e.id) && !seen.has(e.id)),
    notCurrent.filter((e) => !done.has(e.id)),
    notCurrent.filter((e) => !seen.has(e.id)),
    notCurrent,
    pool,
  ];
  const candidates = tiers.find((tier) => tier.length > 0)!;
  return candidates[Math.min(candidates.length - 1, Math.floor(random() * candidates.length))].id;
}

/** Remember that a challenge was shown in this tab (most recent first, a short list). */
export const rememberSeen = (seen: readonly string[], id: string, keep = 12): string[] => [id, ...seen.filter((s) => s !== id)].slice(0, keep);
