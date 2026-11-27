// The crop: the artwork (rotated as set), with a box to move and resize.
// Coordinates are kept 0…1 in the rotated image, so the crop does not depend
// on the size it is shown at; a fixed shape keeps its ratio in real pixels.

import { useCallback, useEffect, useRef, useState } from 'react';
import { rotatedSize } from './render/artwork';
import { aspectRatioOf, type CropSpec } from './types';

type Mode = 'move' | 'nw' | 'ne' | 'se' | 'sw';
const MIN = 0.05;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export function CropEditor({ image, crop, onChange, label, hint }: { image: HTMLCanvasElement; crop: CropSpec; onChange: (crop: CropSpec) => void; label: string; hint: string }) {
  const host = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setSize({ w: entry.contentRect.width, h: entry.contentRect.height }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const r = rotatedSize(image.width, image.height, crop.rotation);
  const f = size.w > 0 && size.h > 0 ? Math.min((size.w - 32) / r.w, (size.h - 56) / r.h) : 0;
  const dw = Math.max(0, r.w * f);
  const dh = Math.max(0, r.h * f);

  useEffect(() => {
    const c = canvas.current;
    if (!c || dw < 2 || dh < 2) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    c.width = Math.round(dw * dpr);
    c.height = Math.round(dh * dpr);
    const ctx = c.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, c.width, c.height);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.translate(c.width / 2, c.height / 2);
    ctx.rotate((crop.rotation * Math.PI) / 180);
    const k = f * dpr;
    ctx.drawImage(image, (-image.width * k) / 2, (-image.height * k) / 2, image.width * k, image.height * k);
  }, [image, crop.rotation, dw, dh, f]);

  // Drags follow the latest crop without re-binding listeners.
  const latest = useRef({ crop, onChange, dw, dh, r });
  latest.current = { crop, onChange, dw, dh, r };
  const drag = useRef<{ mode: Mode; x0: number; y0: number; start: CropSpec } | null>(null);

  const move = useCallback((e: PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const { dw: w0, dh: h0, r: rot, onChange: emit } = latest.current;
    if (w0 <= 0 || h0 <= 0) return;
    const dx = (e.clientX - d.x0) / w0;
    const dy = (e.clientY - d.y0) / h0;
    const s = d.start;
    if (d.mode === 'move') {
      emit({ ...s, x: clamp(s.x + dx, 0, 1 - s.w), y: clamp(s.y + dy, 0, 1 - s.h) });
      return;
    }
    const west = d.mode === 'nw' || d.mode === 'sw';
    const north = d.mode === 'nw' || d.mode === 'ne';
    const ax = west ? s.x + s.w : s.x;
    const ay = north ? s.y + s.h : s.y;
    const px = clamp((west ? s.x : s.x + s.w) + dx, 0, 1);
    const py = clamp((north ? s.y : s.y + s.h) + dy, 0, 1);
    let w = Math.max(MIN, Math.abs(px - ax));
    let h = Math.max(MIN, Math.abs(py - ay));
    const ratio = aspectRatioOf(s);
    if (ratio) {
      // Hold the ratio in the rotated image's pixels, following the pointer's larger move.
      const hFromW = (w * rot.w) / (ratio * rot.h);
      const wFromH = (h * ratio * rot.h) / rot.w;
      if (hFromW >= h) h = hFromW;
      else w = wFromH;
      const availW = west ? ax : 1 - ax;
      const availH = north ? ay : 1 - ay;
      if (w > availW) {
        w = availW;
        h = (w * rot.w) / (ratio * rot.h);
      }
      if (h > availH) {
        h = availH;
        w = (h * ratio * rot.h) / rot.w;
      }
    } else {
      w = Math.min(w, west ? ax : 1 - ax);
      h = Math.min(h, north ? ay : 1 - ay);
    }
    emit({ ...s, x: west ? ax - w : ax, y: north ? ay - h : ay, w, h });
  }, []);

  const end = useCallback(() => {
    drag.current = null;
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', end);
    window.removeEventListener('pointercancel', end);
  }, [move]);

  useEffect(() => end, [end]);

  const start = (mode: Mode) => (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    drag.current = { mode, x0: e.clientX, y0: e.clientY, start: { ...latest.current.crop } };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
  };

  const onKey = (e: React.KeyboardEvent) => {
    const step = e.shiftKey ? 0.05 : 0.01;
    const keys: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    const k = keys[e.key];
    if (!k) return;
    e.preventDefault();
    onChange({ ...crop, x: clamp(crop.x + k[0], 0, 1 - crop.w), y: clamp(crop.y + k[1], 0, 1 - crop.h) });
  };

  const x = crop.x * dw;
  const y = crop.y * dh;
  const w = crop.w * dw;
  const h = crop.h * dh;
  const round = crop.aspect === 'circle';
  const corners: [Mode, string][] = [
    ['nw', 'left-0 top-0 -translate-x-1/2 -translate-y-1/2 cursor-nwse-resize'],
    ['ne', 'right-0 top-0 translate-x-1/2 -translate-y-1/2 cursor-nesw-resize'],
    ['se', 'right-0 bottom-0 translate-x-1/2 translate-y-1/2 cursor-nwse-resize'],
    ['sw', 'left-0 bottom-0 -translate-x-1/2 translate-y-1/2 cursor-nesw-resize'],
  ];

  return (
    <div ref={host} dir="ltr" className="relative flex h-full w-full touch-none select-none items-center justify-center overflow-hidden pb-6">
      {dw > 0 && (
        <div className="relative" style={{ width: dw, height: dh }}>
          <canvas ref={canvas} className="block" style={{ width: dw, height: dh }} />
          <svg className="pointer-events-none absolute inset-0" width={dw} height={dh} aria-hidden="true">
            <path
              d={round ? `M0 0H${dw}V${dh}H0Z M${x + w / 2} ${y} a${w / 2} ${h / 2} 0 1 0 0.01 0Z` : `M0 0H${dw}V${dh}H0Z M${x} ${y}h${w}v${h}h${-w}Z`}
              fillRule="evenodd"
              fill="rgba(10,10,12,0.62)"
            />
          </svg>
          <div
            role="group"
            aria-label={label}
            tabIndex={0}
            onKeyDown={onKey}
            onPointerDown={start('move')}
            className={`absolute cursor-move border-2 border-white/95 shadow-[0_0_0_1px_rgba(0,0,0,0.45)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${round ? 'rounded-full' : ''}`}
            style={{ left: x, top: y, width: w, height: h }}
          >
            {!round && (
              <div className="pointer-events-none absolute inset-0" aria-hidden="true">
                <span className="absolute inset-y-0 left-1/3 w-px bg-white/35" />
                <span className="absolute inset-y-0 left-2/3 w-px bg-white/35" />
                <span className="absolute inset-x-0 top-1/3 h-px bg-white/35" />
                <span className="absolute inset-x-0 top-2/3 h-px bg-white/35" />
              </div>
            )}
            {corners.map(([mode, cls]) => (
              <span key={mode} onPointerDown={start(mode)} className={`absolute flex h-11 w-11 items-center justify-center ${cls}`} aria-hidden="true">
                <span className="h-4 w-4 rounded-[3px] border-2 border-white bg-primary shadow" />
              </span>
            ))}
          </div>
        </div>
      )}
      <p className="pointer-events-none absolute inset-x-0 bottom-1.5 px-4 text-center text-[11px] text-white/70">{hint}</p>
    </div>
  );
}
