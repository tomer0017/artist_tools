import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import type { AnimationId } from '@/lib/companion/model';
import type { ClipParams } from './clips';
import { SketchyEngine } from './engine';
import { SketchyRig, VIEWBOX } from './rig';

// Sketchy on screen (ADR-0024): the puppet (./rig.tsx) driven by its engine
// (./engine.ts). The director (the stage that owns him) plays clips through
// the handle; he faces left or right by a mirror, never by redrawing.

export interface SketchyHandle {
  play: (id: AnimationId, opts?: { params?: ClipParams; onEnd?: () => void; restart?: boolean }) => void;
  look: (target: { x: number; y: number } | null) => void;
  /** Where one of his anchor points is on screen (the sign's top while he holds it; his front shoulder). */
  anchor: (name: 'signTop' | 'shoulder') => DOMRect | null;
  clip: () => AnimationId;
}

export const ASPECT = VIEWBOX.w / VIEWBOX.h;

export interface SketchyProps {
  /** Height in CSS pixels (the width follows). */
  height: number;
  facing: 'left' | 'right';
  reducedMotion: boolean;
  idleLife?: boolean;
  /** Stop drawing (hidden page, off screen); he carries on where he was. */
  paused?: boolean;
  initial?: AnimationId;
  className?: string;
}

export const Sketchy = forwardRef<SketchyHandle, SketchyProps>(function Sketchy({ height, facing, reducedMotion, idleLife = true, paused = false, initial = 'idle', className }, ref) {
  const box = useRef<HTMLDivElement>(null);
  const engine = useRef<SketchyEngine | null>(null);

  useEffect(() => {
    const svg = box.current?.querySelector('svg');
    if (!svg) return;
    const e = new SketchyEngine(svg, { reducedMotion, idleLife });
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
      <SketchyRig style={{ width: '100%', height: '100%', overflow: 'visible' }} />
    </div>
  );
});
