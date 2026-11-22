import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslations } from 'use-intl';
import { Pause, Play, RotateCcw, Timer, X } from 'lucide-react';
import { TIMER_KEY, TIMER_MINUTES, clockText, elapsedOf, isUp, pauseTimer, readTimer, remainingOf, resumeTimer, startTimer, type TimerChoice, type TimerState } from '@/lib/learn/timer';
import { buttonSecondary, chip } from './parts';

// Challenges V2 · the optional timer (ADR-0021). Off until asked for. It is a
// drawing session kept in this browser as wall-clock timestamps: what it
// shows is worked out from the clock whenever the page is looked at, so it is
// right after a locked phone, a sleeping tab or a closed browser. The tick
// below only repaints the digits. Nothing rings and nothing is asked: when
// the time is up, a kind word, and the person can keep drawing.

function readStored(): TimerState | null {
  try {
    return readTimer(JSON.parse(localStorage.getItem(TIMER_KEY) ?? 'null'));
  } catch {
    return null;
  }
}

/** The timer session of this browser, kept in step with other tabs. */
export function useTimerSession(): [TimerState | null, (next: TimerState | null) => void] {
  const [session, setSession] = useState<TimerState | null>(() => (typeof window === 'undefined' ? null : readStored()));
  useEffect(() => {
    const sync = (event: StorageEvent) => {
      if (event.key === TIMER_KEY || event.key === null) setSession(readStored());
    };
    window.addEventListener('storage', sync);
    return () => window.removeEventListener('storage', sync);
  }, []);
  const save = useCallback((next: TimerState | null) => {
    setSession(next);
    try {
      if (next) localStorage.setItem(TIMER_KEY, JSON.stringify(next));
      else localStorage.removeItem(TIMER_KEY);
    } catch {
      // Private browsing: the timer still works while the page is open.
    }
  }, []);
  return [session, save];
}

/** Now, worked out again every second while running (only to repaint) and at once whenever the page is shown or focused again. */
function useNow(ticking: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const update = () => setNow(Date.now());
    update();
    document.addEventListener('visibilitychange', update);
    window.addEventListener('focus', update);
    window.addEventListener('pageshow', update);
    const tick = ticking ? window.setInterval(update, 1000) : undefined;
    return () => {
      document.removeEventListener('visibilitychange', update);
      window.removeEventListener('focus', update);
      window.removeEventListener('pageshow', update);
      if (tick !== undefined) window.clearInterval(tick);
    };
  }, [ticking]);
  return now;
}

export function ChallengeTimer({ session, onChange, challengeId }: { session: TimerState | null; onChange: (next: TimerState | null) => void; challengeId: string }) {
  const t = useTranslations('learn.timer');
  const [choosing, setChoosing] = useState(false);
  const [said, setSaid] = useState('');
  const running = session !== null && session.pausedAt === null;
  const now = useNow(running);
  const up = session !== null && isUp(session, now);
  // "Time's up" is said once, when it happens on screen (or is found on coming back).
  const wasUp = useRef(up);
  useEffect(() => {
    if (up && !wasUp.current) setSaid(t('up'));
    wasUp.current = up;
  }, [up, t]);

  const start = (choice: TimerChoice) => {
    const next = startTimer(challengeId, choice, Date.now());
    onChange(next);
    setChoosing(false);
    setSaid(choice === 'stopwatch' ? t('startedStopwatch') : t('started', { minutes: choice }));
  };

  if (!session) {
    return (
      <div className="mt-5 border-t border-border pt-4" data-timer="off">
        {!choosing ? (
          <button type="button" onClick={() => setChoosing(true)} className={chip} data-timer-add>
            <Timer className="h-4 w-4 text-primary" aria-hidden="true" /> {t('add')}
          </button>
        ) : (
          <fieldset>
            <legend className="text-sm font-semibold text-foreground">{t('choose')}</legend>
            <p className="mt-1 text-sm text-foreground/90">{t('lead')}</p>
            <div className="mt-3 flex flex-wrap gap-2">
              {[...TIMER_MINUTES, 'stopwatch' as const].map((choice) => (
                <button key={choice} type="button" onClick={() => start(choice)} className={chip} data-timer-choice={choice}>
                  {choice === 'stopwatch' ? t('stopwatch') : t('minutes', { minutes: choice })}
                </button>
              ))}
              <button type="button" onClick={() => setChoosing(false)} className={chip} aria-label={t('cancel')} data-timer-cancel>
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
          </fieldset>
        )}
        <p aria-live="polite" className="sr-only">
          {said}
        </p>
      </div>
    );
  }

  const paused = session.pausedAt !== null;
  const remaining = remainingOf(session, now);
  const elapsed = elapsedOf(session, now);
  const countdown = remaining !== null;
  const shown = countdown && !up ? clockText(remaining, true) : clockText(elapsed);
  const progress = countdown && session.target ? Math.min(1, elapsed / session.target) : null;

  return (
    <div className="mt-5 border-t border-border pt-4" data-timer={up ? 'up' : paused ? 'paused' : 'running'} data-timer-kind={countdown ? 'countdown' : 'stopwatch'}>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-foreground/90">
            {up ? t('drewFor') : countdown ? t('left') : t('drawingTime')}
            {paused && !up ? ` · ${t('paused')}` : ''}
          </p>
          <p className="font-semibold tabular-nums text-foreground [font-size:clamp(2.25rem,9vw,3rem)] leading-none" data-timer-clock>
            {shown}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {!up && (
            <button type="button" onClick={() => {
              onChange(paused ? resumeTimer(session, Date.now()) : pauseTimer(session, Date.now()));
              setSaid(paused ? t('resumed') : t('pausedSaid'));
            }} className={buttonSecondary} data-timer-toggle={paused ? 'resume' : 'pause'}>
              {paused ? <Play className="h-5 w-5" aria-hidden="true" /> : <Pause className="h-5 w-5" aria-hidden="true" />}
              {paused ? t('resume') : t('pause')}
            </button>
          )}
          <button type="button" onClick={() => {
            onChange(null);
            setSaid(t('closed'));
          }} className={buttonSecondary} data-timer-reset>
            {up ? <X className="h-5 w-5" aria-hidden="true" /> : <RotateCcw className="h-5 w-5" aria-hidden="true" />}
            {up ? t('close') : t('reset')}
          </button>
        </div>
      </div>
      {progress !== null && !up && (
        <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-secondary" aria-hidden="true">
          <div className="h-full rounded-full bg-primary transition-[width] duration-700 ease-linear motion-reduce:transition-none" style={{ width: `${progress * 100}%` }} />
        </div>
      )}
      {up && (
        <p className="mt-3 rounded-xl bg-primary/10 px-4 py-3 text-[15px] leading-relaxed text-foreground" data-timer-up-note>
          {t('upNote')}
        </p>
      )}
      <p aria-live="polite" className="sr-only">
        {said}
      </p>
    </div>
  );
}
