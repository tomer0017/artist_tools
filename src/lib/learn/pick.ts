import { CHALLENGE_LEVELS } from './model';

// ─── Challenges: filters, Random and Quick (ADR-0018) ─────────────────────────
// Pure, so the rules are tested once: Random picks among the challenges the
// server says this account may open (never a locked one) that match the
// filters, skipping the ones done most recently and the ones just shown in
// this tab; Quick is Random among quick challenges only.

export type LevelFilter = 'all' | (typeof CHALLENGE_LEVELS)[number];
export type MediumFilter = 'all' | 'pencil' | 'color';

export interface ChallengeFilters {
  level: LevelFilter;
  /** A challenge group's ID, or every group. */
  group: string;
  medium: MediumFilter;
  quick: boolean;
}

export const DEFAULT_FILTERS: ChallengeFilters = { level: 'all', group: 'all', medium: 'all', quick: false };

/** Where the filters are remembered on this device. */
export const FILTERS_KEY = 'studio-learn-challenge-filters';

/** Filters read back from this device: anything unknown falls back to "all". */
export function readFilters(value: unknown): ChallengeFilters {
  const v = (typeof value === 'object' && value !== null ? value : {}) as Partial<Record<keyof ChallengeFilters, unknown>>;
  return {
    level: v.level === 'all' || (CHALLENGE_LEVELS as readonly unknown[]).includes(v.level) ? (v.level as LevelFilter) : 'all',
    group: typeof v.group === 'string' && /^(all|[a-z][a-z0-9-]{1,31})$/.test(v.group) ? v.group : 'all',
    medium: v.medium === 'pencil' || v.medium === 'color' ? v.medium : 'all',
    quick: v.quick === true,
  };
}

export const filtersActive = (filters: ChallengeFilters): boolean =>
  filters.level !== 'all' || filters.group !== 'all' || filters.medium !== 'all' || filters.quick;

/** What a list entry needs for filtering and picking. */
export interface PickableChallenge {
  id: string;
  open: boolean;
  groupId: string;
  level?: string;
  medium?: string;
  quick?: boolean;
}

export function matchesFilters(entry: PickableChallenge, filters: ChallengeFilters): boolean {
  if (filters.level !== 'all' && entry.level !== filters.level) return false;
  if (filters.group !== 'all' && entry.groupId !== filters.group) return false;
  if (filters.medium === 'pencil' && entry.medium !== 'pencil') return false;
  if (filters.medium === 'color' && entry.medium !== 'both') return false;
  if (filters.quick && entry.quick !== true) return false;
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
  const pool = entries.filter((e) => e.open && matchesFilters(e, options.quickOnly ? { ...options.filters, quick: true } : options.filters));
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
