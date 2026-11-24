import type { AnimationId } from '@/lib/companion/model';
import { CLIPS, type ClipParams, type PartPose, type Pose } from './clips';
import { EYES, FX, MOUTHS, PART_IDS, PIVOTS, PROPS, type Eyes, type FxId, type Mouth, type PartId, type PropId } from './rig';

// ─── The pose engine (ADR-0024) ───────────────────────────────────────────────
// Plays one clip at a time on a rig (./rig.tsx), blending from wherever he
// was into the new clip so nothing jumps, and lays the shared life on top:
// blinking, breathing, a tail that sways and ears that twitch now and then.
// It writes only `transform` attributes and `display` on the rig's own
// groups (a handful per frame, skipped when unchanged), draws calm clips at
// about 30 frames a second, and stops completely when he is still, the page
// is hidden or he is off screen (the owner calls `pause`). With reduced
// motion it draws each clip once, at its still moment, and never loops.

export interface EngineOptions {
  reducedMotion?: boolean;
  /** Blinking, breathing, tail and ears. */
  idleLife?: boolean;
  /** Called every frame with how high he is (for the stage's shadow and sign). */
  onFrame?: (state: { lift: number; clip: AnimationId }) => void;
}

interface Playing {
  id: AnimationId;
  params?: ClipParams;
  startedAt: number;
  onEnd?: () => void;
  ended: boolean;
}

const BLEND_MS = 240;
type Channels = Required<PartPose>;
const REST: Channels = { r: 0, x: 0, y: 0, sx: 1, sy: 1 };

const lerp = (a: number, b: number, k: number) => a + (b - a) * k;
const smooth = (k: number) => k * k * (3 - 2 * k);

function full(pose: PartPose | undefined): Channels {
  return { r: pose?.r ?? 0, x: pose?.x ?? 0, y: pose?.y ?? 0, sx: pose?.sx ?? 1, sy: pose?.sy ?? 1 };
}

function transformOf(part: PartId, c: Channels): string {
  const [px, py] = PIVOTS[part];
  if (c.r === 0 && c.x === 0 && c.y === 0 && c.sx === 1 && c.sy === 1) return '';
  const r = (v: number) => Math.round(v * 100) / 100;
  return `translate(${r(px + c.x)} ${r(py + c.y)}) rotate(${r(c.r)}) scale(${r(c.sx)} ${r(c.sy)}) translate(${-px} ${-py})`;
}

export class SketchyEngine {
  private readonly parts = new Map<PartId, SVGGElement>();
  private readonly eyeGroups: SVGGElement[] = [];
  private readonly eyeAlts = new Map<Eyes, SVGGElement>();
  private readonly mouths = new Map<Mouth, SVGGElement>();
  private readonly props = new Map<PropId, SVGGElement>();
  private readonly fx = new Map<FxId, SVGGElement>();
  private readonly figure: SVGGElement | null;
  private readonly shadow: SVGEllipseElement | null;

  private playing: Playing;
  /** The pose blended from, frozen when a new clip starts. */
  private from: { parts: Map<PartId, Channels>; lift: number } | null = null;
  private blendStart = 0;
  private last: { parts: Map<PartId, Channels>; lift: number } = { parts: new Map(), lift: 0 };
  private raf = 0;
  private lastFrame = 0;
  private paused = false;
  private disposed = false;
  private lookOverride: { x: number; y: number } | null = null;
  private nextBlink = 0;
  private blinkUntil = 0;
  private nextTwitch = 0;
  private twitchUntil = 0;
  private options: EngineOptions;

  constructor(
    private readonly svg: SVGSVGElement,
    options: EngineOptions = {},
  ) {
    this.options = { idleLife: true, ...options };
    for (const el of svg.querySelectorAll<SVGGElement>('[data-part]')) {
      const id = el.dataset.part as PartId;
      if ((PART_IDS as string[]).includes(id)) this.parts.set(id, el);
    }
    for (const el of svg.querySelectorAll<SVGGElement>('[data-eyes]')) this.eyeGroups.push(el);
    for (const el of svg.querySelectorAll<SVGGElement>('[data-eyes-alt]')) this.eyeAlts.set(el.dataset.eyesAlt as Eyes, el);
    for (const el of svg.querySelectorAll<SVGGElement>('[data-mouth]')) this.mouths.set(el.dataset.mouth as Mouth, el);
    for (const el of svg.querySelectorAll<SVGGElement>('[data-prop]')) this.props.set(el.dataset.prop as PropId, el);
    for (const el of svg.querySelectorAll<SVGGElement>('[data-fx]')) this.fx.set(el.dataset.fx as FxId, el);
    this.shadow = svg.querySelector('[data-part-shadow]');
    this.figure = svg.querySelector('[data-part="body"]');
    this.playing = { id: 'idle', startedAt: performance.now(), ended: false };
    this.scheduleBlink(performance.now());
    this.nextTwitch = performance.now() + 4000 + Math.random() * 5000;
  }

  /** The clip playing now. */
  get clip(): AnimationId {
    return this.playing.id;
  }

  setOptions(options: Partial<EngineOptions>) {
    this.options = { ...this.options, ...options };
    this.kick();
  }

  /** Play a clip from its start, blending in from the current pose. `onEnd` is called when a clip that does not loop finishes. */
  play(id: AnimationId, opts: { params?: ClipParams; onEnd?: () => void; restart?: boolean } = {}) {
    if (this.disposed) return;
    const same = this.playing.id === id && !this.playing.ended && JSON.stringify(this.playing.params ?? null) === JSON.stringify(opts.params ?? null);
    if (same && !opts.restart) {
      this.playing.onEnd = opts.onEnd;
      return;
    }
    const now = performance.now();
    this.from = { parts: new Map(this.last.parts), lift: this.last.lift };
    this.blendStart = now;
    this.playing = { id, params: opts.params, startedAt: now, onEnd: opts.onEnd, ended: false };
    if (this.options.reducedMotion) {
      // One still frame, then (for a clip that ends) the end at once.
      this.from = null;
      this.render(now);
      const end = opts.onEnd;
      if (!CLIPS[id].loop && end) window.setTimeout(end, 600);
      return;
    }
    this.kick();
  }

  /** Where his eyes look (-1…1 each way), or back to what the clip wants. */
  look(target: { x: number; y: number } | null) {
    this.lookOverride = target;
    if (this.options.reducedMotion) this.render(performance.now());
    else this.kick();
  }

  /** Stop drawing (hidden page, off screen); `resume` carries on where he was. */
  pause() {
    this.paused = true;
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  resume() {
    this.paused = false;
    this.kick();
  }

  dispose() {
    this.disposed = true;
    this.pause();
  }

  /** Draw the current moment once (also used by tests and previews). */
  renderNow() {
    this.render(performance.now());
  }

  /** Draw one moment of a clip, without blending (previews, contact sheets, tests). */
  renderAt(id: AnimationId, t: number, params?: ClipParams) {
    const now = performance.now();
    this.playing = { id, params, startedAt: now - t * 1000, ended: true };
    this.from = null;
    this.render(now);
  }

  private kick() {
    if (this.disposed || this.paused) return;
    if (this.options.reducedMotion) {
      this.render(performance.now());
      return;
    }
    if (!this.raf) this.raf = requestAnimationFrame(this.frame);
  }

  private frame = (now: number) => {
    this.raf = 0;
    if (this.disposed || this.paused) return;
    const clip = CLIPS[this.playing.id];
    const blending = this.from !== null && now - this.blendStart < BLEND_MS;
    // Calm clips (standing, sitting, thinking…) at about 30 frames a second.
    if (clip.calm && !blending && now - this.lastFrame < 30) {
      this.raf = requestAnimationFrame(this.frame);
      return;
    }
    this.lastFrame = now;
    this.render(now);
    this.raf = requestAnimationFrame(this.frame);
  };

  private scheduleBlink(now: number) {
    this.nextBlink = now + 2200 + Math.random() * 4200;
  }

  private render(now: number) {
    const clip = CLIPS[this.playing.id];
    const reduced = this.options.reducedMotion === true;
    let t = reduced ? clip.stillAt : (now - this.playing.startedAt) / 1000;
    if (!clip.loop && !reduced && t >= clip.duration) {
      t = clip.duration;
      if (!this.playing.ended) {
        this.playing.ended = true;
        const end = this.playing.onEnd;
        if (end) queueMicrotask(end);
      }
    } else if (clip.loop && !reduced) {
      t = t % clip.duration;
    }
    const pose: Pose = clip.sample(t, this.playing.params);
    const life = this.options.idleLife !== false && !reduced;

    // Shared life on top of the clip.
    const extra = new Map<PartId, Partial<Channels>>();
    const add = (part: PartId, c: Partial<Channels>) => extra.set(part, { ...(extra.get(part) ?? {}), ...c });
    const seconds = now / 1000;
    if (life && pose.still?.breathe !== false) add('torso', { sy: 1 + 0.012 * Math.sin(seconds * 1.6) });
    if (life && pose.still?.tail !== false) add('tail', { r: 3.2 * Math.sin(seconds * 1.9) });
    let blink = 1;
    if (life && pose.still?.blink !== false && (pose.eyes ?? 'open') !== 'happy' && pose.eyes !== 'closed') {
      if (now >= this.nextBlink && now > this.blinkUntil) {
        this.blinkUntil = now + 150;
        this.scheduleBlink(now);
        // Now and then a double blink.
        if (Math.random() < 0.2) this.nextBlink = now + 320;
      }
      if (now < this.blinkUntil) blink = 0.12;
    }
    if (life) {
      if (now >= this.nextTwitch && now > this.twitchUntil) {
        this.twitchUntil = now + 260;
        this.nextTwitch = now + 5000 + Math.random() * 7000;
      }
      if (now < this.twitchUntil) add(Math.random() < 0.5 ? 'earFront' : 'earBack', { r: 9 * Math.sin(((this.twitchUntil - now) / 260) * Math.PI * 3) });
    }

    // Target channels for every part, then the blend from where he was.
    const blendK = this.from && !reduced ? smooth(Math.min(1, (now - this.blendStart) / BLEND_MS)) : 1;
    if (blendK >= 1) this.from = null;
    const next = new Map<PartId, Channels>();
    for (const part of PART_IDS) {
      const target = full(pose.parts[part]);
      const e = extra.get(part);
      if (e) {
        target.r += e.r ?? 0;
        target.sy *= e.sy ?? 1;
      }
      const was = this.from?.parts.get(part) ?? REST;
      const c: Channels = blendK >= 1 ? target : { r: lerp(was.r, target.r, blendK), x: lerp(was.x, target.x, blendK), y: lerp(was.y, target.y, blendK), sx: lerp(was.sx, target.sx, blendK), sy: lerp(was.sy, target.sy, blendK) };
      next.set(part, c);
    }
    // Eyes: the look moves the irises; a blink closes both.
    const look = this.lookOverride ?? pose.look ?? { x: 0.15, y: 0 };
    const lookNow = { x: Math.max(-1, Math.min(1, look.x)), y: Math.max(-1, Math.min(1, look.y)) };
    next.set('irisNear', { ...REST, x: lookNow.x * 4.2 - 1.4, y: lookNow.y * 3.2 });
    next.set('irisFar', { ...REST, x: lookNow.x * 2.4 - 1, y: lookNow.y * 3 });
    const wide = (pose.eyes ?? 'open') === 'wide' ? 1.1 : 1;
    next.set('eyeNear', { ...REST, sx: wide, sy: wide * blink });
    next.set('eyeFar', { ...REST, sx: wide, sy: wide * blink });

    const lift = this.from && blendK < 1 ? lerp(this.from.lift, pose.lift ?? 0, blendK) : (pose.lift ?? 0);
    this.last = { parts: next, lift };

    for (const [part, el] of this.parts) if (part !== 'body') this.write(el, 'transform', transformOf(part, next.get(part) ?? REST));
    if (this.figure) {
      // The jump lifts the whole figure; the body's own pose is inside it.
      const body = next.get('body') ?? REST;
      this.write(this.figure, 'transform', transformOf('body', { ...body, y: body.y - lift }));
    }
    if (this.shadow) {
      const k = Math.max(0.45, 1 - lift / 90);
      this.write(this.shadow, 'transform', k === 1 ? '' : `translate(133 252) scale(${k.toFixed(3)}) translate(-133 -252)`);
      this.write(this.shadow, 'opacity', k === 1 ? '' : k.toFixed(2));
    }

    // Face, props and effects: shown or hidden.
    const eyes: Eyes = blendK < 0.5 && this.from ? (pose.eyes ?? 'open') : (pose.eyes ?? 'open');
    const alt = eyes === 'happy' || eyes === 'closed' ? eyes : null;
    for (const el of this.eyeGroups) this.show(el, alt === null);
    for (const name of EYES) {
      const el = this.eyeAlts.get(name);
      if (el) this.show(el, alt === name);
    }
    const mouth = pose.mouth ?? 'smile';
    for (const name of MOUTHS) {
      const el = this.mouths.get(name);
      if (el) this.show(el, name === mouth);
    }
    const props = new Set(pose.props ?? []);
    for (const name of PROPS) {
      const el = this.props.get(name);
      if (el) this.show(el, props.has(name) && (blendK > 0.35 || !this.from));
    }
    const fx = new Set(pose.fx ?? []);
    const fxT = reduced ? 0.4 : (pose.fxT ?? seconds);
    for (const name of FX) {
      const el = this.fx.get(name);
      if (!el) continue;
      const on = fx.has(name);
      this.show(el, on);
      if (on && !reduced) this.write(el, 'transform', fxTransform(name, fxT));
    }
    this.options.onFrame?.({ lift, clip: this.playing.id });
  }

  private show(el: Element, on: boolean) {
    this.write(el, 'style', on ? '' : 'display:none');
  }

  /** Set an attribute only when it changes (most frames change only a few). */
  private write(el: Element, attr: 'transform' | 'style' | 'opacity', value: string) {
    const held = el as Element & { __sk?: Record<string, string> };
    held.__sk ??= {};
    if (held.__sk[attr] === value) return;
    held.__sk[attr] = value;
    if (value === '') el.removeAttribute(attr);
    else el.setAttribute(attr, value);
  }
}

/** The effects' own little motion: twinkling, floating up, falling. */
function fxTransform(name: FxId, t: number): string {
  switch (name) {
    case 'sparkles': {
      const k = 0.85 + 0.2 * Math.sin(t * 9);
      return `translate(120 70) scale(${k.toFixed(3)}) translate(-120 -70)`;
    }
    case 'confetti':
      return `translate(0 ${((t * 60) % 80).toFixed(1)})`;
    case 'zzz':
      return `translate(${(3 * Math.sin(t * 1.4)).toFixed(1)} ${(-((t * 6) % 14)).toFixed(1)})`;
    case 'think':
    case 'question':
      return `translate(0 ${(2 * Math.sin(t * 2.4)).toFixed(1)})`;
    case 'exclaim': {
      const k = 0.9 + 0.15 * Math.sin(t * 14);
      return `translate(190 16) scale(${k.toFixed(3)}) translate(-190 -16)`;
    }
    case 'dust':
      return `translate(${(-((t * 80) % 30)).toFixed(1)} 0)`;
    default:
      return '';
  }
}

export type { AnimationId };
export { EYES, FX, MOUTHS, PROPS };
