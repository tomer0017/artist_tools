import { useRef } from 'react';
import { useTranslations } from 'use-intl';
import { hsvToHex } from './colorMath';

// The interactive colour wheel: a hue ring around a saturation/brightness
// square. Dragging works as it always has; the ring's handle and the square
// are also sliders for the keyboard (arrows, Shift for steps of 10).
//
// A harmony chosen beside the wheel shows its other colours as dots on the
// ring, at their own hues; tapping a dot makes that colour the base.

export interface WheelMarker {
  hex: string;
  /** Where the colour sits on the ring, in degrees. */
  hue: number;
  /** What tapping the dot does, for screen readers and the tooltip. */
  label: string;
}

const clampPct = (n: number) => Math.max(0, Math.min(100, n));
/** The ring's radius at the handle, in pixels (the wheel is 256 px wide). */
const RING_R = 110;

const onRing = (hue: number) => {
  const rad = ((hue - 90) * Math.PI) / 180;
  return { x: Math.cos(rad) * RING_R, y: Math.sin(rad) * RING_R };
};

export default function ColorWheel({
  hue, sat, val, onHueChange, onSVChange, markers = [], onMarkerSelect,
}: {
  hue: number; sat: number; val: number;
  onHueChange: (h: number) => void;
  onSVChange: (s: number, v: number) => void;
  markers?: WheelMarker[];
  onMarkerSelect?: (hex: string) => void;
}) {
  const t = useTranslations('colorTool.wheel');
  const containerRef = useRef<HTMLDivElement>(null);
  const svRef = useRef<HTMLDivElement>(null);
  const draggingRing = useRef(false);
  const draggingSV = useRef(false);

  const getHueFromPointer = (clientX: number, clientY: number) => {
    const el = containerRef.current; if (!el) return null;
    const rect = el.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    let angle = Math.atan2(clientY - cy, clientX - cx) * (180 / Math.PI) + 90;
    if (angle < 0) angle += 360;
    return angle % 360;
  };
  const getSVFromPointer = (clientX: number, clientY: number) => {
    const el = svRef.current; if (!el) return null;
    const rect = el.getBoundingClientRect();
    const s = Math.max(0, Math.min(100, ((clientX - rect.left) / rect.width) * 100));
    const v = Math.max(0, Math.min(100, (1 - (clientY - rect.top) / rect.height) * 100));
    return [Math.round(s), Math.round(v)] as [number, number];
  };

  const onRingDown = (e: React.PointerEvent) => {
    const el = containerRef.current; if (!el) return;
    const rect = el.getBoundingClientRect();
    const dx = e.clientX - rect.left - rect.width / 2;
    const dy = e.clientY - rect.top - rect.height / 2;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const outerR = rect.width / 2;
    const innerR = outerR * 0.68;
    if (dist >= innerR && dist <= outerR) {
      draggingRing.current = true;
      el.setPointerCapture(e.pointerId);
      const a = getHueFromPointer(e.clientX, e.clientY);
      if (a !== null) onHueChange(Math.round(a));
    }
  };
  const onRingMove = (e: React.PointerEvent) => {
    if (!draggingRing.current) return;
    const a = getHueFromPointer(e.clientX, e.clientY);
    if (a !== null) onHueChange(Math.round(a));
  };
  const onSVDown = (e: React.PointerEvent) => {
    e.stopPropagation();
    draggingSV.current = true;
    svRef.current?.setPointerCapture(e.pointerId);
    const sv = getSVFromPointer(e.clientX, e.clientY);
    if (sv) onSVChange(sv[0], sv[1]);
  };
  const onSVMove = (e: React.PointerEvent) => {
    if (!draggingSV.current) return;
    const sv = getSVFromPointer(e.clientX, e.clientY);
    if (sv) onSVChange(sv[0], sv[1]);
  };

  // Keyboard: the ring turns clockwise with → and ↑ (it is drawn the same way
  // in every language); the square follows its axes, saturation → and
  // brightness ↑.
  const shownHue = ((Math.round(hue) % 360) + 360) % 360;
  const onHueKey = (e: React.KeyboardEvent) => {
    const step = e.shiftKey ? 10 : 1;
    const next: Record<string, number> = {
      ArrowRight: shownHue + step, ArrowUp: shownHue + step,
      ArrowLeft: shownHue - step, ArrowDown: shownHue - step,
      PageUp: shownHue + 10, PageDown: shownHue - 10,
      Home: 0, End: 359,
    };
    if (!(e.key in next)) return;
    e.preventDefault();
    onHueChange((next[e.key] + 360) % 360);
  };
  const onSVKey = (e: React.KeyboardEvent) => {
    const step = e.shiftKey ? 10 : 1;
    const next: Record<string, [number, number]> = {
      ArrowRight: [sat + step, val], ArrowLeft: [sat - step, val],
      ArrowUp: [sat, val + step], ArrowDown: [sat, val - step],
      PageUp: [sat, val + 10], PageDown: [sat, val - 10],
      Home: [0, val], End: [100, val],
    };
    if (!(e.key in next)) return;
    e.preventDefault();
    const [s, v] = next[e.key];
    onSVChange(clampPct(s), clampPct(v));
  };

  const handle = onRing(hue);
  const pureHueHex = hsvToHex(hue, 100, 100);

  // Positioned by pointer coordinates: always left to right, in every language.
  return (
    <div
      ref={containerRef}
      dir="ltr"
      className="relative w-64 h-64 mx-auto cursor-crosshair touch-none select-none"
      onPointerDown={onRingDown}
      onPointerMove={onRingMove}
      onPointerUp={() => { draggingRing.current = false; }}
      onPointerCancel={() => { draggingRing.current = false; }}
    >
      <div
        className="w-full h-full rounded-full"
        style={{
          background:
            'conic-gradient(from 0deg, hsl(0,100%,50%), hsl(60,100%,50%), hsl(120,100%,50%), hsl(180,100%,50%), hsl(240,100%,50%), hsl(300,100%,50%), hsl(360,100%,50%))',
        }}
      >
        <div className="absolute inset-[16%] rounded-full bg-card" />
      </div>
      <div
        ref={svRef}
        role="slider"
        tabIndex={0}
        aria-label={t('shade')}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={sat}
        aria-valuetext={t('shadeValue', { s: sat, v: val })}
        onKeyDown={onSVKey}
        className="absolute rounded-sm overflow-hidden cursor-crosshair focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-card"
        style={{ top: '26%', left: '26%', right: '26%', bottom: '26%' }}
        onPointerDown={onSVDown}
        onPointerMove={onSVMove}
        onPointerUp={() => { draggingSV.current = false; }}
        onPointerCancel={() => { draggingSV.current = false; }}
      >
        <div className="absolute inset-0" style={{ backgroundColor: pureHueHex }} />
        <div className="absolute inset-0" style={{ background: 'linear-gradient(to right, #fff, transparent)' }} />
        <div className="absolute inset-0" style={{ background: 'linear-gradient(to top, #000, transparent)' }} />
        <div
          className="absolute w-3.5 h-3.5 rounded-full border-2 pointer-events-none"
          style={{
            left: `${sat}%`, top: `${100 - val}%`,
            transform: 'translate(-50%, -50%)',
            borderColor: val > 50 ? '#1a1a1a' : '#f5f0e8',
            boxShadow: '0 0 2px rgba(0,0,0,0.5)',
          }}
        />
      </div>
      {markers.map((m) => {
        const p = onRing(m.hue);
        return (
          <button
            key={`${m.hex}-${m.hue}-${m.label}`}
            type="button"
            data-harmony-dot={m.hex}
            aria-label={m.label}
            title={m.label}
            // A dot sits on the ring: pressing it must not start turning the ring.
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => onMarkerSelect?.(m.hex)}
            className="absolute flex h-7 w-7 items-center justify-center rounded-full cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            style={{ left: `calc(50% + ${p.x}px - 14px)`, top: `calc(50% + ${p.y}px - 14px)` }}
          >
            <span
              className="block h-4 w-4 rounded-full border-2 border-background shadow-[0_0_0_1.5px_hsl(var(--foreground))]"
              style={{ backgroundColor: m.hex }}
            />
          </button>
        );
      })}
      <div
        role="slider"
        tabIndex={0}
        aria-label={t('hue')}
        aria-valuemin={0}
        aria-valuemax={359}
        aria-valuenow={shownHue}
        aria-valuetext={`${shownHue}°`}
        onKeyDown={onHueKey}
        className="absolute w-5 h-5 rounded-full border-2 border-foreground shadow-lg pointer-events-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-card"
        style={{
          backgroundColor: pureHueHex,
          left: `calc(50% + ${handle.x}px - 10px)`,
          top: `calc(50% + ${handle.y}px - 10px)`,
        }}
      />
    </div>
  );
}
