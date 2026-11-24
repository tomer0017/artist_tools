import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocale, useTranslations } from 'use-intl';
import { Sketchy, type SketchyHandle } from './Sketchy';
import { stageOnScreen, useCompanionEvents, useReducedMotion, type CompanionEvent } from './state';

// A moment of joy away from Home (ADR-0024): after a save in a tool, or a
// lesson or challenge marked as completed, Sketchy pops up in the corner,
// celebrates for two or three seconds and goes. It never takes a tap (no
// pointer events), never covers the navigation bar, says what happened once
// to screen readers, and stays still for people who ask for less motion.

const SHOW_MS = 3000;

export function Celebration({ enabled, celebrate, jump }: { enabled: boolean; celebrate: boolean; jump: boolean }) {
  const t = useTranslations('companion.celebrate');
  const rtl = useLocale() === 'he';
  const reduced = useReducedMotion();
  const [shown, setShown] = useState<{ text: string; at: number } | null>(null);
  const fox = useRef<SketchyHandle>(null);
  const timer = useRef(0);

  const onEvent = useCallback(
    (event: CompanionEvent) => {
      if (!enabled || stageOnScreen()) return;
      const text = event.type === 'saved' ? t('saved') : event.kind === 'lesson' ? t('lesson') : t('challenge');
      window.clearTimeout(timer.current);
      setShown({ text, at: Date.now() });
      timer.current = window.setTimeout(() => setShown(null), SHOW_MS);
    },
    [enabled, t],
  );
  useCompanionEvents(onEvent);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  useEffect(() => {
    if (!shown) return;
    const id = window.requestAnimationFrame(() => fox.current?.play(celebrate ? 'celebrate' : jump ? 'jump' : 'wave', { restart: true }));
    return () => window.cancelAnimationFrame(id);
  }, [shown, celebrate, jump]);

  if (!shown) return null;
  return (
    <div
      className="pointer-events-none fixed z-[45] flex items-end gap-2 animate-in fade-in-0 slide-in-from-bottom-4 duration-300 motion-reduce:animate-none"
      style={{ bottom: 'calc(env(safe-area-inset-bottom) + 84px)', [rtl ? 'left' : 'right']: 12 }}
      data-sketchy-celebration
    >
      <p role="status" className="mb-14 rounded-2xl border-[3px] border-[#8b5a2b] bg-[#f7ecd6] px-3 py-2 text-sm font-semibold text-[#3b2416] shadow-lg">
        {shown.text}
      </p>
      <Sketchy ref={fox} height={96} facing={rtl ? 'right' : 'left'} reducedMotion={reduced} initial={reduced ? 'celebrate' : 'idle'} />
    </div>
  );
}
