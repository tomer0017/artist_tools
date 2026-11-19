import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'use-intl';
import { Users } from 'lucide-react';
import { CLASS_MODE_TOUCH_MS, classModeOn, readRecent, setClassMode, touchClassMode, writeRecent } from '@/lib/learn/class-mode';
import { rememberSeen } from '@/lib/learn/pick';

// Class mode in the studio (ADR-0018, S7): read from this tab's storage, so
// it survives moving between Learn and the tools and ends with the tab. While
// it is on, Learn never asks for or writes the person's history.

interface ClassModeState {
  on: boolean;
  setOn: (on: boolean) => void;
  /** Challenges shown recently in this tab, most recent first. */
  recent: string[];
  /** Remember that a challenge was shown here (Random and "Another one" avoid repeats). */
  seen: (id: string) => void;
}

const ClassModeContext = createContext<ClassModeState | null>(null);

const tabStorage = () => {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
};

export function ClassModeProvider({ children }: { children: React.ReactNode }) {
  const [on, setOnState] = useState(() => {
    const storage = tabStorage();
    return storage ? classModeOn(storage) : false;
  });
  const [recent, setRecent] = useState<string[]>(() => {
    const storage = tabStorage();
    return storage ? readRecent(storage) : [];
  });

  const setOn = useCallback((next: boolean) => {
    const storage = tabStorage();
    if (storage) setClassMode(storage, next);
    setOnState(next);
    if (!next) setRecent([]);
  }, []);

  // Coming back after a long pause: past 12 idle hours it is off by itself.
  // Using Learn restarts the idle clock (at most once a minute).
  useEffect(() => {
    const storage = tabStorage();
    if (!storage) return;
    const check = () => setOnState(classModeOn(storage));
    let last = 0;
    const touch = () => {
      const now = Date.now();
      if (now - last < CLASS_MODE_TOUCH_MS) return;
      last = now;
      if (classModeOn(storage, now)) touchClassMode(storage, now);
      else setOnState(false);
    };
    document.addEventListener('visibilitychange', check);
    window.addEventListener('pointerdown', touch, { passive: true });
    window.addEventListener('keydown', touch);
    return () => {
      document.removeEventListener('visibilitychange', check);
      window.removeEventListener('pointerdown', touch);
      window.removeEventListener('keydown', touch);
    };
  }, []);

  const seen = useCallback((id: string) => {
    setRecent((current) => {
      const next = rememberSeen(current, id);
      const storage = tabStorage();
      if (storage) writeRecent(storage, next);
      return next;
    });
  }, []);

  const value = useMemo(() => ({ on, setOn, recent, seen }), [on, setOn, recent, seen]);
  return <ClassModeContext.Provider value={value}>{children}</ClassModeContext.Provider>;
}

export function useClassMode(): ClassModeState {
  const state = useContext(ClassModeContext);
  if (!state) throw new Error('useClassMode must be inside ClassModeProvider');
  return state;
}

/** The switch on the Learn home: "Class mode — nothing you do is saved to your account." */
export function ClassModeSwitch() {
  const t = useTranslations('learn.classMode');
  const { on, setOn } = useClassMode();
  return (
    <div className={`flex items-center gap-3 rounded-2xl border px-4 py-3 ${on ? 'border-primary/50 bg-primary/10' : 'border-border bg-card'}`}>
      <Users className="h-5 w-5 shrink-0 text-primary" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <p id="class-mode-label" className="text-sm font-semibold text-foreground">
          {t('label')}
        </p>
        <p id="class-mode-description" className="text-xs leading-snug text-muted-foreground">
          {t('description')}
        </p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-labelledby="class-mode-label"
        aria-describedby="class-mode-description"
        onClick={() => setOn(!on)}
        data-class-mode-switch
        className={`relative inline-flex h-8 w-14 shrink-0 items-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background ${
          on ? 'bg-primary' : 'bg-secondary ring-1 ring-inset ring-border'
        }`}
      >
        <span
          aria-hidden="true"
          className={`absolute top-1 h-6 w-6 rounded-full bg-background shadow transition-[inset-inline-start] ${on ? 'start-7' : 'start-1'}`}
        />
      </button>
    </div>
  );
}

/** While class mode is on, every Learn screen says so, with a way to turn it off. */
export function ClassModeBanner() {
  const t = useTranslations('learn.classMode');
  const { on, setOn } = useClassMode();
  if (!on) return null;
  return (
    <div role="status" data-class-mode-banner className="mb-4 flex items-center gap-3 rounded-xl border border-primary/40 bg-primary/10 px-3 py-2 text-sm text-foreground">
      <Users className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
      <p className="min-w-0 flex-1 leading-snug">{t('on')}</p>
      <button
        type="button"
        onClick={() => setOn(false)}
        className="min-h-[36px] shrink-0 rounded-lg px-2 text-sm font-semibold text-primary underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {t('turnOff')}
      </button>
    </div>
  );
}
