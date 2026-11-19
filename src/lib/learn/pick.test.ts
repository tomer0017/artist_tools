import { describe, expect, it } from 'vitest';
import { DEFAULT_FILTERS, SKIP_RECENTLY_DONE, filtersActive, matchesFilters, pickChallenge, readFilters, rememberSeen, type PickableChallenge } from './pick';

// Random and Quick (ADR-0018, S4): never a locked challenge, the filters
// respected, the most recently done and the just-shown ones skipped while
// others remain.

const challenge = (id: string, traits: Partial<PickableChallenge> = {}): PickableChallenge => ({
  id,
  open: true,
  groupId: 'objects',
  level: 'beginner',
  medium: 'pencil',
  quick: false,
  ...traits,
});

/** Every value `random` can give, so a test sees every challenge a pick may return. */
function everyPick(entries: PickableChallenge[], options: Omit<Parameters<typeof pickChallenge>[1], 'random'>): string[] {
  const picks = new Set<string>();
  for (let i = 0; i < 50; i++) {
    const id = pickChallenge(entries, { ...options, random: () => i / 50 });
    if (id) picks.add(id);
  }
  return [...picks].sort();
}

describe('filters', () => {
  it('match level, subject, pencil or colour, and quick only', () => {
    const quickColour = challenge('CH-001', { level: 'intermediate', groupId: 'plants', medium: 'both', quick: true });
    expect(matchesFilters(quickColour, DEFAULT_FILTERS)).toBe(true);
    expect(matchesFilters(quickColour, { ...DEFAULT_FILTERS, level: 'intermediate' })).toBe(true);
    expect(matchesFilters(quickColour, { ...DEFAULT_FILTERS, level: 'beginner' })).toBe(false);
    expect(matchesFilters(quickColour, { ...DEFAULT_FILTERS, group: 'plants' })).toBe(true);
    expect(matchesFilters(quickColour, { ...DEFAULT_FILTERS, group: 'objects' })).toBe(false);
    expect(matchesFilters(quickColour, { ...DEFAULT_FILTERS, medium: 'color' })).toBe(true);
    expect(matchesFilters(quickColour, { ...DEFAULT_FILTERS, medium: 'pencil' })).toBe(false);
    expect(matchesFilters(challenge('CH-002'), { ...DEFAULT_FILTERS, quick: true })).toBe(false);
  });

  it('are read back from the device tolerantly: anything unknown is "all"', () => {
    expect(readFilters({ level: 'advanced', group: 'plants', medium: 'color', quick: true, skill: 'shapes' })).toEqual({ level: 'advanced', group: 'plants', medium: 'color', quick: true, skill: 'shapes' });
    // Filters remembered before the Skill filter existed (M5) read as every skill.
    expect(readFilters({ level: 'advanced', group: 'plants', medium: 'color', quick: true })).toEqual({ level: 'advanced', group: 'plants', medium: 'color', quick: true, skill: 'all' });
    expect(readFilters({ level: 'expert', group: '../x', medium: 'oil', quick: 'yes', skill: '<script>' })).toEqual(DEFAULT_FILTERS);
    expect(readFilters(null)).toEqual(DEFAULT_FILTERS);
    expect(readFilters('nonsense')).toEqual(DEFAULT_FILTERS);
    expect(filtersActive(DEFAULT_FILTERS)).toBe(false);
    expect(filtersActive({ ...DEFAULT_FILTERS, quick: true })).toBe(true);
    expect(filtersActive({ ...DEFAULT_FILTERS, skill: 'shapes' })).toBe(true);
  });

  it('the Skill filter is the course unit of the lessons a challenge builds on (ADR-0019); without the course it is ignored', () => {
    const units: Record<string, string> = { 'D-LINE-04': 'start', 'D-SHAPE-01': 'shapes', 'D-OBS-02': 'shapes' };
    const unitsOf = (lessons: string[] | undefined) => [...new Set((lessons ?? []).flatMap((id) => (units[id] ? [units[id]] : [])))];
    const leaf = challenge('CH-012', { lessons: ['D-LINE-04', 'D-SHAPE-01'] });
    const free = challenge('CH-049');
    expect(matchesFilters(leaf, { ...DEFAULT_FILTERS, skill: 'start' }, unitsOf)).toBe(true);
    expect(matchesFilters(leaf, { ...DEFAULT_FILTERS, skill: 'shapes' }, unitsOf)).toBe(true);
    expect(matchesFilters(leaf, { ...DEFAULT_FILTERS, skill: 'values' }, unitsOf)).toBe(false);
    // A challenge that builds on no lesson has no skill to match.
    expect(matchesFilters(free, { ...DEFAULT_FILTERS, skill: 'start' }, unitsOf)).toBe(false);
    expect(matchesFilters(free, DEFAULT_FILTERS, unitsOf)).toBe(true);
    // The course not shown to this account (or not loaded yet): the filter hides nothing.
    expect(matchesFilters(free, { ...DEFAULT_FILTERS, skill: 'start' })).toBe(true);
    // Random honours it.
    expect(everyPick([leaf, free], { filters: { ...DEFAULT_FILTERS, skill: 'shapes' }, unitsOf })).toEqual(['CH-012']);
  });
});

describe('Random and Quick', () => {
  const entries = [
    challenge('CH-001', { quick: true }),
    challenge('CH-002', { open: false, quick: true }),
    challenge('CH-003', { level: 'advanced' }),
    challenge('CH-004', { open: false }),
    challenge('CH-005', { quick: true, medium: 'both' }),
  ];

  it('never offer a locked challenge', () => {
    expect(everyPick(entries, { filters: DEFAULT_FILTERS })).toEqual(['CH-001', 'CH-003', 'CH-005']);
    expect(pickChallenge([challenge('CH-009', { open: false })], { filters: DEFAULT_FILTERS })).toBeNull();
  });

  it('respect the filters; Quick offers quick challenges only', () => {
    expect(everyPick(entries, { filters: { ...DEFAULT_FILTERS, level: 'advanced' } })).toEqual(['CH-003']);
    expect(everyPick(entries, { filters: DEFAULT_FILTERS, quickOnly: true })).toEqual(['CH-001', 'CH-005']);
    expect(everyPick(entries, { filters: { ...DEFAULT_FILTERS, medium: 'color' }, quickOnly: true })).toEqual(['CH-005']);
    expect(pickChallenge(entries, { filters: { ...DEFAULT_FILTERS, level: 'intermediate' } })).toBeNull();
  });

  it('skip the most recently done and the ones just shown, while others remain', () => {
    expect(everyPick(entries, { filters: DEFAULT_FILTERS, recentlyDone: ['CH-001'] })).toEqual(['CH-003', 'CH-005']);
    expect(everyPick(entries, { filters: DEFAULT_FILTERS, recentlyDone: ['CH-001'], recentlySeen: ['CH-005'] })).toEqual(['CH-003']);
    // Only so many of the latest completions are skipped.
    const many = Array.from({ length: SKIP_RECENTLY_DONE + 1 }, (_, i) => challenge(`CH-1${String(i).padStart(2, '0')}`));
    const done = many.map((c) => c.id);
    expect(everyPick(many, { filters: DEFAULT_FILTERS, recentlyDone: done })).toEqual([done[SKIP_RECENTLY_DONE]]);
  });

  it('"Another one" never repeats the one on screen while another exists; with one, offers it again rather than nothing', () => {
    expect(everyPick(entries, { filters: DEFAULT_FILTERS, exclude: 'CH-001', recentlyDone: ['CH-003', 'CH-005'], recentlySeen: ['CH-003', 'CH-005'] })).toEqual(['CH-003', 'CH-005']);
    expect(pickChallenge([challenge('CH-001')], { filters: DEFAULT_FILTERS, exclude: 'CH-001' })).toBe('CH-001');
  });

  it('remember what was shown, most recent first, a short list', () => {
    expect(rememberSeen(['CH-002', 'CH-001'], 'CH-001')).toEqual(['CH-001', 'CH-002']);
    expect(rememberSeen(Array.from({ length: 12 }, (_, i) => `CH-${100 + i}`), 'CH-999')).toHaveLength(12);
  });
});
