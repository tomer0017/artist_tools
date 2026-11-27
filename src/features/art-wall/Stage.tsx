// The big picture of Art on Your Wall: the live preview (wall, room or My
// Room), the frames side by side, and My Room's handles (move, perspective
// corners, real-size calibration). Everything is drawn by the same renderer as
// the saved image, at the screen's size.

import { useCallback, useEffect, useRef, useState } from 'react';
import { renderPhotoScene, type ArtSource } from './exporter';
import { centroid, defaultQuad, fittedQuad, quadMeta, translateQuad, type Quad } from './placement';
import { loadRoomAssets } from './render/assets';
import { useTranslations } from 'use-intl';
import { renderScene } from './render/scene';
import { ctxOf, makeCanvas } from './render/util';
import { SHAPES, type FrameSpec, type Pt, type WallProject } from './types';

function useBox<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setSize({ w: entry.contentRect.width, h: entry.contentRect.height }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, size] as const;
}

/** The largest box of ratio w/h inside an area, with a margin. */
function fit(area: { w: number; h: number }, ratio: number, margin = 12): { w: number; h: number } {
  const aw = Math.max(0, area.w - margin * 2);
  const ah = Math.max(0, area.h - margin * 2);
  return aw / ah > ratio ? { w: ah * ratio, h: ah } : { w: aw, h: aw / ratio };
}

const dprOf = (css: { w: number; h: number }) => {
  const dpr = Math.min(2, typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1);
  // Keep the backing store moderate (fast on phones).
  return Math.min(dpr, 2200 / Math.max(1, css.w, css.h));
};

/** A downscaled copy of the photo for a given canvas size (redrawing 12 MP per frame is slow). */
function usePhotoAt(photo: HTMLCanvasElement | null, w: number, h: number) {
  const cache = useRef<{ key: string; source: HTMLCanvasElement; canvas: HTMLCanvasElement } | null>(null);
  return useCallback(() => {
    if (!photo || w < 2 || h < 2) return null;
    const key = `${photo.width}x${photo.height}@${w}x${h}`;
    if (cache.current?.key === key && cache.current.source === photo) return cache.current.canvas;
    const c = makeCanvas(w, h);
    const ctx = ctxOf(c);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(photo, 0, 0, w, h);
    cache.current = { key, source: photo, canvas: c };
    return c;
  }, [photo, w, h]);
}

/** One rendered view (wall, room, or the photo when My Room has a placement). */
export function ScenePreview({ project, art, photo, frame, label, margin = 12 }: { project: WallProject; art: ArtSource; photo: HTMLCanvasElement | null; frame?: FrameSpec; label: string; margin?: number }) {
  const [host, area] = useBox<HTMLDivElement>();
  const canvas = useRef<HTMLCanvasElement>(null);
  const photoMode = project.space.mode === 'photo' && !!photo && !!project.space.photo.quad;
  const ratio = photoMode && photo ? photo.width / photo.height : SHAPES[project.output.shape];
  const css = fit(area, ratio, margin);
  const dpr = dprOf(css);
  const pw = Math.round(css.w * dpr);
  const ph = Math.round(css.h * dpr);
  const photoAt = usePhotoAt(photoMode ? photo : null, pw, ph);

  const t = useTranslations('wallTool.editor');
  const [status, setStatus] = useState<'ready' | 'loading' | 'error'>('ready');
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const c = canvas.current;
    if (!c || pw < 2 || ph < 2) return;
    let alive = true;
    let raf = 0;
    setStatus('loading');
    void loadRoomAssets(project).then(() => {
      if (!alive) return;
      raf = requestAnimationFrame(() => {
        c.width = pw;
        c.height = ph;
        const scaled = photoAt();
        if (photoMode && scaled) renderPhotoScene(c, project, art, scaled, frame ?? project.frame);
        else renderScene(c, project, { art: art.canvas, artKey: art.key, frame });
        setStatus('ready');
      });
    }).catch(() => alive && setStatus('error'));
    return () => { alive = false; cancelAnimationFrame(raf); };
  }, [project, art, frame, pw, ph, photoMode, photoAt, retry]);

  return (
    <div ref={host} className="relative flex h-full w-full items-center justify-center">
      {status !== 'ready' && <div role="status" className="absolute z-10 rounded-xl bg-background/90 px-4 py-3 text-xs shadow-lg">{status === 'loading' ? t('loading') : <button onClick={() => setRetry((n) => n + 1)}>{t('retry')}</button>}</div>}
      {css.w > 0 && <canvas ref={canvas} role="img" aria-label={label} className="block rounded-md shadow-2xl" style={{ width: css.w, height: css.h }} />}
    </div>
  );
}

/** Up to four frames side by side; choosing one makes it the frame. */
export function CompareGrid({ project, art, photo, frames, labels, onUse, label, selected }: { selected?: number; project: WallProject; art: ArtSource; photo: HTMLCanvasElement | null; frames: FrameSpec[]; labels: string[]; onUse: (i: number) => void; label: string }) {
  return (
    <div className={`grid h-full w-full gap-1.5 p-1.5 ${frames.length > 2 ? 'grid-cols-2 grid-rows-2' : 'grid-cols-1 grid-rows-2 sm:grid-cols-2 sm:grid-rows-1'}`}>
      {frames.map((frame, i) => (
        <button
          key={i}
          type="button"
          onClick={() => onUse(i)}
          aria-pressed={selected === i}
          className={`relative min-h-0 min-w-0 overflow-hidden rounded-lg ring-2 ${selected === i ? 'ring-primary' : 'ring-white/10'} transition hover:ring-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary`}
        >
          <ScenePreview project={project} art={art} photo={photo} frame={frame} label={`${label}: ${labels[i]}`} margin={4} />
          <span className="absolute start-2 top-2 rounded-full bg-black/70 px-2.5 py-1 text-xs font-semibold text-white">{labels[i]}</span>
        </button>
      ))}
    </div>
  );
}

/** My Room: the photo with the piece on it, its corners to drag, and taps for the real size. */
export function PhotoStage({ project, art, photo, update, calibrating, onCalPoint, labels }: {
  project: WallProject;
  art: ArtSource;
  photo: HTMLCanvasElement;
  update: (recipe: (p: WallProject) => WallProject) => void;
  /** Points tapped so far while setting the real size (null: not setting it). */
  calibrating: Pt[] | null;
  onCalPoint: (p: Pt) => void;
  labels: { label: string; hint: string; corner: (n: number) => string; tap: string };
}) {
  const [host, area] = useBox<HTMLDivElement>();
  const canvas = useRef<HTMLCanvasElement>(null);
  const css = fit({ w: area.w, h: Math.max(0, area.h - 22) }, photo.width / photo.height, 12);
  const dpr = dprOf(css);
  const pw = Math.round(css.w * dpr);
  const ph = Math.round(css.h * dpr);
  const photoAt = usePhotoAt(photo, pw, ph);
  const size = { w: photo.width, h: photo.height };

  // A first placement, in the middle of the wall.
  useEffect(() => {
    if (!project.space.photo.quad) update((p) => ({ ...p, space: { ...p.space, photo: { ...p.space.photo, quad: defaultQuad(p, size), ...quadMeta(p) } } }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.space.photo.quad, photo]);

  useEffect(() => {
    const c = canvas.current;
    if (!c || pw < 2 || ph < 2) return;
    const raf = requestAnimationFrame(() => {
      if (c.width !== pw || c.height !== ph) {
        c.width = pw;
        c.height = ph;
      }
      const scaled = photoAt();
      if (scaled) renderPhotoScene(c, project, art, scaled);
    });
    return () => cancelAnimationFrame(raf);
  }, [project, art, pw, ph, photoAt]);

  const quad = fittedQuad(project, size);
  const latest = useRef({ project, css, quad });
  latest.current = { project, css, quad };
  const drag = useRef<{ corner: number | null; x0: number; y0: number; start: Quad } | null>(null);

  const setQuad = useCallback(
    (q: Quad) => update((p) => ({ ...p, space: { ...p.space, photo: { ...p.space.photo, quad: q, ...quadMeta(p) } } })),
    [update],
  );
  const move = useCallback(
    (e: PointerEvent) => {
      const d = drag.current;
      const { css: c } = latest.current;
      if (!d || c.w <= 0) return;
      const dx = (e.clientX - d.x0) / c.w;
      const dy = (e.clientY - d.y0) / c.h;
      if (d.corner === null) setQuad(translateQuad(d.start, dx, dy));
      else {
        const next = d.start.map((p) => ({ ...p })) as Quad;
        next[d.corner] = { x: Math.min(1.3, Math.max(-0.3, d.start[d.corner].x + dx)), y: Math.min(1.3, Math.max(-0.3, d.start[d.corner].y + dy)) };
        setQuad(next);
      }
    },
    [setQuad],
  );
  const end = useCallback(() => {
    drag.current = null;
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', end);
    window.removeEventListener('pointercancel', end);
  }, [move]);
  useEffect(() => end, [end]);
  const start = (corner: number | null) => (e: React.PointerEvent) => {
    const q = latest.current.quad;
    if (!q || calibrating) return;
    e.preventDefault();
    e.stopPropagation();
    drag.current = { corner, x0: e.clientX, y0: e.clientY, start: q };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
  };
  const onKey = (e: React.KeyboardEvent) => {
    const q = latest.current.quad;
    if (!q) return;
    const step = e.shiftKey ? 0.02 : 0.005;
    const keys: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    const k = keys[e.key];
    if (!k) return;
    e.preventDefault();
    setQuad(translateQuad(q, k[0], k[1]));
  };

  const tap = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!calibrating) return;
    const rect = e.currentTarget.getBoundingClientRect();
    onCalPoint({ x: (e.clientX - rect.left) / rect.width, y: (e.clientY - rect.top) / rect.height });
  };

  const pts = quad ? quad.map((p) => ({ x: p.x * css.w, y: p.y * css.h })) : null;
  const c = pts ? centroid(pts as Quad) : null;
  const cal = calibrating ?? (project.space.photo.calibration ? [project.space.photo.calibration.a, project.space.photo.calibration.b] : []);

  return (
    <div ref={host} dir="ltr" className="relative flex h-full w-full touch-none select-none items-center justify-center overflow-hidden">
      {css.w > 0 && (
        <div className="relative" style={{ width: css.w, height: css.h }} onPointerDown={tap}>
          <canvas ref={canvas} role="img" aria-label={labels.label} className="block rounded-md" style={{ width: css.w, height: css.h }} />
          <svg className="absolute inset-0 overflow-visible" width={css.w} height={css.h}>
            {pts && !calibrating && (
              <polygon
                points={pts.map((p) => `${p.x},${p.y}`).join(' ')}
                fill="rgba(255,255,255,0.001)"
                stroke="rgba(255,255,255,0.85)"
                strokeWidth={1.5}
                strokeDasharray="6 4"
                className="cursor-move"
                onPointerDown={start(null)}
              />
            )}
            {cal.length > 0 && (
              <g aria-hidden="true">
                {cal.length === 2 && <line x1={cal[0].x * css.w} y1={cal[0].y * css.h} x2={cal[1].x * css.w} y2={cal[1].y * css.h} stroke="#f59e0b" strokeWidth={2} />}
                {cal.map((p, i) => (
                  <circle key={i} cx={p.x * css.w} cy={p.y * css.h} r={7} fill="#f59e0b" stroke="#fff" strokeWidth={2} />
                ))}
              </g>
            )}
          </svg>
          {pts && !calibrating && (
            <>
              <div
                tabIndex={0}
                role="group"
                aria-label={labels.label}
                onKeyDown={onKey}
                className="absolute h-0 w-0 focus-visible:outline-none"
                style={{ left: c!.x, top: c!.y }}
              />
              {pts.map((p, i) => (
                <span
                  key={i}
                  onPointerDown={start(i)}
                  aria-label={labels.corner(i + 1)}
                  className="absolute flex h-11 w-11 -translate-x-1/2 -translate-y-1/2 cursor-grab items-center justify-center"
                  style={{ left: p.x, top: p.y }}
                >
                  <span className="h-4 w-4 rounded-full border-2 border-white bg-primary shadow-lg" />
                </span>
              ))}
            </>
          )}
        </div>
      )}
      {/* Below the photo, so it never sits on the piece itself. */}
      <p className="pointer-events-none absolute inset-x-0 bottom-1 px-4 text-center text-[11px] font-medium text-white/80 [text-shadow:0_1px_3px_rgba(0,0,0,0.8)]">{calibrating ? labels.tap : labels.hint}</p>
    </div>
  );
}
