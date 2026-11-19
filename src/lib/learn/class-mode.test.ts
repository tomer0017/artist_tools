import { describe, expect, it } from 'vitest';
import { CLASS_MODE_IDLE_MS, CLASS_MODE_KEY, CLASS_MODE_TOUCH_MS, RECENT_KEY, classModeOn, readRecent, setClassMode, touchClassMode, writeRecent } from './class-mode';

// Class mode (ADR-0018, S7): a setting of this tab, on until it is turned off
// or 12 hours pass without use; turning it off forgets the tab's recent challenges.

function memoryStorage() {
  const map = new Map<string, string>();
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => void map.set(key, value),
    removeItem: (key: string) => void map.delete(key),
    map,
  };
}

const T0 = Date.UTC(2026, 10, 20, 8, 0);

describe('class mode', () => {
  it('is off until turned on, and off again when turned off (forgetting the recent challenges)', () => {
    const storage = memoryStorage();
    expect(classModeOn(storage, T0)).toBe(false);
    setClassMode(storage, true, T0);
    expect(classModeOn(storage, T0 + 1000)).toBe(true);
    writeRecent(storage, ['CH-001']);
    expect(readRecent(storage)).toEqual(['CH-001']);
    setClassMode(storage, false, T0 + 2000);
    expect(classModeOn(storage, T0 + 3000)).toBe(false);
    expect(storage.map.has(CLASS_MODE_KEY)).toBe(false);
    expect(storage.map.has(RECENT_KEY)).toBe(false);
  });

  it('turns itself off after 12 hours without use; use restarts the clock', () => {
    const storage = memoryStorage();
    setClassMode(storage, true, T0);
    expect(classModeOn(storage, T0 + CLASS_MODE_IDLE_MS)).toBe(true);
    touchClassMode(storage, T0 + CLASS_MODE_IDLE_MS - 1);
    expect(classModeOn(storage, T0 + CLASS_MODE_IDLE_MS + 60_000)).toBe(true);
    expect(classModeOn(storage, T0 + 2 * CLASS_MODE_IDLE_MS)).toBe(false);
    expect(storage.map.has(CLASS_MODE_KEY)).toBe(false);
  });

  it('refreshes the clock at most once a minute, and never brings back an expired session', () => {
    const storage = memoryStorage();
    setClassMode(storage, true, T0);
    touchClassMode(storage, T0 + CLASS_MODE_TOUCH_MS - 1);
    expect(JSON.parse(storage.map.get(CLASS_MODE_KEY)!).lastActive).toBe(T0);
    touchClassMode(storage, T0 + CLASS_MODE_TOUCH_MS);
    expect(JSON.parse(storage.map.get(CLASS_MODE_KEY)!).lastActive).toBe(T0 + CLASS_MODE_TOUCH_MS);
    touchClassMode(storage, T0 + 3 * CLASS_MODE_IDLE_MS);
    expect(classModeOn(storage, T0 + 3 * CLASS_MODE_IDLE_MS)).toBe(false);
  });

  it('reads anything malformed as off, and a clock from the future as expired', () => {
    const storage = memoryStorage();
    storage.setItem(CLASS_MODE_KEY, '{not json');
    expect(classModeOn(storage, T0)).toBe(false);
    storage.setItem(CLASS_MODE_KEY, JSON.stringify({ on: 'yes', lastActive: T0 }));
    expect(classModeOn(storage, T0)).toBe(false);
    storage.setItem(CLASS_MODE_KEY, JSON.stringify({ on: true, lastActive: T0 + 10 * CLASS_MODE_IDLE_MS }));
    expect(classModeOn(storage, T0)).toBe(false);
    storage.setItem(RECENT_KEY, JSON.stringify(['CH-001', 7, null, 'CH-002']));
    expect(readRecent(storage)).toEqual(['CH-001', 'CH-002']);
  });

  it('a storage that refuses writes leaves it off rather than failing', () => {
    const storage = { getItem: () => null, setItem: () => { throw new Error('quota'); }, removeItem: () => { throw new Error('quota'); } };
    expect(() => setClassMode(storage, true, T0)).not.toThrow();
    expect(classModeOn(storage, T0)).toBe(false);
  });
});
