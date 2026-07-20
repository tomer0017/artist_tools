// Compare Art — the interactive comparison canvas.
//
// Rendering is imperative (a ref'd <canvas> + requestAnimationFrame), so pointer
// movement never triggers React re-renders. During a gesture the reference
// transform lives in a local ref and is committed to the store as ONE undo step
// when the gesture ends. Editing chrome (handles, guides, split bar, crop) is
// painted only onto the on-screen canvas — never through the shared scene
// renderer — so exports stay chrome-free.

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ANALYSIS_MAX_DIM,
  BLINK_INTERVAL_MS,
  Transform,
  WORKING_MAX_DIM,
} from './compareArtTypes';
import {
  Size,
  Vec2,
  angleOf,
  canvasToScene,
  distance,
  midpoint,
  pivotTransform,
  sceneSizeForArtwork,
  sceneToCanvasMapping,
  resolvePlacement,
  solveTwoPointAlignment,
  translateByCanvasDelta,
} from './compareArtGeometry';
import {
  PreparedImage,
  analyzeSceneDifference,
  prepareImage,
  renderSceneToCanvas,
} from './compareArtCanvas';
import { useCompare } from './compareArtState';

interface Props {
  selectedLayer: 'artwork' | 'reference';
  /** Anchor (2-point) alignment session, or null when inactive. */
  anchor: AnchorState | null;
  onAnchorPoint: (scenesPoint: Vec2) => void;
  onGestureActivity?: () => void;
}

export interface AnchorState {
  step: 0 | 1 | 2 | 3 | 4; // artA, refA, artB, refB, done
  artA?: Vec2;
  refA?: Vec2;
  artB?: Vec2;
  refB?: Vec2;
}

interface PointerRec {
  id: number;
  canvas: Vec2;
}

export default function CompareCanvas({ selectedLayer, anchor, onAnchorPoint, onGestureActivity }: Props) {
  const store = useCompare();
  const { session } = store;

  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Prepared (decoded, size-capped) drawables, keyed by their source data URL.
  const artworkPrep = useRef<{ url: string; img: PreparedImage } | null>(null);
  const referencePrep = useRef<{ url: string; img: PreparedImage } | null>(null);
  const [prepVersion, setPrepVersion] = useState(0);

  // Live transform overrides during a gesture (avoid store churn per move).
  const liveRef = useRef<Transform | null>(null);
  const liveArt = useRef<Transform | null>(null);
  const gestureSnap = useRef<Transform | null>(null);
  const pointers = useRef<Map<number, PointerRec>>(new Map());
  const pinchStart = useRef<{ dist: number; angle: number; pivot: Vec2; snap: Transform } | null>(null);
  const dragStart = useRef<{ canvas: Vec2; snap: Transform } | null>(null);
  const splitDrag = useRef(false);

  // Blink / press-and-hold display override.
  const blinkShow = useRef<'artwork' | 'reference'>('artwork');
  const holdShow = useRef<'artwork' | 'reference' | null>(null);

  // Difference overlay cache.
  const diffOverlay = useRef<{ data: Uint8ClampedArray; width: number; height: number } | null>(null);
  const diffTimer = useRef<ReturnType<typeof setTimeout>>();

  const rafId = useRef<number>();

  // ── Decode images when their source changes ────────────────────────────────
  useEffect(() => {
    let alive = true;
    const url = session.artwork;
    if (!url) {
      artworkPrep.current = null;
      setPrepVersion((v) => v + 1);
      return;
    }
    if (artworkPrep.current?.url === url) return;
    prepareImage(url, WORKING_MAX_DIM)
      .then((img) => {
        if (!alive) return;
        artworkPrep.current = { url, img };
        setPrepVersion((v) => v + 1);
      })
      .catch((e) => console.error('[CompareCanvas] artwork decode failed:', e));
    return () => {
      alive = false;
    };
  }, [session.artwork]);

  useEffect(() => {
    let alive = true;
    const url = session.reference;
    if (!url) {
      referencePrep.current = null;
      setPrepVersion((v) => v + 1);
      return;
    }
    if (referencePrep.current?.url === url) return;
    prepareImage(url, WORKING_MAX_DIM)
      .then((img) => {
        if (!alive) return;
        referencePrep.current = { url, img };
        setPrepVersion((v) => v + 1);
      })
      .catch((e) => console.error('[CompareCanvas] reference decode failed:', e));
    return () => {
      alive = false;
    };
  }, [session.reference]);

  // ── Scene size (working resolution, artwork aspect) ────────────────────────
  const sceneSize = useCallback((): Size => {
    const a = artworkPrep.current?.img;
    if (a) return sceneSizeForArtwork({ width: a.width, height: a.height }, WORKING_MAX_DIM);
    return { width: 1000, height: 1000 };
  }, []);

  // ── Recompute difference overlay (debounced, only when needed) ─────────────
  const recomputeDifference = useCallback(() => {
    if (session.mode !== 'difference') {
      diffOverlay.current = null;
      return;
    }
    const a = artworkPrep.current?.img ?? null;
    const r = referencePrep.current?.img ?? null;
    if (!a || !r) return;
    const scene = sceneSize();
    const t = liveRef.current ?? session.referenceTransform;
    const at = liveArt.current ?? session.artworkTransform;
    const res = analyzeSceneDifference(
      a, r, at, t, scene,
      session.difference.metric,
      session.difference.sensitivity,
      session.difference.monochrome,
      ANALYSIS_MAX_DIM,
    );
    diffOverlay.current = res ? { data: res.overlay, width: res.width, height: res.height } : null;
  }, [session.mode, session.referenceTransform, session.artworkTransform, session.difference, sceneSize]);

  const scheduleDifference = useCallback(() => {
    if (diffTimer.current) clearTimeout(diffTimer.current);
    diffTimer.current = setTimeout(() => {
      recomputeDifference();
      requestDraw();
    }, 140);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recomputeDifference]);

  // ── The single imperative draw ─────────────────────────────────────────────
  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const cw = container.clientWidth;
    const ch = container.clientHeight;
    if (cw === 0 || ch === 0) return;
    canvas.width = Math.round(cw * dpr);
    canvas.height = Math.round(ch * dpr);
    canvas.style.width = `${cw}px`;
    canvas.style.height = `${ch}px`;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cw, ch);
    ctx.fillStyle = '#0f0f11';
    ctx.fillRect(0, 0, cw, ch);

    const scene = sceneSize();
    const refT = liveRef.current ?? session.referenceTransform;
    const artT = liveArt.current ?? session.artworkTransform;

    // Frame override for blink / hold.
    let frame: import('./compareArtCanvas').FrameOverride | undefined;
    if (holdShow.current) frame = { only: holdShow.current };
    else if (session.mode === 'blink') frame = { only: blinkShow.current };

    const sceneCanvas = renderSceneToCanvas({
      artwork: artworkPrep.current?.img ?? null,
      reference: referencePrep.current?.img ?? null,
      scene,
      artworkTransform: artT,
      referenceTransform: refT,
      opacity: session.opacity,
      mode: session.mode,
      grayscale: session.grayscale,
      referenceHidden: session.referenceHidden,
      splitOrientation: session.splitOrientation,
      splitPosition: session.splitPosition,
      grid: session.grid,
      includeGrid: true,
      differenceOverlay: diffOverlay.current,
      frame,
      background: '#0f0f11',
    });

    // Blit scene → display with letterbox.
    const map = sceneToCanvasMapping(scene, { width: cw, height: ch });
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(
      sceneCanvas,
      map.originX,
      map.originY,
      scene.width * map.scale,
      scene.height * map.scale,
    );

    // ── Editing chrome (display only) ────────────────────────────────────────
    drawChrome(ctx, scene, { width: cw, height: ch }, map, refT, artT);
  }, [session, sceneSize, prepVersion]); // eslint-disable-line react-hooks/exhaustive-deps

  const drawChrome = useCallback(
    (
      ctx: CanvasRenderingContext2D,
      scene: Size,
      canvasSize: Size,
      map: { scale: number; originX: number; originY: number },
      refT: Transform,
      artT: Transform,
    ) => {
      const toCanvas = (p: Vec2): Vec2 => ({
        x: p.x * map.scale + map.originX,
        y: p.y * map.scale + map.originY,
      });

      // Crop rectangle (dim outside).
      const c = session.crop;
      if (c.x !== 0 || c.y !== 0 || c.w !== 1 || c.h !== 1) {
        const r = {
          x: c.x * scene.width,
          y: c.y * scene.height,
          w: c.w * scene.width,
          h: c.h * scene.height,
        };
        const tl = toCanvas({ x: r.x, y: r.y });
        ctx.save();
        ctx.strokeStyle = 'rgba(245,158,11,0.9)';
        ctx.lineWidth = 1.5;
        ctx.setLineDash([6, 4]);
        ctx.strokeRect(tl.x, tl.y, r.w * map.scale, r.h * map.scale);
        ctx.restore();
      }

      // Reference bounding box + handles (only when it can be manipulated).
      const canEditRef = selectedLayer === 'reference' && !session.referenceHidden
        && (session.mode === 'overlay' || session.mode === 'difference' || session.mode === 'blink');
      const canEditArt = selectedLayer === 'artwork' && !session.artworkLocked;
      const showBox = (canEditRef || canEditArt) && !anchor;
      if (showBox) {
        const img = selectedLayer === 'reference'
          ? referencePrep.current?.img
          : artworkPrep.current?.img;
        const t = selectedLayer === 'reference' ? refT : artT;
        if (img) {
          const { drawW, drawH, cx, cy } = resolvePlacement(img, scene, t);
          ctx.save();
          ctx.translate(cx * map.scale + map.originX, cy * map.scale + map.originY);
          ctx.rotate(t.rotation);
          const hw = (drawW / 2) * map.scale;
          const hh = (drawH / 2) * map.scale;
          ctx.strokeStyle = selectedLayer === 'reference'
            ? 'rgba(59,130,246,0.9)'
            : 'rgba(245,158,11,0.9)';
          ctx.lineWidth = 1.5;
          ctx.strokeRect(-hw, -hh, hw * 2, hh * 2);
          // corner handles
          ctx.fillStyle = ctx.strokeStyle;
          const hs = 5;
          [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]].forEach(([x, y]) => {
            ctx.fillRect(x - hs, y - hs, hs * 2, hs * 2);
          });
          ctx.restore();
        }
      }

      // Split divider.
      if (session.mode === 'split') {
        ctx.save();
        ctx.strokeStyle = 'rgba(255,255,255,0.95)';
        ctx.lineWidth = 2;
        if (session.splitOrientation === 'horizontal') {
          const x = (session.splitPosition * scene.width) * map.scale + map.originX;
          ctx.beginPath();
          ctx.moveTo(x, map.originY);
          ctx.lineTo(x, map.originY + scene.height * map.scale);
          ctx.stroke();
          drawSplitHandle(ctx, x, map.originY + (scene.height * map.scale) / 2, true);
        } else {
          const y = (session.splitPosition * scene.height) * map.scale + map.originY;
          ctx.beginPath();
          ctx.moveTo(map.originX, y);
          ctx.lineTo(map.originX + scene.width * map.scale, y);
          ctx.stroke();
          drawSplitHandle(ctx, map.originX + (scene.width * map.scale) / 2, y, false);
        }
        ctx.restore();
      }

      // Anchor points already placed.
      if (anchor) {
        const pts: [Vec2 | undefined, string][] = [
          [anchor.artA, '#f59e0b'],
          [anchor.refA, '#3b82f6'],
          [anchor.artB, '#f59e0b'],
          [anchor.refB, '#3b82f6'],
        ];
        pts.forEach(([p, color]) => {
          if (!p) return;
          const cp = toCanvas(p);
          ctx.save();
          ctx.fillStyle = color;
          ctx.strokeStyle = '#fff';
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(cp.x, cp.y, 7, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
          ctx.restore();
        });
      }
    },
    [session, selectedLayer, anchor],
  );

  const requestDraw = useCallback(() => {
    if (rafId.current) return;
    rafId.current = requestAnimationFrame(() => {
      rafId.current = undefined;
      draw();
    });
  }, [draw]);

  // Redraw when relevant state changes.
  useEffect(() => {
    requestDraw();
  }, [requestDraw, prepVersion]);

  // Recompute difference when inputs settle.
  useEffect(() => {
    scheduleDifference();
  }, [scheduleDifference, prepVersion, session.mode, session.difference, session.referenceTransform, session.artworkTransform, session.grayscale]);

  // Resize handling.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => requestDraw());
    ro.observe(el);
    return () => ro.disconnect();
  }, [requestDraw]);

  // Blink timer.
  useEffect(() => {
    if (session.mode !== 'blink') return;
    const interval = BLINK_INTERVAL_MS[session.blinkSpeed];
    const id = setInterval(() => {
      blinkShow.current = blinkShow.current === 'artwork' ? 'reference' : 'artwork';
      requestDraw();
    }, interval);
    return () => clearInterval(id);
  }, [session.mode, session.blinkSpeed, requestDraw]);

  // Cleanup RAF/timers on unmount.
  useEffect(() => {
    return () => {
      if (rafId.current) cancelAnimationFrame(rafId.current);
      if (diffTimer.current) clearTimeout(diffTimer.current);
    };
  }, []);

  // ── Pointer interaction ────────────────────────────────────────────────────
  const canvasPoint = (e: React.PointerEvent): Vec2 => {
    const rect = canvasRef.current!.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const activeLayerTransform = (): { get: () => Transform; live: React.MutableRefObject<Transform | null> } => {
    if (selectedLayer === 'artwork') {
      return { get: () => session.artworkTransform, live: liveArt };
    }
    return { get: () => session.referenceTransform, live: liveRef };
  };

  const nearSplitDivider = (pt: Vec2, scene: Size, canvasSize: Size): boolean => {
    const map = sceneToCanvasMapping(scene, canvasSize);
    if (session.splitOrientation === 'horizontal') {
      const x = session.splitPosition * scene.width * map.scale + map.originX;
      return Math.abs(pt.x - x) < 18;
    }
    const y = session.splitPosition * scene.height * map.scale + map.originY;
    return Math.abs(pt.y - y) < 18;
  };

  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const pt = canvasPoint(e);
      const scene = sceneSize();
      const cs = { width: canvas.clientWidth, height: canvas.clientHeight };

      // Anchor placement mode: each tap records a point.
      if (anchor) {
        onAnchorPoint(canvasToScene(pt, scene, cs));
        return;
      }

      // Press-and-hold to reveal reference (blink mode, single tap-hold).
      if (session.mode === 'blink' && e.pointerType !== 'mouse') {
        // handled in pointerup fallback; set hold for touch
      }

      canvas.setPointerCapture(e.pointerId);
      pointers.current.set(e.pointerId, { id: e.pointerId, canvas: pt });
      onGestureActivity?.();

      // Split drag has priority when near the divider.
      if (session.mode === 'split' && nearSplitDivider(pt, scene, cs)) {
        splitDrag.current = true;
        return;
      }

      // Blink press-and-hold on the image (not divider): show reference while held.
      if (session.mode === 'blink') {
        holdShow.current = 'reference';
        requestDraw();
        return;
      }

      const { get } = activeLayerTransform();
      const snap = get();
      gestureSnap.current = snap;

      if (pointers.current.size === 1) {
        dragStart.current = { canvas: pt, snap };
      } else if (pointers.current.size === 2) {
        const [p1, p2] = [...pointers.current.values()];
        const s1 = canvasToScene(p1.canvas, scene, cs);
        const s2 = canvasToScene(p2.canvas, scene, cs);
        pinchStart.current = {
          dist: distance(p1.canvas, p2.canvas),
          angle: angleOf(p1.canvas, p2.canvas),
          pivot: midpoint(s1, s2),
          snap,
        };
        dragStart.current = null;
      }
    },
    [anchor, onAnchorPoint, session.mode, sceneSize, onGestureActivity, requestDraw], // eslint-disable-line react-hooks/exhaustive-deps
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      const rec = pointers.current.get(e.pointerId);
      if (!rec) return;
      const canvas = canvasRef.current!;
      const pt = canvasPoint(e);
      rec.canvas = pt;
      const scene = sceneSize();
      const cs = { width: canvas.clientWidth, height: canvas.clientHeight };

      if (splitDrag.current) {
        const map = sceneToCanvasMapping(scene, cs);
        if (session.splitOrientation === 'horizontal') {
          store.setSplit((pt.x - map.originX) / (scene.width * map.scale));
        } else {
          store.setSplit((pt.y - map.originY) / (scene.height * map.scale));
        }
        return;
      }

      if (holdShow.current) return; // holding reference, no transform

      const { live } = activeLayerTransform();

      if (pointers.current.size >= 2 && pinchStart.current) {
        const [p1, p2] = [...pointers.current.values()];
        const dist = distance(p1.canvas, p2.canvas);
        const angle = angleOf(p1.canvas, p2.canvas);
        const factor = dist / (pinchStart.current.dist || 1);
        const dRot = angle - pinchStart.current.angle;
        live.current = pivotTransform(
          pinchStart.current.snap,
          pinchStart.current.pivot,
          factor,
          dRot,
          scene,
        );
        requestDraw();
      } else if (dragStart.current) {
        const dx = pt.x - dragStart.current.canvas.x;
        const dy = pt.y - dragStart.current.canvas.y;
        live.current = translateByCanvasDelta(dragStart.current.snap, dx, dy, scene, cs);
        requestDraw();
      }
    },
    [session.splitOrientation, sceneSize, store, requestDraw], // eslint-disable-line react-hooks/exhaustive-deps
  );

  const endGesture = useCallback(
    (e: React.PointerEvent) => {
      pointers.current.delete(e.pointerId);
      try {
        canvasRef.current?.releasePointerCapture(e.pointerId);
      } catch {
        /* pointer may already be released */
      }

      if (holdShow.current) {
        holdShow.current = null;
        requestDraw();
      }

      if (splitDrag.current && pointers.current.size === 0) {
        splitDrag.current = false;
        return;
      }

      // When all fingers lift, commit the live transform as one history step.
      if (pointers.current.size === 0) {
        const committedRef = liveRef.current;
        const committedArt = liveArt.current;
        if (committedRef) {
          store.commitReferenceTransform(committedRef);
          liveRef.current = null;
        }
        if (committedArt) {
          store.commitArtworkTransform(committedArt);
          liveArt.current = null;
        }
        pinchStart.current = null;
        dragStart.current = null;
        gestureSnap.current = null;
      } else if (pointers.current.size === 1) {
        // Second finger lifted mid-pinch — re-anchor the remaining drag so the
        // reference doesn't jump.
        const [p1] = [...pointers.current.values()];
        const cur = (selectedLayer === 'artwork' ? liveArt : liveRef).current
          ?? (selectedLayer === 'artwork' ? session.artworkTransform : session.referenceTransform);
        dragStart.current = { canvas: p1.canvas, snap: cur };
        pinchStart.current = null;
      }
    },
    [store, selectedLayer, session, requestDraw],
  );

  return (
    <div
      ref={containerRef}
      className="relative flex-1 min-h-0 overflow-hidden"
      style={{ touchAction: 'none' }}
    >
      <canvas
        ref={canvasRef}
        className="absolute inset-0"
        style={{ touchAction: 'none' }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={endGesture}
        onPointerCancel={endGesture}
      />
    </div>
  );
}

function drawSplitHandle(ctx: CanvasRenderingContext2D, x: number, y: number, horizontal: boolean) {
  ctx.save();
  ctx.fillStyle = 'rgba(255,255,255,0.95)';
  ctx.beginPath();
  ctx.arc(x, y, 12, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#111';
  ctx.font = '12px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(horizontal ? '⇆' : '⇅', x, y);
  ctx.restore();
}

/** Solve + apply a 2-point alignment (called by the workspace). */
export function computeAnchorTransform(
  anchor: AnchorState,
  current: Transform,
  refDims: Size,
  artDims: Size,
): Transform | null {
  if (!anchor.artA || !anchor.refA || !anchor.artB || !anchor.refB) return null;
  const scene = sceneSizeForArtwork(artDims, WORKING_MAX_DIM);
  return solveTwoPointAlignment(
    anchor.artA,
    anchor.artB,
    anchor.refA,
    anchor.refB,
    current,
    refDims,
    scene,
  );
}
