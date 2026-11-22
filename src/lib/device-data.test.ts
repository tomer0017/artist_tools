import { beforeEach, describe, expect, it } from 'vitest';
import { clearDeviceWork } from './device-data';
import { PLAYGROUND_KEYS } from './learn/roulette';
import { TIMER_KEY } from './learn/timer';
import { FILTERS_KEY } from './learn/pick';

describe('clearing this device’s work', () => {
  beforeEach(() => localStorage.clear());

  it('also removes the saved challenge ideas, the idea on screen, the last spins and the drawing timer', () => {
    for (const key of [...Object.values(PLAYGROUND_KEYS), TIMER_KEY]) localStorage.setItem(key, '"x"');
    localStorage.setItem(FILTERS_KEY, '{}');
    localStorage.setItem('theme', 'dark');
    clearDeviceWork();
    for (const key of [...Object.values(PLAYGROUND_KEYS), TIMER_KEY]) expect(localStorage.getItem(key)).toBeNull();
    // Preferences that are not anyone's work stay, as before.
    expect(localStorage.getItem(FILTERS_KEY)).toBe('{}');
    expect(localStorage.getItem('theme')).toBe('dark');
  });
});
