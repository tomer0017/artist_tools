import { Hand } from 'lucide-react';

/**
 * A wordless (almost) coach mark that teaches the *gesture* for the very first
 * action — placing the first point of the reference line. A pulsing target says
 * "tap here" far faster than a sentence can, so the painter feels they are
 * already using the tool. Shown only for the first point (one action at a time),
 * then it disappears as the real drawing takes over.
 *
 * Purely decorative: it never intercepts taps (pointer-events-none) and its
 * pulse is disabled for users who prefer reduced motion.
 */
export default function TapCoach({ label = 'Tap to start' }: { label?: string }) {
  return (
    <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center">
      <div className="flex flex-col items-center gap-3">
        <div className="relative h-16 w-16">
          {/* Expanding echo ring — the "tap" signal. */}
          <span className="absolute inset-0 rounded-full bg-primary/25 motion-safe:animate-ping" />
          {/* Solid target with a hand cue. */}
          <span className="absolute inset-0 flex items-center justify-center rounded-full border-2 border-primary/70 bg-card/80 backdrop-blur-sm shadow-lg">
            <Hand className="h-7 w-7 text-primary" />
          </span>
        </div>
        <span className="rounded-full bg-card/85 px-3 py-1 text-xs font-semibold text-foreground shadow backdrop-blur-sm">
          {label}
        </span>
      </div>
    </div>
  );
}
