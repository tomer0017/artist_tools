import { CHALLENGE_ID } from './model';

// ─── Challenges V2: the drawing timer (ADR-0021) ─────────────────────────────
// Off until someone asks for it. Its state is a few wall-clock timestamps
// kept in this browser, never a counter that has to keep running: the time
// shown is always worked out from the clock, so it is right after the screen
// turns off, the phone locks, the tab sleeps or the browser is closed and
// opened again. Nothing runs in the background and nothing rings; when the
// time is up, the screen says so kindly the next time it is looked at, and
// the person can keep drawing.

export const TIMER_KEY = 'studio-challenge-timer';
/** The countdowns offered, in minutes (the stopwatch is the open-ended choice). */
export const TIMER_MINUTES = [10, 30, 60] as const;
export type TimerChoice = (typeof TIMER_MINUTES)[number] | 'stopwatch';

export interface TimerState {
  v: 1;
  challengeId: string;
  /** A countdown's length in ms; null for the stopwatch. */
  target: number | null;
  /** When it started, in ms since the epoch. */
  startedAt: number;
  /** While paused: when the pause began. */
  pausedAt: number | null;
  /** The time spent in earlier pauses, in ms. */
  paused: number;
}

export function startTimer(challengeId: string, choice: TimerChoice, now: number): TimerState {
  return { v: 1, challengeId, target: choice === 'stopwatch' ? null : choice * 60_000, startedAt: now, pausedAt: null, paused: 0 };
}

export const pauseTimer = (state: TimerState, now: number): TimerState => (state.pausedAt !== null ? state : { ...state, pausedAt: Math.max(now, state.startedAt) });

export function resumeTimer(state: TimerState, now: number): TimerState {
  if (state.pausedAt === null) return state;
  return { ...state, pausedAt: null, paused: state.paused + Math.max(0, now - state.pausedAt) };
}

/** The drawing time so far: from the start to now (or to the pause), minus the pauses; never below zero, even if the device's clock went back. */
export const elapsedOf = (state: TimerState, now: number): number => Math.max(0, (state.pausedAt ?? now) - state.startedAt - state.paused);

/** A countdown's time left (below zero once it is up); null for the stopwatch. */
export const remainingOf = (state: TimerState, now: number): number | null => (state.target === null ? null : state.target - elapsedOf(state, now));

export const isUp = (state: TimerState, now: number): boolean => state.target !== null && elapsedOf(state, now) >= state.target;

/** A timer read back from this browser: anything malformed or impossible reads as no timer at all. */
export function readTimer(value: unknown): TimerState | null {
  if (typeof value !== 'object' || value === null) return null;
  const v = value as Partial<Record<keyof TimerState, unknown>>;
  const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);
  if (v.v !== 1 || typeof v.challengeId !== 'string' || !CHALLENGE_ID.test(v.challengeId)) return null;
  if (!(v.target === null || (finite(v.target) && TIMER_MINUTES.some((m) => m * 60_000 === v.target)))) return null;
  if (!finite(v.startedAt) || v.startedAt <= 0 || !finite(v.paused) || v.paused < 0) return null;
  if (!(v.pausedAt === null || (finite(v.pausedAt) && v.pausedAt >= v.startedAt))) return null;
  return { v: 1, challengeId: v.challengeId, target: v.target as number | null, startedAt: v.startedAt, pausedAt: v.pausedAt as number | null, paused: v.paused };
}

/** "9:58", "1:02:05": minutes and seconds, hours when there are any (rounded up while counting down, so a countdown starts on its full time). */
export function clockText(ms: number, up = false): string {
  const total = Math.max(0, up ? Math.ceil(ms / 1000) : Math.floor(ms / 1000));
  const [h, m, s] = [Math.floor(total / 3600), Math.floor((total % 3600) / 60), total % 60];
  const two = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${two(m)}:${two(s)}` : `${m}:${two(s)}`;
}
