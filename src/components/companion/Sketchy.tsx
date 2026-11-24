import { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from 'react';
import type { AnimationId } from '@/lib/companion/model';
import type { ClipParams } from './clips';
import { RasterEngine } from './raster-engine';
import { RasterRig } from './raster-rig';
import { WIDTH_RATIO } from './geometry';

// Sketchy on screen: the approved raster artwork and its articulated pose
// engine (raster-engine.ts, raster-mesh.ts). Public control and anchor
// interfaces remain those of ADR-0024: the director (the stage, the roulette,
// a celebration) plays clips through the handle; he faces left or right by a
// mirror, never by redrawing. Only one is on screen at a time (presence.ts).

export interface SketchyHandle {
  play: (id: AnimationId, opts?: { params?: ClipParams; onEnd?: () => void; restart?: boolean }) => void;
  /** Where to look, in his own frame (x forward, y down, each -1…1); null: ahead. */
  look: (target: { x: number; y: number } | null) => void;
  /** Where one of his anchor points is on screen (the top of the sign's post while he holds it; his front shoulder). */
  anchor: (name: 'signTop' | 'shoulder') => DOMRect | null;
  clip: () => AnimationId;
}

/** His box's width for its height. */
export const ASPECT = WIDTH_RATIO;

export interface SketchyProps {
  /** Height in CSS pixels (the width follows). */
  height: number;
  facing: 'left' | 'right';
  reducedMotion: boolean;
  idleLife?: boolean;
  /** Stop drawing (hidden page); he carries on where he was. */
  paused?: boolean;
  initial?: AnimationId;
  className?: string;
}

export const Sketchy = forwardRef<SketchyHandle, SketchyProps>(function Sketchy({ height, facing, reducedMotion, idleLife = true, paused = false, initial = 'idle', className }, ref) {
  const box = useRef<HTMLDivElement>(null);
  const engine = useRef<RasterEngine | null>(null);
  // The still picture and the SVG anchors follow the pose; the canvas is drawn by the engine directly.
  const [pose, setPose] = useState<AnimationId>(initial);
  useLayoutEffect(() => {
    engine.current?.renderNow();
  }, [pose]);

  useEffect(() => {
    if (!box.current) return;
    const e = new RasterEngine(box.current, { reducedMotion, idleLife }, setPose);
    engine.current = e;
    e.play(initial);
    return () => {
      e.dispose();
      engine.current = null;
    };
    // The engine is made once; options follow below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    engine.current?.setOptions({ reducedMotion, idleLife });
  }, [reducedMotion, idleLife]);

  useEffect(() => {
    if (paused) engine.current?.pause();
    else engine.current?.resume();
  }, [paused]);

  useImperativeHandle(
    ref,
    () => ({
      play: (id, opts) => engine.current?.play(id, opts),
      look: (target) => engine.current?.look(target),
      anchor: (name) => {
        const el = box.current?.querySelector(`[data-anchor="${name}"]`);
        if (!el) return null;
        const rect = el.getBoundingClientRect();
        return rect.width === 0 && rect.height === 0 && rect.x === 0 && rect.y === 0 ? null : rect;
      },
      clip: () => engine.current?.clip ?? 'idle',
    }),
    [],
  );

  return (
    <div ref={box} className={className} style={{ width: height * ASPECT, height, transform: facing === 'left' ? 'scaleX(-1)' : undefined }} data-facing={facing}>
      <RasterRig pose={pose} style={{ width: '100%', height: '100%', overflow: 'visible' }} />
    </div>
  );
});
