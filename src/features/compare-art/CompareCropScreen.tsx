// Compare Art — pre-comparison crop screen.
//
// A full-screen, touch-first cropper shown after picking an image and re-openable
// later. Painters often want to compare only a small region (an eye, the nose, a
// hand), so this lets each image be framed independently before the comparison
// opens. Non-destructive: the confirmed crop stores the original + normalised
// rect so it can be re-edited or reset.
//
// Interaction:
//  • Ratio presets (Square/Circle/4:3/3:4/16:9/Original): the crop frame is fixed
//    to that aspect; one finger pans and two fingers pinch-zoom the IMAGE behind
//    it (no accidental page scroll — touch-action:none).
//  • Free: one finger moves/resizes the frame via corner handles; two fingers
//    still pinch-zoom the image.

import { useCallback, useEffect, useRef, useState } from 'react';
import { Check, RotateCcw, X } from 'lucide-react';
import { CropPreset, ImageCrop, ImageMeta } from './compareArtTypes';
import { CROP_PRESETS, decodeImageElement, presetAspect, renderCrop } from './compareArtCrop';

interface Props {
  role: 'artwork' | 'reference';
  image: string; // original data URL
  initialCrop?: ImageCrop | null;
  onConfirm: (result: { cropped: string; meta: ImageMeta; original: string; crop: ImageCrop }) => void;
  onCancel: () => void;
}

interface Vec {
  x: number;
  y: number;
}
interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

// Preset buttons are driven by the shared registry (CROP_PRESETS) so painter
// formats added there appear here automatically.
const PRESETS = CROP_PRESETS;

const HANDLE_HIT = 28;
const MIN_FRAME = 48;

export default function CompareCropScreen({ role, image, initialCrop, onConfirm, onCancel }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);

  const view = useRef({ s: 1, tx: 0, ty: 0 }); // image px → viewport px
  const frame = useRef<Rect>({ x: 0, y: 0, w: 0, h: 0 });
  const [preset, setPreset] = useState<CropPreset>(initialCrop?.preset ?? 'free');
  const presetRef = useRef(preset);
  presetRef.current = preset;
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);

  const pointers = useRef<Map<number, Vec>>(new Map());
  const drag = useRef<
    | { kind: 'panImage'; last: Vec }
    | { kind: 'pinchImage'; dist0: number; s0: number; imgPt: Vec }
    | { kind: 'moveFrame'; last: Vec }
    | { kind: 'resizeFrame'; corner: number; fixed: Vec }
    | null
  >(null);
  const raf = useRef<number>();

  const viewportSize = () => {
    const el = containerRef.current;
    return { w: el?.clientWidth ?? 0, h: el?.clientHeight ?? 0 };
  };

  const centeredFrame = useCallback((aspect: number | null): Rect => {
    const { w: vw, h: vh } = viewportSize();
    const margin = 20;
    const availW = Math.max(MIN_FRAME, vw - margin * 2);
    const availH = Math.max(MIN_FRAME, vh - margin * 2);
    let fw = availW;
    let fh = availH;
    if (aspect) {
      fw = Math.min(availW, availH * aspect);
      fh = fw / aspect;
    }
    return { x: (vw - fw) / 2, y: (vh - fh) / 2, w: fw, h: fh };
  }, []);

  const fitImageToViewport = useCallback(() => {
    const img = imgRef.current;
    if (!img) return;
    const { w: vw, h: vh } = viewportSize();
    const iw = img.naturalWidth;
    const ih = img.naturalHeight;
    const s = Math.min(vw / iw, vh / ih);
    view.current = { s, tx: (vw - iw * s) / 2, ty: (vh - ih * s) / 2 };
  }, []);

  // Position the image so a stored crop rect fills the current frame (re-edit).
  const applyInitialCrop = useCallback((crop: ImageCrop) => {
    const img = imgRef.current;
    if (!img) return;
    const iw = img.naturalWidth;
    const ih = img.naturalHeight;
    const aspect = presetAspect(crop.preset, iw, ih) ?? (crop.rect.w * iw) / (crop.rect.h * ih);
    const fr = centeredFrame(crop.preset === 'free' ? aspect : presetAspect(crop.preset, iw, ih));
    frame.current = fr;
    const s = fr.w / Math.max(1, crop.rect.w * iw);
    view.current = { s, tx: fr.x - crop.rect.x * iw * s, ty: fr.y - crop.rect.y * ih * s };
  }, [centeredFrame]);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    const img = imgRef.current;
    if (!canvas || !container || !img) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const vw = container.clientWidth;
    const vh = container.clientHeight;
    canvas.width = Math.round(vw * dpr);
    canvas.height = Math.round(vh * dpr);
    canvas.style.width = `${vw}px`;
    canvas.style.height = `${vh}px`;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, vw, vh);
    ctx.fillStyle = '#0b0b0d';
    ctx.fillRect(0, 0, vw, vh);

    const { s, tx, ty } = view.current;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, tx, ty, img.naturalWidth * s, img.naturalHeight * s);

    const fr = frame.current;
    const circle = presetRef.current === 'circle';

    // Dim everything outside the frame (even-odd hole).
    ctx.beginPath();
    ctx.rect(0, 0, vw, vh);
    if (circle) {
      ctx.ellipse(fr.x + fr.w / 2, fr.y + fr.h / 2, fr.w / 2, fr.h / 2, 0, 0, Math.PI * 2, true);
    } else {
      ctx.rect(fr.x + fr.w, fr.y, -fr.w, fr.h); // reverse winding → hole
    }
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fill('evenodd');

    // Frame border.
    ctx.strokeStyle = 'rgba(255,255,255,0.95)';
    ctx.lineWidth = 2;
    if (circle) {
      ctx.beginPath();
      ctx.ellipse(fr.x + fr.w / 2, fr.y + fr.h / 2, fr.w / 2, fr.h / 2, 0, 0, Math.PI * 2);
      ctx.stroke();
    } else {
      ctx.strokeRect(fr.x, fr.y, fr.w, fr.h);
      // Rule-of-thirds guides.
      ctx.strokeStyle = 'rgba(255,255,255,0.35)';
      ctx.lineWidth = 1;
      for (let i = 1; i < 3; i++) {
        const gx = fr.x + (fr.w * i) / 3;
        const gy = fr.y + (fr.h * i) / 3;
        ctx.beginPath();
        ctx.moveTo(gx, fr.y);
        ctx.lineTo(gx, fr.y + fr.h);
        ctx.moveTo(fr.x, gy);
        ctx.lineTo(fr.x + fr.w, gy);
        ctx.stroke();
      }
    }

    // Corner handles (free mode only).
    if (presetRef.current === 'free') {
      const corners = [
        { x: fr.x, y: fr.y },
        { x: fr.x + fr.w, y: fr.y },
        { x: fr.x + fr.w, y: fr.y + fr.h },
        { x: fr.x, y: fr.y + fr.h },
      ];
      ctx.fillStyle = '#f59e0b';
      corners.forEach((c) => {
        ctx.beginPath();
        ctx.arc(c.x, c.y, 8, 0, Math.PI * 2);
        ctx.fill();
      });
    }
  }, []);

  const requestDraw = useCallback(() => {
    if (raf.current) return;
    raf.current = requestAnimationFrame(() => {
      raf.current = undefined;
      draw();
    });
  }, [draw]);

  // Decode + initialise.
  useEffect(() => {
    let alive = true;
    decodeImageElement(image)
      .then((img) => {
        if (!alive) return;
        imgRef.current = img;
        const iw = img.naturalWidth;
        const ih = img.naturalHeight;
        fitImageToViewport();
        frame.current = centeredFrame(presetAspect(preset, iw, ih));
        if (initialCrop) applyInitialCrop(initialCrop);
        setReady(true);
        requestDraw();
      })
      .catch((e) => console.error('[CompareCropScreen] decode failed:', e));
    return () => {
      alive = false;
      if (raf.current) cancelAnimationFrame(raf.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [image]);

  // Re-frame on preset change (keep the current image view).
  const changePreset = useCallback(
    (p: CropPreset) => {
      setPreset(p);
      presetRef.current = p;
      const img = imgRef.current;
      if (img) {
        frame.current = centeredFrame(presetAspect(p, img.naturalWidth, img.naturalHeight));
      }
      requestDraw();
    },
    [centeredFrame, requestDraw],
  );

  // Resize handling.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const img = imgRef.current;
      if (!img) return;
      fitImageToViewport();
      frame.current = centeredFrame(presetAspect(presetRef.current, img.naturalWidth, img.naturalHeight));
      requestDraw();
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [centeredFrame, fitImageToViewport, requestDraw]);

  // ── Pointer interaction ────────────────────────────────────────────────────
  const point = (e: React.PointerEvent): Vec => {
    const r = canvasRef.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  const clampFrameInside = (fr: Rect): Rect => {
    const { w: vw, h: vh } = viewportSize();
    const w = Math.min(fr.w, vw);
    const h = Math.min(fr.h, vh);
    const x = Math.min(Math.max(fr.x, 0), vw - w);
    const y = Math.min(Math.max(fr.y, 0), vh - h);
    return { x, y, w, h };
  };

  const cornerAt = (p: Vec): number => {
    const fr = frame.current;
    const corners = [
      { x: fr.x, y: fr.y },
      { x: fr.x + fr.w, y: fr.y },
      { x: fr.x + fr.w, y: fr.y + fr.h },
      { x: fr.x, y: fr.y + fr.h },
    ];
    for (let i = 0; i < 4; i++) {
      if (Math.hypot(p.x - corners[i].x, p.y - corners[i].y) <= HANDLE_HIT) return i;
    }
    return -1;
  };

  const insideFrame = (p: Vec) => {
    const fr = frame.current;
    return p.x >= fr.x && p.x <= fr.x + fr.w && p.y >= fr.y && p.y <= fr.y + fr.h;
  };

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.setPointerCapture(e.pointerId);
    const p = point(e);
    pointers.current.set(e.pointerId, p);

    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const { s, tx, ty } = view.current;
      drag.current = {
        kind: 'pinchImage',
        dist0: Math.hypot(a.x - b.x, a.y - b.y),
        s0: s,
        imgPt: { x: (mid.x - tx) / s, y: (mid.y - ty) / s },
      };
      return;
    }

    if (presetRef.current === 'free') {
      const corner = cornerAt(p);
      if (corner >= 0) {
        const fr = frame.current;
        const opp = [
          { x: fr.x + fr.w, y: fr.y + fr.h },
          { x: fr.x, y: fr.y + fr.h },
          { x: fr.x, y: fr.y },
          { x: fr.x + fr.w, y: fr.y },
        ][corner];
        drag.current = { kind: 'resizeFrame', corner, fixed: opp };
        return;
      }
      if (insideFrame(p)) {
        drag.current = { kind: 'moveFrame', last: p };
        return;
      }
    }
    drag.current = { kind: 'panImage', last: p };
  }, []);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (!pointers.current.has(e.pointerId)) return;
    const p = point(e);
    pointers.current.set(e.pointerId, p);
    const d = drag.current;
    if (!d) return;

    if (d.kind === 'pinchImage' && pointers.current.size >= 2) {
      const [a, b] = [...pointers.current.values()];
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      const s = Math.max(0.05, Math.min(20, d.s0 * (dist / (d.dist0 || 1))));
      view.current = { s, tx: mid.x - d.imgPt.x * s, ty: mid.y - d.imgPt.y * s };
      requestDraw();
      return;
    }
    if (d.kind === 'panImage') {
      view.current = { ...view.current, tx: view.current.tx + (p.x - d.last.x), ty: view.current.ty + (p.y - d.last.y) };
      d.last = p;
      requestDraw();
      return;
    }
    if (d.kind === 'moveFrame') {
      const fr = frame.current;
      frame.current = clampFrameInside({ ...fr, x: fr.x + (p.x - d.last.x), y: fr.y + (p.y - d.last.y) });
      d.last = p;
      requestDraw();
      return;
    }
    if (d.kind === 'resizeFrame') {
      const fx = Math.min(d.fixed.x, p.x);
      const fy = Math.min(d.fixed.y, p.y);
      const fw = Math.max(MIN_FRAME, Math.abs(p.x - d.fixed.x));
      const fh = Math.max(MIN_FRAME, Math.abs(p.y - d.fixed.y));
      frame.current = clampFrameInside({ x: fx, y: fy, w: fw, h: fh });
      requestDraw();
    }
    // clampFrameInside/insideFrame read only refs — safe to omit from deps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestDraw]);

  const onPointerUp = useCallback((e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId);
    try {
      canvasRef.current?.releasePointerCapture(e.pointerId);
    } catch {
      /* already released */
    }
    if (pointers.current.size === 0) drag.current = null;
    else if (pointers.current.size === 1) {
      const [only] = [...pointers.current.values()];
      drag.current = presetRef.current === 'free' && insideFrame(only)
        ? { kind: 'moveFrame', last: only }
        : { kind: 'panImage', last: only };
    }
  }, []);

  // ── Confirm ─────────────────────────────────────────────────────────────────
  const handleConfirm = useCallback(async () => {
    const img = imgRef.current;
    if (!img) return;
    setBusy(true);
    try {
      const iw = img.naturalWidth;
      const ih = img.naturalHeight;
      const { s, tx, ty } = view.current;
      const fr = frame.current;
      const rx = (fr.x - tx) / s / iw;
      const ry = (fr.y - ty) / s / ih;
      const rw = fr.w / s / iw;
      const rh = fr.h / s / ih;
      const crop: ImageCrop = {
        rect: { x: rx, y: ry, w: rw, h: rh },
        shape: presetRef.current === 'circle' ? 'circle' : 'rect',
        preset: presetRef.current,
      };
      const result = renderCrop(img, iw, ih, crop);
      if (!result.dataUrl) throw new Error('empty crop');
      onConfirm({
        cropped: result.dataUrl,
        meta: { width: result.width, height: result.height },
        original: image,
        crop,
      });
    } catch (err) {
      console.error('[CompareCropScreen] confirm failed:', err);
      setBusy(false);
    }
  }, [image, onConfirm]);

  const resetCrop = useCallback(() => {
    const img = imgRef.current;
    if (!img) return;
    fitImageToViewport();
    frame.current = centeredFrame(presetAspect(presetRef.current, img.naturalWidth, img.naturalHeight));
    requestDraw();
  }, [centeredFrame, fitImageToViewport, requestDraw]);

  const titleEn = role === 'artwork' ? 'Crop artwork' : 'Crop reference';
  const titleHe = role === 'artwork' ? 'חיתוך הציור' : 'חיתוך הרפרנס';

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-background" style={{ touchAction: 'none' }}>
      <div className="flex items-center justify-between border-b border-border px-3 py-2 toolbar-surface">
        <button
          onClick={onCancel}
          className="flex h-10 items-center gap-1.5 rounded-lg px-3 text-sm font-medium text-muted-foreground active:scale-95"
          aria-label="Cancel crop"
        >
          <X className="h-4 w-4" /> Cancel
        </button>
        <div className="text-center">
          <p className="text-sm font-semibold text-foreground">{titleEn}</p>
          <p className="text-[11px] text-muted-foreground" dir="rtl">{titleHe}</p>
        </div>
        <button
          onClick={handleConfirm}
          disabled={!ready || busy}
          className="flex h-10 items-center gap-1.5 rounded-lg bg-primary px-3 text-sm font-semibold text-primary-foreground active:scale-95 disabled:opacity-50"
          aria-label="Confirm crop"
        >
          <Check className="h-4 w-4" /> Done
        </button>
      </div>

      <div
        ref={containerRef}
        className="relative flex-1 min-h-0 overflow-hidden"
        style={{ touchAction: 'none' }}
      >
        <canvas
          ref={canvasRef}
          className="absolute inset-0"
          style={{ touchAction: 'none' }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        />
        {!ready && (
          <div className="absolute inset-0 flex items-center justify-center text-sm text-muted-foreground">
            Loading image…
          </div>
        )}
      </div>

      <div className="border-t border-border toolbar-surface px-2 py-2">
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
          {PRESETS.map((p) => (
            <button
              key={p.id}
              onClick={() => changePreset(p.id)}
              aria-pressed={preset === p.id}
              className={`shrink-0 rounded-full px-3 py-2 text-xs font-medium transition-colors ${
                preset === p.id ? 'bg-primary text-primary-foreground' : 'bg-secondary text-muted-foreground'
              }`}
            >
              {p.label}
            </button>
          ))}
          <button
            onClick={resetCrop}
            className="ml-auto flex shrink-0 items-center gap-1 rounded-full bg-secondary px-3 py-2 text-xs font-medium text-muted-foreground active:scale-95"
            aria-label="Reset crop"
          >
            <RotateCcw className="h-3.5 w-3.5" /> Reset
          </button>
        </div>
        <p className="px-1 pt-0.5 text-[11px] text-muted-foreground">
          {preset === 'free'
            ? 'Drag the corners to resize · drag inside to move · pinch to zoom the image.'
            : 'Drag to pan · pinch to zoom the image inside the frame.'}
        </p>
      </div>
    </div>
  );
}
