import { describe, expect, it } from 'vitest';
import { clockText, elapsedOf, isUp, pauseTimer, readTimer, remainingOf, resumeTimer, startTimer } from './timer';

const T0 = Date.UTC(2026, 10, 22, 9, 0, 0);
const min = (n: number) => n * 60_000;

describe('the drawing timer', () => {
  it('a countdown is worked out from the clock: right after any gap, however long', () => {
    const t = startTimer('CH-101', 10, T0);
    expect(remainingOf(t, T0)).toBe(min(10));
    expect(clockText(remainingOf(t, T0)!, true)).toBe('10:00');
    // Four minutes later (the screen was off, the tab asleep: nothing ran meanwhile).
    expect(remainingOf(t, T0 + min(4))).toBe(min(6));
    expect(isUp(t, T0 + min(4))).toBe(false);
    // Three hours later, the browser closed and opened again: up, and over by the right amount.
    expect(isUp(t, T0 + min(180))).toBe(true);
    expect(remainingOf(t, T0 + min(180))).toBe(-min(170));
    expect(elapsedOf(t, T0 + min(180))).toBe(min(180));
  });

  it('pauses and resumes: time paused never counts, however long the pause', () => {
    let t = startTimer('CH-101', 30, T0);
    t = pauseTimer(t, T0 + min(5));
    expect(elapsedOf(t, T0 + min(5))).toBe(min(5));
    // Paused overnight: still five minutes in.
    expect(elapsedOf(t, T0 + min(600))).toBe(min(5));
    expect(pauseTimer(t, T0 + min(700))).toBe(t);
    t = resumeTimer(t, T0 + min(600));
    expect(elapsedOf(t, T0 + min(601))).toBe(min(6));
    expect(resumeTimer(t, T0 + min(602))).toBe(t);
    t = resumeTimer(pauseTimer(t, T0 + min(610)), T0 + min(615));
    // 5 before the night, 1 after it, 9 until the second pause, 5 after it: 20 minutes of drawing.
    expect(elapsedOf(t, T0 + min(620))).toBe(min(20));
    expect(remainingOf(t, T0 + min(620))).toBe(min(10));
  });

  it('the stopwatch only counts up; a clock that goes back never gives negative time', () => {
    const t = startTimer('CH-101', 'stopwatch', T0);
    expect(remainingOf(t, T0 + min(90))).toBeNull();
    expect(isUp(t, T0 + min(24 * 60))).toBe(false);
    expect(clockText(elapsedOf(t, T0 + min(61) + 5_400))).toBe('1:01:05');
    expect(elapsedOf(t, T0 - min(3))).toBe(0);
    expect(elapsedOf(pauseTimer(t, T0 - min(3)), T0)).toBe(0);
  });

  it('shows minutes and seconds; a countdown rounds up so it starts on its full time', () => {
    expect(clockText(0)).toBe('0:00');
    expect(clockText(59_999)).toBe('0:59');
    expect(clockText(59_001, true)).toBe('1:00');
    expect(clockText(min(60), true)).toBe('1:00:00');
    expect(clockText(-5_000, true)).toBe('0:00');
  });

  it('reads back only a well-formed timer from this browser', () => {
    const t = startTimer('CH-101', 60, T0);
    expect(readTimer(JSON.parse(JSON.stringify(t)))).toEqual(t);
    expect(readTimer(JSON.parse(JSON.stringify(pauseTimer(t, T0 + 1000))))).toEqual(pauseTimer(t, T0 + 1000));
    expect(readTimer(startTimer('CH-101', 'stopwatch', T0))).toEqual(startTimer('CH-101', 'stopwatch', T0));
    for (const bad of [
      null,
      'timer',
      { ...t, v: 2 },
      { ...t, challengeId: 'D-HAND-01' },
      { ...t, target: 123 },
      { ...t, startedAt: -1 },
      { ...t, startedAt: Number.NaN },
      { ...t, paused: -5 },
      { ...t, pausedAt: T0 - 1 },
      { ...t, pausedAt: '1' },
    ])
      expect(readTimer(bad)).toBeNull();
  });
});
