import type { AnimationId } from '@/lib/companion/model';
import { CLIPS, type ClipParams } from './clips';
import { LEG, RASTER_RIGS, SPRITE, type RasterPart } from './raster-rig';
import type { EngineOptions } from './engine';
import { RasterMesh, type MeshMotion } from './raster-mesh';

// ─── Sketchy's motion over the official artwork ───────────────────────────────
// The director's contract of the original engine (play, look, pause, clip
// timing, completion callbacks) over the raster poses: each joint of the pose
// turns a little about its pivot (raster-rig.tsx), the body breathes and bobs,
// the eyes follow a target smoothly and the head turns with them (rigidly: the
// face itself is never warped). Walking and running swing the legs at the
// rhythm of the ground he covers (strideCycle), so his feet do not slide.

type PlayOptions = { params?: ClipParams; onEnd?: () => void; restart?: boolean };
const TAU = Math.PI * 2;
const rotate = (angle: number, x: number, y: number, dy = 0) => `translate(0 ${dy.toFixed(2)}) rotate(${angle.toFixed(2)} ${x} ${y})`;

/** How far each leg swings from the drawn stride toward the other (degrees). */
export const SWING = { walk: 16, run: 20 } as const;
/** His natural rhythm: seconds per stride cycle (two steps), calm when walking. */
export const CADENCE = { walk: 1, run: 0.64 } as const;

/** Ground one stride cycle covers when he is `heightCss` tall (CSS pixels): each step a planted foot moves back about 2·LEG·sin(swing). */
const strideLength = (clip: 'walk' | 'run', heightCss: number) => 4 * LEG * Math.sin((SWING[clip] * Math.PI) / 180) * (heightCss / SPRITE.h);

/** Seconds per stride cycle (two steps) for walking or running at `pxPerSec`, so his feet do not slide. */
export function strideCycle(clip: 'walk' | 'run', pxPerSec: number, heightCss: number): number {
  return Math.min(1.6, Math.max(0.42, strideLength(clip, heightCss) / Math.max(1, pxPerSec)));
}

/** How fast he crosses the screen at his natural rhythm (CSS pixels a second), `percent` the admin's speed. */
export function gaitSpeed(clip: 'walk' | 'run', heightCss: number, percent = 100): number {
  return (strideLength(clip, heightCss) / CADENCE[clip]) * (percent / 100);
}

const clamp1 = (v: number) => Math.max(-1, Math.min(1, v));

/** Raster articulation, with the same director contract and clip timing as the original engine. */
export class RasterEngine {
  private id: AnimationId = 'idle';
  private opts: EngineOptions;
  private playOptions: PlayOptions = {};
  private started = performance.now();
  private pausedAt: number | null = null;
  private raf = 0;
  private lastFrame = 0;
  private timer = 0;
  private ended = false;
  private disposed = false;
  private mesh: RasterMesh | null = null;
  private meshAttempted = false;
  private target: { x: number; y: number } | null = null;
  private gaze = { x: 0, y: 0 };
  private gazeAt = performance.now();
  private readonly fine: boolean;

  constructor(
    private box: HTMLElement,
    options: EngineOptions,
    private select: (id: AnimationId) => void,
  ) {
    this.opts = options;
    this.fine = typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(pointer: fine)').matches;
  }

  get clip() {
    return this.id;
  }

  setOptions(options: Partial<EngineOptions>) {
    this.opts = { ...this.opts, ...options };
    window.clearTimeout(this.timer);
    this.timer = 0;
    this.stop();
    this.draw();
    this.schedule();
  }

  play(id: AnimationId, options: PlayOptions = {}) {
    if (this.disposed) return;
    if (this.id === id && !this.ended && !options.restart) {
      this.playOptions = { ...options, params: options.params ?? this.playOptions.params };
      this.select(id);
      this.draw();
      this.schedule();
      return;
    }
    window.clearTimeout(this.timer);
    this.timer = 0;
    this.id = id;
    this.playOptions = options;
    this.started = performance.now();
    this.ended = false;
    if (this.pausedAt !== null) this.pausedAt = this.started;
    this.select(id);
    this.draw();
    this.schedule();
  }

  /** Where to look: a direction in his own frame (x forward, y down), each -1…1; null looks ahead. */
  look(target: { x: number; y: number } | null) {
    this.target = target ? { x: clamp1(target.x), y: clamp1(target.y) } : null;
    if (this.opts.reducedMotion) return;
    this.schedule();
  }

  pause() {
    if (this.pausedAt === null) this.pausedAt = performance.now();
    this.stop();
    window.clearTimeout(this.timer);
    this.timer = 0;
  }

  resume() {
    if (this.pausedAt !== null) {
      this.started += performance.now() - this.pausedAt;
      this.pausedAt = null;
    }
    this.draw();
    this.schedule();
  }

  dispose() {
    this.mesh?.dispose();
    this.mesh = null;
    this.disposed = true;
    this.stop();
    window.clearTimeout(this.timer);
    this.timer = 0;
  }

  renderNow() {
    this.draw();
  }

  private stop() {
    cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  private schedule() {
    if (this.disposed || this.pausedAt !== null) return;
    if (this.opts.reducedMotion) {
      if (!CLIPS[this.id].loop && !this.ended && !this.timer)
        this.timer = window.setTimeout(() => {
          this.timer = 0;
          this.finish();
        }, 600);
      return;
    }
    if (!this.raf) this.raf = requestAnimationFrame(this.frame);
  }

  private finish() {
    if (this.ended || this.disposed) return;
    this.ended = true;
    const end = this.playOptions.onEnd;
    if (end)
      queueMicrotask(() => {
        if (!this.disposed) end();
      });
  }

  /** Something visibly moving needs every frame; a calm pose is drawn about 30 times a second. */
  private busy() {
    const t = this.target ?? { x: 0, y: 0 };
    return Math.abs(t.x - this.gaze.x) + Math.abs(t.y - this.gaze.y) > 0.02 || this.id === 'walk' || this.id === 'run' || this.id === 'jump' || this.id === 'celebrate' || (this.mesh?.fading ?? false);
  }

  private frame = (now: number) => {
    this.raf = 0;
    if (this.disposed || this.pausedAt !== null) return;
    const every = this.fine && this.busy() ? 15 : 31;
    if (now - this.lastFrame >= every) {
      this.lastFrame = now;
      this.draw();
    }
    this.schedule();
  };

  private draw() {
    if (this.disposed) return;
    const clip = CLIPS[this.id];
    const reduced = this.opts.reducedMotion === true;
    const now = performance.now();
    const elapsed = ((this.pausedAt ?? now) - this.started) / 1000;
    const stride = this.id === 'walk' || this.id === 'run';
    const cycle = stride ? (this.playOptions.params?.cycle ?? clip.duration) : clip.duration;
    const t = reduced ? clip.stillAt : clip.loop ? elapsed % cycle : Math.min(elapsed, cycle);
    const phase = (t / cycle) * TAU;
    const s = Math.sin(phase);
    const fast = Math.sin(t * TAU * 3);
    const life = !reduced && this.opts.idleLife !== false;

    // The gaze eases toward its target (still, with less motion).
    const goal = reduced ? { x: 0, y: 0 } : (this.target ?? { x: 0, y: 0 });
    const dt = Math.min(0.1, Math.max(0, (now - this.gazeAt) / 1000));
    this.gazeAt = now;
    const k = 1 - Math.exp(-dt / 0.09);
    this.gaze = { x: this.gaze.x + (goal.x - this.gaze.x) * k, y: this.gaze.y + (goal.y - this.gaze.y) * k };
    const g = this.gaze;

    const rotations: Record<RasterPart, number> = { tail: life ? 2.4 * Math.sin(elapsed * 1.9) : 0, head: 0, legBack: 0, legFront: 0, armFront: 0 };
    let lift = 0;
    let bodyAngle = 0;
    let bodyY = life ? -0.5 * Math.sin(elapsed * 1.7) : 0;
    if (!reduced)
      switch (this.id) {
        case 'walk':
        case 'run': {
          // Two identical steps a cycle: from the drawn stride (contact, body low) the legs swing
          // toward each other (passing, body high) and back. Never past the drawing, so no limp;
          // the arm and the tail sway once a cycle.
          const run = this.id === 'run';
          const swing = SWING[this.id];
          const step = (1 - Math.cos(2 * phase)) / 2;
          rotations.legBack = -swing * step;
          rotations.legFront = swing * step;
          rotations.armFront = (run ? 7 : 4.5) * s;
          rotations.head = -0.6 * step;
          rotations.tail = (run ? 4 : 2.5) * Math.sin(phase + 0.5);
          bodyY = -step * (run ? 3.4 : 2.2);
          bodyAngle = run ? 2.2 : 0.6;
          break;
        }
        case 'jump': {
          const p = t / clip.duration;
          lift = p < 0.18 ? -3 * Math.sin((p / 0.18) * Math.PI) : p < 0.86 ? 32 * Math.sin(((p - 0.18) / 0.68) * Math.PI) : 0;
          bodyY = p > 0.86 ? 2 * Math.sin(((p - 0.86) / 0.14) * Math.PI) : 0;
          rotations.legFront = -8 * Math.sin(p * Math.PI);
          rotations.legBack = 7 * Math.sin(p * Math.PI);
          rotations.armFront = -6 * Math.sin(p * Math.PI);
          break;
        }
        case 'sit':
          bodyY = life ? Math.sin(t * 1.2) * 0.6 : 0;
          rotations.head = life ? Math.sin(t) * 1.1 : 0;
          break;
        case 'rest':
          bodyY = life ? Math.sin(t * 1.1) * 1.1 : 0;
          rotations.head = life ? Math.sin(t * 1.1) * 1.3 : 0;
          break;
        case 'wave':
          rotations.armFront = 12 * Math.sin(t * TAU * 2.3) * Math.sin((Math.PI * t) / clip.duration);
          rotations.head = -2 * Math.sin((Math.PI * t) / clip.duration);
          break;
        case 'laugh':
          rotations.head = -2 + 2 * fast;
          rotations.armFront = 2 * fast;
          bodyY = -1.5 * Math.abs(fast);
          break;
        case 'think':
          rotations.head = -2 + 2 * s;
          rotations.armFront = 1.5 * s;
          break;
        case 'curious':
          rotations.head = 4 * s;
          bodyAngle = 0.5 * s;
          break;
        case 'celebrate':
          lift = 15 * Math.abs(Math.sin((t * Math.PI * 2) / clip.duration));
          rotations.armFront = 9 * fast;
          rotations.legFront = -6 * fast;
          rotations.head = -2;
          break;
        case 'holdSign':
          rotations.armFront = 0.65 * s;
          rotations.head = life ? 1.2 * s : 0;
          break;
        case 'point':
          rotations.armFront = Math.max(-15, Math.min(25, (this.playOptions.params?.aim ?? 0) * 0.35)) + 1.4 * s;
          rotations.head = -1;
          break;
        case 'draw':
          rotations.armFront = 3.5 * Math.sin(t * TAU * 2.4);
          rotations.head = 1.2 * Math.sin(t * 2);
          break;
      }
    // His head follows his eyes a little (a rigid turn about the neck, never a warp of the face).
    const sees = RASTER_RIGS[this.id].eyes !== undefined;
    // Up or down: a nod (clockwise lowers his nose, he faces right in his frame); ahead or behind: a slight tilt.
    if (sees) rotations.head += 4.5 * g.y + 1.4 * g.x;
    const head = sees ? { x: 2.4 * g.x, y: 1.8 * g.y } : { x: 0, y: 0 };
    const gaze = sees ? { x: 3 * g.x, y: 2.2 * g.y } : { x: 0, y: 0 };

    const svg = this.box.querySelector<SVGSVGElement>('svg[data-pose]');
    if (svg && svg.dataset.pose === this.id) {
      const joints = RASTER_RIGS[this.id];
      for (const [part, angle] of Object.entries(rotations) as [RasterPart, number][]) {
        const el = svg.querySelector(`[data-part="${part}"]`);
        const [x, y] = joints[part].pivot;
        el?.setAttribute('transform', rotate(angle, x, y));
      }
      svg.querySelector('[data-raster-body]')?.setAttribute('transform', `translate(0 ${(bodyY - lift).toFixed(2)}) rotate(${bodyAngle.toFixed(2)} 175 280)`);
    }

    const blink = life && elapsed % 4.7 > 4.52 ? Math.sin(((elapsed % 4.7) - 4.52) / 0.18 * Math.PI) : 0;
    if (!this.meshAttempted) {
      const canvas = this.box.querySelector<HTMLCanvasElement>('[data-raster-canvas]');
      if (canvas) {
        this.meshAttempted = true;
        try {
          this.mesh = new RasterMesh(canvas, () => {
            const fallback = this.box.querySelector<HTMLElement>('[data-raster-fallback]');
            if (fallback) fallback.style.visibility = 'hidden';
          });
        } catch {
          // Keep the official still artwork visible on devices without WebGL.
        }
      }
    }
    const motion: MeshMotion = { angles: rotations, bodyY: bodyY - lift, bodyAngle, gaze, head, blink };
    this.mesh?.draw(this.id, motion, !reduced);
    this.opts.onFrame?.({ lift, clip: this.id });
    if (!clip.loop && !reduced && elapsed >= clip.duration) this.finish();
  }
}
