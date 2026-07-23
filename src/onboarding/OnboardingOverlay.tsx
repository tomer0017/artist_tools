import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronRight, X } from 'lucide-react';
import { useOnboarding } from './onboardingContext';
import { ONBOARDING } from './onboardingConfig';
import { PreviewFrameCard } from './PreviewArt';
import type { PreviewFrame, TourStep } from './onboardingTypes';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

// A tour target may be present in more than one layout (e.g. a control that
// exists in both the desktop sidebar and a mobile sheet). Pick the one that is
// actually on screen so the spotlight lands on what the user can see.
function findVisibleTarget(target: string): HTMLElement | null {
  const nodes = document.querySelectorAll<HTMLElement>(`[data-onboarding="${target}"]`);
  let fallback: HTMLElement | null = null;
  for (const el of nodes) {
    const r = el.getBoundingClientRect();
    const onScreen =
      r.width > 0 && r.height > 0 && r.bottom > 0 && r.right > 0 &&
      r.top < window.innerHeight && r.left < window.innerWidth;
    if (onScreen && el.offsetParent !== null) return el;
    if (!fallback && r.width > 0 && r.height > 0) fallback = el;
  }
  return fallback;
}

interface Rect { top: number; left: number; width: number; height: number }

// Tracks a target element's viewport rect, re-measuring every frame while the
// tour is open. A cheap rAF loop (only alive during the tour) keeps the
// spotlight glued to the element through scrolling, bottom-sheet animations and
// any other layout change — no ResizeObservers to wire up per target.
function useTrackedRect(target: string | undefined, active: boolean): Rect | null {
  const [rect, setRect] = useState<Rect | null>(null);

  useEffect(() => {
    if (!active || !target) {
      setRect(null);
      return;
    }
    let raf = 0;
    let lastKey = '';
    const tick = () => {
      const el = findVisibleTarget(target);
      if (el) {
        const r = el.getBoundingClientRect();
        const key = `${Math.round(r.top)}|${Math.round(r.left)}|${Math.round(r.width)}|${Math.round(r.height)}`;
        if (key !== lastKey) {
          lastKey = key;
          setRect({ top: r.top, left: r.left, width: r.width, height: r.height });
        }
      } else if (lastKey !== 'none') {
        lastKey = 'none';
        setRect(null);
      }
      raf = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(raf);
  }, [target, active]);

  return rect;
}

// ─── Preview phase ─────────────────────────────────────────────────────────────

function PreviewPanel({
  title,
  tagline,
  frames,
  hasTour,
  onStart,
  onSkip,
  reduced,
}: {
  title: string;
  tagline: string;
  frames: PreviewFrame[];
  hasTour: boolean;
  onStart: () => void;
  onSkip: () => void;
  reduced: boolean;
}) {
  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onSkip} aria-hidden="true" />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="onboarding-preview-title"
        className={`relative z-10 w-full max-w-xl overflow-hidden rounded-2xl border border-border bg-card shadow-2xl ${
          reduced ? '' : 'animate-slide-up'
        }`}
      >
        <button
          onClick={onSkip}
          className="absolute right-3 top-3 z-10 flex h-8 w-8 items-center justify-center rounded-full bg-secondary/80 text-muted-foreground transition-colors hover:text-foreground"
          aria-label="Close"
        >
          <X className="h-4 w-4" />
        </button>

        <div className="px-6 pt-6">
          <h2 id="onboarding-preview-title" className="text-lg font-semibold text-foreground">
            {title}
          </h2>
          <p className="mt-1 text-sm leading-snug text-muted-foreground">{tagline}</p>
        </div>

        {/* The outcome, shown before any control. */}
        <div className="px-6 py-5">
          <div className="flex items-stretch justify-center gap-1.5 overflow-x-auto pb-1">
            {frames.map((frame, i) => (
              <div key={i} className="flex items-center gap-1.5">
                <div className="w-[4.5rem] shrink-0 sm:w-24">
                  <PreviewFrameCard frame={frame} />
                </div>
                {i < frames.length - 1 && (
                  <ChevronRight className="h-4 w-4 shrink-0 self-start text-muted-foreground/60" style={{ marginTop: '2.25rem' }} />
                )}
              </div>
            ))}
          </div>
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-border px-6 py-4">
          <button onClick={onSkip} className="text-sm font-medium text-muted-foreground transition-colors hover:text-foreground">
            Skip
          </button>
          <button
            onClick={onStart}
            className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground shadow-sm transition-transform active:scale-95"
          >
            {hasTour ? 'Show me how' : 'Got it'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Tour phase (spotlight) ─────────────────────────────────────────────────────

const PAD = 8; // breathing room around a highlighted element
const GAP = 12; // distance from element to the tooltip card

function TourLayer({
  steps,
  step,
  onNext,
  onPrev,
  onClose,
  reduced,
}: {
  steps: TourStep[];
  step: number;
  onNext: () => void;
  onPrev: () => void;
  onClose: () => void;
  reduced: boolean;
}) {
  const current = steps[step];
  const rect = useTrackedRect(current?.target, true);
  const cardRef = useRef<HTMLDivElement>(null);
  const [cardSize, setCardSize] = useState({ w: 300, h: 150 });
  const [viewport, setViewport] = useState({ w: window.innerWidth, h: window.innerHeight });

  useEffect(() => {
    const onResize = () => setViewport({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // Measure the card so it can be positioned without overflowing the viewport.
  useLayoutEffect(() => {
    if (cardRef.current) {
      const r = cardRef.current.getBoundingClientRect();
      setCardSize({ w: r.width, h: r.height });
    }
  }, [step, current?.title, current?.body, viewport.w]);

  // Bring the highlighted element into view when a step opens.
  useEffect(() => {
    if (!current?.target) return;
    const el = findVisibleTarget(current.target);
    el?.scrollIntoView({ block: 'center', inline: 'center', behavior: reduced ? 'auto' : 'smooth' });
  }, [step, current?.target, reduced]);

  // Focus the card for keyboard users.
  useEffect(() => {
    cardRef.current?.focus();
  }, [step]);

  const hole = useMemo(
    () =>
      rect
        ? {
            top: Math.max(0, rect.top - PAD),
            left: Math.max(0, rect.left - PAD),
            width: rect.width + PAD * 2,
            height: rect.height + PAD * 2,
          }
        : null,
    [rect],
  );

  // Card placement: centered when there is no target; otherwise below the hole,
  // flipping above when there isn't room, always clamped inside the viewport.
  const cardPos = useMemo(() => {
    if (!hole) {
      return {
        left: (viewport.w - cardSize.w) / 2,
        top: (viewport.h - cardSize.h) / 2,
      };
    }
    const belowTop = hole.top + hole.height + GAP;
    const aboveTop = hole.top - GAP - cardSize.h;
    let top = belowTop;
    if (belowTop + cardSize.h > viewport.h - 8 && aboveTop >= 8) top = aboveTop;
    top = Math.min(Math.max(8, top), Math.max(8, viewport.h - cardSize.h - 8));
    let left = hole.left + hole.width / 2 - cardSize.w / 2;
    left = Math.min(Math.max(8, left), Math.max(8, viewport.w - cardSize.w - 8));
    return { left, top };
  }, [hole, cardSize.w, cardSize.h, viewport.w, viewport.h]);

  const isLast = step >= steps.length - 1;
  const maskId = 'onboarding-spotlight-mask';
  const transition = reduced ? 'none' : 'all 220ms cubic-bezier(0.22, 1, 0.36, 1)';

  return (
    <div className="fixed inset-0 z-[120]" role="dialog" aria-modal="true" aria-label="Guided tour">
      {/* Dimming with a soft cut-out around the active element. */}
      <svg width={viewport.w} height={viewport.h} className="absolute inset-0" aria-hidden="true">
        <defs>
          <mask id={maskId}>
            <rect x="0" y="0" width={viewport.w} height={viewport.h} fill="white" />
            {hole && (
              <rect
                x={hole.left}
                y={hole.top}
                width={hole.width}
                height={hole.height}
                rx="10"
                fill="black"
                style={{ transition }}
              />
            )}
          </mask>
        </defs>
        <rect x="0" y="0" width={viewport.w} height={viewport.h} fill="rgba(0,0,0,0.66)" mask={`url(#${maskId})`} />
      </svg>

      {/* Highlight ring. */}
      {hole && (
        <div
          className="pointer-events-none absolute rounded-[10px] ring-2 ring-primary"
          style={{ top: hole.top, left: hole.left, width: hole.width, height: hole.height, transition }}
        />
      )}

      {/* Tooltip card. */}
      <div
        ref={cardRef}
        tabIndex={-1}
        className={`absolute w-[300px] max-w-[calc(100vw-16px)] rounded-xl border border-border bg-card p-4 shadow-2xl outline-none ${
          reduced ? '' : 'animate-fade-in'
        }`}
        style={{ top: cardPos.top, left: cardPos.left, transition }}
      >
        <div className="mb-1 flex items-center justify-between">
          <span className="text-[11px] font-medium tabular-nums text-muted-foreground">
            {step + 1} / {steps.length}
          </span>
          <button onClick={onClose} className="text-muted-foreground transition-colors hover:text-foreground" aria-label="End tour">
            <X className="h-4 w-4" />
          </button>
        </div>
        <h3 className="text-sm font-semibold text-foreground">{current?.title}</h3>
        <p className="mt-1 text-[13px] leading-snug text-muted-foreground">{current?.body}</p>

        <div className="mt-3 flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            {steps.map((_, i) => (
              <span
                key={i}
                className={`h-1.5 rounded-full transition-all ${i === step ? 'w-4 bg-primary' : 'w-1.5 bg-border'}`}
              />
            ))}
          </div>
          <div className="flex items-center gap-2">
            {step > 0 && (
              <button
                onClick={onPrev}
                className="rounded-md px-2.5 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
              >
                Back
              </button>
            )}
            <button
              onClick={onNext}
              className="rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground transition-transform active:scale-95"
            >
              {isLast ? 'Done' : 'Next'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Root overlay ────────────────────────────────────────────────────────────

export default function OnboardingOverlay() {
  const { toolId, phase, step, isOpen, beginTour, next, prev, close } = useOnboarding();
  const reduced = useMemo(prefersReducedMotion, []);

  const config = toolId ? ONBOARDING[toolId] : undefined;
  const inTour = phase === 'tour';

  // Keyboard navigation: Esc closes; arrows / Enter drive the flow.
  const handleKey = useCallback(
    (e: KeyboardEvent) => {
      if (!isOpen) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        close();
      } else if (e.key === 'ArrowLeft') {
        if (inTour) prev();
      } else if (e.key === 'ArrowRight' || e.key === 'Enter') {
        e.preventDefault();
        if (inTour) next();
        else beginTour();
      }
    },
    [isOpen, inTour, close, next, prev, beginTour],
  );

  useEffect(() => {
    if (!isOpen) return;
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [isOpen, handleKey]);

  if (!isOpen || !config) return null;

  const node =
    phase === 'preview' ? (
      <PreviewPanel
        title={config.title}
        tagline={config.tagline}
        frames={config.preview}
        hasTour={config.steps.length > 0}
        onStart={config.steps.length > 0 ? beginTour : close}
        onSkip={close}
        reduced={reduced}
      />
    ) : (
      <TourLayer steps={config.steps} step={step} onNext={next} onPrev={prev} onClose={close} reduced={reduced} />
    );

  return createPortal(node, document.body);
}
