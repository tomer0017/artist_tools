import { Hand } from 'lucide-react';

/**
 * A (nearly) wordless coach mark that teaches the *gesture* for the very first
 * action — placing the first point of the reference line. A pulsing target says
 * "tap here" far faster than a sentence can.
 *
 * It sits in the middle of the image, so people naturally tap it. That tap must
 * NOT fall through and drop a calibration point under the coach: the target is a
 * real button marked `data-canvas-ui` (the canvas ignores touches that start on
 * such elements) and tapping it only calls `onActivate`, which arms point
 * selection and hides the coach. Only the area *around* the target is
 * click-through. Its pulse is disabled for users who prefer reduced motion.
 */
export default function TapCoach({ label = 'Tap to start', onActivate }: {
  label?: string;
  onActivate: () => void;
}) {
  return (
    <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center">
      <button
        type="button"
        data-canvas-ui
        onMouseDown={(e) => e.stopPropagation()}
        onTouchStart={(e) => e.stopPropagation()}
        onTouchEnd={(e) => e.stopPropagation()}
        onClick={(e) => { e.stopPropagation(); onActivate(); }}
        className="pointer-events-auto flex flex-col items-center gap-3 rounded-2xl p-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span className="relative h-16 w-16">
          {/* Expanding echo ring — the "tap" signal. */}
          <span className="absolute inset-0 rounded-full bg-primary/25 motion-safe:animate-ping" />
          {/* Solid target with a hand cue. */}
          <span className="absolute inset-0 flex items-center justify-center rounded-full border-2 border-primary/70 bg-card/80 shadow-lg backdrop-blur-sm">
            <Hand className="h-7 w-7 text-primary" />
          </span>
        </span>
        <span className="rounded-full bg-card/85 px-3 py-1 text-xs font-semibold text-foreground shadow backdrop-blur-sm">
          {label}
        </span>
      </button>
    </div>
  );
}
