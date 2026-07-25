import { useCallback, useRef, useState } from 'react';

/**
 * A horizontal slider built for a finger.
 *
 * The native `<input type="range">` this replaces was reliable on a desktop
 * pointer and unreliable under a thumb on iOS Safari: a tap landed, but a drag
 * was routinely stolen by the enclosing scroll container and the value stopped
 * following the finger. Two things fix that, and neither is available from a
 * bare range input:
 *
 *  • `touch-action: pan-y` — the browser keeps vertical scrolling, and every
 *    horizontal gesture is handed to this element instead of being interpreted
 *    as a page pan. Vertical scrolling through the panel still works normally.
 *  • `setPointerCapture` — once the drag starts, the events keep arriving here
 *    even when the finger wanders off the track or past the edge of the
 *    screen. Releasing anywhere ends the drag cleanly, and the next drag starts
 *    immediately.
 *
 * The hit area is a full 44px tall regardless of how thin the drawn track is,
 * and the value updates on every pointermove — never on `change`, never on
 * release.
 */

export interface SliderProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  /** Fired continuously during the drag. */
  onChange: (value: number) => void;
  /** Fired once when the drag ends, for work too expensive to do per frame. */
  onCommit?: (value: number) => void;
  /** Right-hand read-out — a word beats a number for most of these. */
  readout?: string;
  hint?: string;
  disabled?: boolean;
}

const TRACK_HEIGHT = 44; // Apple's minimum comfortable touch target.

export default function Slider({
  label,
  value,
  min,
  max,
  step = 1,
  onChange,
  onCommit,
  readout,
  hint,
  disabled = false,
}: SliderProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);
  const latest = useRef(value);

  const valueFromClientX = useCallback(
    (clientX: number) => {
      const track = trackRef.current;
      if (!track) return value;
      const rect = track.getBoundingClientRect();
      if (rect.width <= 0) return value;
      const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
      const raw = min + ratio * (max - min);
      const snapped = Math.round(raw / step) * step;
      // Re-round to the step's precision so 0.1 steps don't accumulate float dust.
      const decimals = (String(step).split('.')[1] ?? '').length;
      return Number(Math.min(max, Math.max(min, snapped)).toFixed(decimals));
    },
    [max, min, step, value],
  );

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (disabled) return;
    // Capture so that every move and the release belong to us, even if the
    // finger leaves the element entirely. It can throw when the pointer is no
    // longer considered active, and that must not abort the drag — losing
    // capture costs us events outside the track, but refusing to start costs
    // the whole gesture, and "release anywhere, drag again immediately" is the
    // behaviour being fixed here.
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      /* not capturable — carry on without it */
    }
    setDragging(true);
    const next = valueFromClientX(event.clientX);
    latest.current = next;
    onChange(next);
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!dragging || disabled) return;
    // The gesture is ours now, so stop the page from also acting on it. This is
    // safe to call because `touch-action: pan-y` already told the browser that
    // horizontal movement here is not a scroll.
    event.preventDefault();
    const next = valueFromClientX(event.clientX);
    if (next === latest.current) return;
    latest.current = next;
    onChange(next);
  };

  const endDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!dragging) return;
    setDragging(false);
    try {
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
    } catch {
      /* already released */
    }
    onCommit?.(latest.current);
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (disabled) return;
    const big = (max - min) / 10;
    const delta =
      event.key === 'ArrowLeft' || event.key === 'ArrowDown' ? -step
        : event.key === 'ArrowRight' || event.key === 'ArrowUp' ? step
          : event.key === 'PageDown' ? -big
            : event.key === 'PageUp' ? big
              : event.key === 'Home' ? min - value
                : event.key === 'End' ? max - value
                  : 0;
    if (!delta) return;
    event.preventDefault();
    const next = Math.min(max, Math.max(min, value + delta));
    latest.current = next;
    onChange(next);
    onCommit?.(next);
  };

  const percent = max > min ? ((value - min) / (max - min)) * 100 : 0;

  return (
    <div className={disabled ? 'opacity-50' : undefined}>
      <div className="flex items-center justify-between">
        <span className="text-[11px] text-muted-foreground font-medium">{label}</span>
        {readout && (
          <span className="text-[11px] font-semibold text-foreground tabular-nums">{readout}</span>
        )}
      </div>
      <div
        ref={trackRef}
        role="slider"
        aria-label={label}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={value}
        aria-valuetext={readout}
        aria-disabled={disabled || undefined}
        tabIndex={disabled ? -1 : 0}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onKeyDown={handleKeyDown}
        // The drawn track is thin; the *touchable* one is not.
        style={{ height: TRACK_HEIGHT, touchAction: 'pan-y' }}
        className="relative w-full flex items-center cursor-pointer select-none outline-none
                   focus-visible:ring-2 focus-visible:ring-primary/60 rounded-md"
      >
        <div className="absolute inset-x-0 h-1.5 rounded-full bg-secondary" />
        <div
          className="absolute left-0 h-1.5 rounded-full bg-primary pointer-events-none"
          style={{ width: `${percent}%` }}
        />
        <div
          className={`absolute rounded-full bg-primary border-2 border-background shadow
                      pointer-events-none transition-transform ${dragging ? 'scale-125' : ''}`}
          style={{
            width: 20,
            height: 20,
            left: `calc(${percent}% - 10px)`,
          }}
        />
      </div>
      {hint && <p className="text-[9px] text-muted-foreground -mt-1.5">{hint}</p>}
    </div>
  );
}
