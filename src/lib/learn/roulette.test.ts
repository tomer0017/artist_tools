import { describe, expect, it } from 'vitest';
import { AVOID_RECENT, MAX_SAVED, effortOf, poolOf, readIds, readMood, reelOf, spin, toggleSaved, withSpin } from './roulette';

const entry = (id: string, level: string, open = true) => ({ id, level, open });
const entries = [
  entry('CH-101', 'beginner'),
  entry('CH-102', 'beginner'),
  entry('CH-103', 'intermediate'),
  entry('CH-104', 'advanced'),
  entry('CH-105', 'advanced', false),
  entry('CH-106', 'intermediate'),
];
/** A fixed sequence of "random" numbers. */
const sequence = (...values: number[]) => {
  let i = 0;
  return () => values[i++ % values.length];
};

describe('the roulette', () => {
  it('reads a level as an effort, never as a skill', () => {
    expect(effortOf({ level: 'beginner' })).toBe('light');
    expect(effortOf({ level: 'intermediate' })).toBe('create');
    expect(effortOf({ level: 'advanced' })).toBe('challenge');
    expect(effortOf({ level: 'toString' })).toBeNull();
    expect(effortOf({})).toBeNull();
  });

  it('a mood lands only on open challenges of its effort; a surprise on any open one', () => {
    expect(poolOf(entries, 'light').map((e) => e.id)).toEqual(['CH-101', 'CH-102']);
    expect(poolOf(entries, 'create').map((e) => e.id)).toEqual(['CH-103', 'CH-106']);
    expect(poolOf(entries, 'challenge').map((e) => e.id)).toEqual(['CH-104']);
    expect(poolOf(entries, 'surprise').map((e) => e.id)).toEqual(['CH-101', 'CH-102', 'CH-103', 'CH-104', 'CH-106']);
    // Never a locked one, whatever the luck.
    for (let i = 0; i < 50; i++) expect(spin(entries, 'challenge', { random: Math.random })?.id).toBe('CH-104');
  });

  it('never repeats the challenge on screen while there is another, and skips recent spins while others are left', () => {
    for (let i = 0; i < 50; i++) expect(spin(entries, 'light', { current: 'CH-101' })?.id).toBe('CH-102');
    // The only one of its mood comes back rather than nothing.
    expect(spin(entries, 'challenge', { current: 'CH-104' })?.id).toBe('CH-104');
    expect(spin(entries, 'surprise', { current: 'CH-101', recent: ['CH-102', 'CH-103', 'CH-104'], random: sequence(0) })?.id).toBe('CH-106');
    // Everything recent: any other one, still never the one on screen.
    expect(spin(entries, 'create', { current: 'CH-103', recent: ['CH-106'] })?.id).toBe('CH-106');
    expect(spin([], 'surprise')).toBeNull();
    expect(spin(entries.map((e) => ({ ...e, open: false })), 'surprise')).toBeNull();
    // Only the last few count as recent.
    const many = Array.from({ length: AVOID_RECENT + 2 }, (_, i) => entry(`CH-${200 + i}`, 'beginner'));
    const recent = many.slice(0, AVOID_RECENT + 1).map((e) => e.id);
    expect(spin(many, 'light', { recent, random: sequence(0) })?.id).toBe(`CH-${200 + AVOID_RECENT}`);
  });

  it('the reel passes other challenges, never the same twice in a row, and ends on the pick', () => {
    const pool = poolOf(entries, 'surprise');
    const reel = reelOf(pool, pool[2], 10, sequence(0.1, 0.1, 0.6, 0.9, 0.3));
    expect(reel).toHaveLength(10);
    expect(reel.at(-1)?.id).toBe('CH-103');
    reel.slice(0, -1).forEach((e, i, all) => {
      expect(e.id).not.toBe('CH-103');
      if (i > 0) expect(e).not.toBe(all[i - 1]);
    });
    // A pool of one: just the pick.
    expect(reelOf([entries[3]], entries[3]).map((e) => e.id)).toEqual(['CH-104']);
  });

  it('what this browser keeps is read back safely', () => {
    expect(readMood('create')).toBe('create');
    expect(readMood('everything')).toBe('surprise');
    expect(readMood(null)).toBe('surprise');
    expect(readIds(['CH-101', 'CH-101', 'nope', 3, 'CH-102'], 10)).toEqual(['CH-101', 'CH-102']);
    expect(readIds('CH-101', 10)).toEqual([]);
    expect(readIds(['CH-101', 'CH-102', 'CH-103'], 2)).toEqual(['CH-101', 'CH-102']);
    expect(toggleSaved(['CH-101'], 'CH-102')).toEqual(['CH-102', 'CH-101']);
    expect(toggleSaved(['CH-102', 'CH-101'], 'CH-102')).toEqual(['CH-101']);
    expect(toggleSaved(Array.from({ length: MAX_SAVED }, (_, i) => `CH-${300 + i}`), 'CH-999')).toHaveLength(MAX_SAVED);
    expect(withSpin(['CH-101', 'CH-102'], 'CH-102')).toEqual(['CH-102', 'CH-101']);
  });
});
