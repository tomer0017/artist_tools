import { useEffect, useId } from 'react';
import { Check } from 'lucide-react';

/**
 * Step 3 of the redesigned Measure onboarding — the payoff. The instant a scale
 * is first set, this celebratory card animates in to confirm, in plain language,
 * what the painter just unlocked: every line now reads a true real-world size.
 * It carries the meaning visually (a reference line resolving into a checked
 * "real size") and auto-dismisses so it never blocks the workflow.
 */
export default function MeasureScaleSuccess({
  open,
  sizeLabel,
  onDone,
  autoDismissMs = 2800,
}: {
  open: boolean;
  /** The scale the painter entered, e.g. "80 cm" — makes the confirmation concrete. */
  sizeLabel?: string;
  onDone: () => void;
  autoDismissMs?: number;
}) {
  const uid = useId().replace(/[:]/g, '');

  useEffect(() => {
    if (!open) return;
    const t = window.setTimeout(onDone, autoDismissMs);
    return () => window.clearTimeout(t);
  }, [open, autoDismissMs, onDone]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center px-6 pointer-events-none">
      <div onClick={onDone}
        className="pointer-events-auto w-full max-w-xs rounded-3xl border border-border bg-card shadow-2xl animate-slide-up">
        <style>{`
          @keyframes ${uid}-pop { 0%{transform:scale(.4);opacity:0} 60%{transform:scale(1.08)} 100%{transform:scale(1);opacity:1} }
          @keyframes ${uid}-draw { to { stroke-dashoffset: 0 } }
          @keyframes ${uid}-fade { 0%,40%{opacity:0} 100%{opacity:1} }
          .${uid}-badge{animation:${uid}-pop .5s cubic-bezier(.2,.8,.2,1) both}
          .${uid}-line{stroke-dasharray:100;stroke-dashoffset:100;animation:${uid}-draw .5s ease-out .15s forwards}
          .${uid}-tag{opacity:0;animation:${uid}-fade .6s ease-out .35s forwards}
          @media (prefers-reduced-motion: reduce){
            .${uid}-badge,.${uid}-line,.${uid}-tag{animation:none;opacity:1}
            .${uid}-line{stroke-dashoffset:0}
          }
        `}</style>

        <div className="flex flex-col items-center gap-3 p-6 text-center">
          {/* Reference line resolving into a confirmed real size */}
          <svg viewBox="0 0 160 44" className="w-40" aria-hidden="true">
            <line className={`${uid}-line`} pathLength={100} x1="12" y1="22" x2="92" y2="22"
              stroke="hsl(var(--primary))" strokeWidth="4" strokeLinecap="round" />
            <circle cx="12" cy="22" r="4" fill="hsl(var(--primary))" />
            <circle cx="92" cy="22" r="4" fill="hsl(var(--primary))" />
            <g className={`${uid}-tag`}>
              <rect x="104" y="10" width="48" height="24" rx="12" fill="hsl(var(--primary))" />
              <text x="128" y="26" textAnchor="middle" fontSize="13" fontWeight="700"
                fill="hsl(var(--primary-foreground))">{sizeLabel || 'real'}</text>
            </g>
          </svg>

          <div className={`${uid}-badge flex h-12 w-12 items-center justify-center rounded-full bg-primary text-primary-foreground`}>
            <Check className="h-6 w-6" strokeWidth={3} />
          </div>

          <div className="space-y-1">
            <div className="text-base font-bold text-foreground">
              {sizeLabel ? `Scale set — ${sizeLabel}` : 'Scale set'}
            </div>
            <p className="text-sm leading-relaxed text-muted-foreground">
              Every line you draw now measures the real thing.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
