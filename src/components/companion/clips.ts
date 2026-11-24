import type { AnimationId } from '@/lib/companion/model';
import type { Eyes, FxId, Mouth, PartId, PropId } from './rig';

// ─── Sketchy's animations (ADR-0024) ──────────────────────────────────────────
// Each clip is a pure function of time: the angle (degrees, clockwise), the
// offset and the scale of each part, his face, what he holds and what shows
// around him. The engine blends from one clip to the next, and adds what
// every clip shares (blinking, breathing, a little tail and ear life). Angles
// are in the figure's own frame: he faces right, so a negative angle swings a
// leg or an arm forward. `lift` raises the whole figure off the ground (a
// jump); `look` moves his eyes (-1…1 each way).

export interface PartPose {
  r?: number;
  x?: number;
  y?: number;
  sx?: number;
  sy?: number;
}

export interface Pose {
  parts: Partial<Record<PartId, PartPose>>;
  eyes?: Eyes;
  mouth?: Mouth;
  props?: PropId[];
  fx?: FxId[];
  /** Effects' own time (seconds), for their twinkle and fall. */
  fxT?: number;
  look?: { x: number; y: number };
  /** Units above the ground (a jump). */
  lift?: number;
  /** The clip moves on its own and the shared layers stay out of it. */
  still?: { breathe?: false; tail?: false; blink?: false };
}

export interface ClipParams {
  /** Where to point, in degrees (0: straight ahead, 90: straight down). */
  aim?: number;
  /** Walking or running: seconds per stride cycle, matched to how fast he moves across the screen (raster-engine.ts strideCycle). */
  cycle?: number;
}

export interface Clip {
  id: AnimationId;
  /** Seconds for one cycle (looping) or the whole clip (once). */
  duration: number;
  loop: boolean;
  /** Calm clips are drawn at about 30 frames a second. */
  calm?: boolean;
  /** For people who ask for less motion: the one moment shown, still. */
  stillAt: number;
  /** How far he travels per second (units), for walking and running. */
  speed?: number;
  sample: (t: number, params?: ClipParams) => Pose;
}

const TAU = Math.PI * 2;
const wave = (t: number, period: number, phase = 0) => Math.sin((t / period + phase) * TAU);
const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
/** Ease in and out between two values over a stretch of time. */
const ease = (k: number) => (k <= 0 ? 0 : k >= 1 ? 1 : k * k * (3 - 2 * k));
const between = (t: number, from: number, to: number) => ease((t - from) / (to - from));
const mix = (a: number, b: number, k: number) => a + (b - a) * k;
const DEG = 180 / Math.PI;

/** The two arms' joints at rest: shoulder, elbow and wrist (./rig.tsx PIVOTS). */
const ARMS = {
  front: { shoulder: [165, 139], elbow: [166, 166], wrist: [167, 187] },
  back: { shoulder: [103, 139], elbow: [101, 166], wrist: [101, 187] },
} as const;

/**
 * Angles that bring an arm's wrist to a point (two joints, law of cosines):
 * the upper arm's and the forearm's rotations, for `bend` 1 (elbow out and
 * down) or -1. A point out of reach is reached as far as the arm goes.
 */
function reach(arm: keyof typeof ARMS, target: readonly [number, number], bend: 1 | -1 = 1): { upper: number; fore: number } {
  const { shoulder: s, elbow: e, wrist: w } = ARMS[arm];
  const l1 = Math.hypot(e[0] - s[0], e[1] - s[1]);
  const l2 = Math.hypot(w[0] - e[0], w[1] - e[1]);
  const rest1 = Math.atan2(e[1] - s[1], e[0] - s[0]);
  const rest2 = Math.atan2(w[1] - e[1], w[0] - e[0]);
  const dx = target[0] - s[0];
  const dy = target[1] - s[1];
  const d = Math.min(l1 + l2 - 0.01, Math.max(Math.abs(l1 - l2) + 0.01, Math.hypot(dx, dy)));
  const phi = Math.atan2(dy, dx);
  const alpha = Math.acos((l1 * l1 + d * d - l2 * l2) / (2 * l1 * d));
  const upperDir = phi + bend * alpha;
  const elbow = [s[0] + l1 * Math.cos(upperDir), s[1] + l1 * Math.sin(upperDir)];
  const foreDir = Math.atan2(target[1] - elbow[1], target[0] - elbow[0]);
  const upper = (upperDir - rest1) * DEG;
  return { upper, fore: (foreDir - rest2) * DEG - upper };
}

const idle: Clip = {
  id: 'idle',
  duration: 4.8,
  loop: true,
  calm: true,
  stillAt: 0,
  sample: (t) => ({
    parts: {
      head: { r: 1.6 * wave(t, 4.8, 0.1), y: 0.5 * wave(t, 4.8) },
      armBack: { r: 1.2 * wave(t, 4.8) },
      armFront: { r: -1.2 * wave(t, 4.8, 0.2) },
      forearmFront: { r: -4 },
      scarfEnd: { r: 3 * wave(t, 2.4) },
      earFront: { r: 2 * wave(t, 4.8, 0.3) },
      earBack: { r: -2 * wave(t, 4.8, 0.5) },
    },
    eyes: 'open',
    mouth: 'smile',
    look: { x: 0.15 + 0.25 * wave(t, 9.6), y: 0.05 },
  }),
};

function walkPose(t: number, cycle: number, swing: number, knee: number, lean: number, bob: number, arm: number): Pose {
  const phi = (t / cycle) * TAU;
  const s = Math.sin(phi);
  const c = Math.cos(phi);
  return {
    parts: {
      body: { r: lean, y: -bob * 0.5 - bob * 0.5 * Math.cos(2 * phi) },
      legFront: { r: -swing * s },
      shinFront: { r: knee * Math.pow(Math.max(0, c), 1.4) },
      legBack: { r: swing * s },
      shinBack: { r: knee * Math.pow(Math.max(0, -c), 1.4) },
      armFront: { r: arm * s },
      forearmFront: { r: -12 - 6 * Math.max(0, -s) },
      armBack: { r: -arm * s },
      forearmBack: { r: -10 - 6 * Math.max(0, s) },
      head: { r: -lean * 0.4 + 1.2 * Math.sin(2 * phi), y: 0.6 },
      tail: { r: 6 * Math.sin(phi + 0.8) - lean * 0.6 },
      scarfEnd: { r: -10 + 6 * Math.sin(2 * phi) },
      earFront: { r: -3 + 2.5 * Math.sin(2 * phi + 0.5) },
      earBack: { r: 2.5 * Math.sin(2 * phi + 0.9) },
    },
  };
}

const walk: Clip = {
  id: 'walk',
  duration: 0.92,
  loop: true,
  stillAt: 0.23,
  speed: 84,
  sample: (t) => ({ ...walkPose(t, 0.92, 24, 42, 2.5, 2.6, 20), eyes: 'open', mouth: 'smile', look: { x: 0.6, y: 0 }, still: { tail: false } }),
};

const run: Clip = {
  id: 'run',
  duration: 0.5,
  loop: true,
  stillAt: 0.12,
  speed: 150,
  sample: (t) => {
    const pose = walkPose(t, 0.5, 36, 72, 10, 4.5, 42);
    pose.parts.forearmFront = { r: -70 };
    pose.parts.forearmBack = { r: -70 };
    pose.parts.tail = { r: -22 + 5 * wave(t, 0.25) };
    pose.parts.earFront = { r: 16 };
    pose.parts.earBack = { r: 12 };
    pose.parts.scarfEnd = { r: -30 + 8 * wave(t, 0.25) };
    return { ...pose, eyes: 'wide', mouth: 'open', fx: ['dust'], fxT: t, look: { x: 1, y: 0 }, still: { tail: false } };
  },
};

const jump: Clip = {
  id: 'jump',
  duration: 1.15,
  loop: false,
  stillAt: 0.55,
  sample: (t) => {
    const crouch = between(t, 0, 0.22) * (1 - between(t, 0.22, 0.32));
    const air = t > 0.28 && t < 0.86 ? Math.sin(((t - 0.28) / 0.58) * Math.PI) : 0;
    const land = between(t, 0.84, 0.92) * (1 - between(t, 0.95, 1.15));
    const tuck = between(t, 0.28, 0.45) * (1 - between(t, 0.7, 0.86));
    return {
      parts: {
        body: { y: 7 * crouch + 6 * land, sy: 1 - 0.05 * crouch - 0.05 * land + 0.05 * air * (1 - tuck), r: -2 * tuck },
        legFront: { r: -22 * crouch - 30 * tuck - 18 * land },
        shinFront: { r: 40 * crouch + 60 * tuck + 30 * land },
        legBack: { r: -16 * crouch - 18 * tuck - 14 * land },
        shinBack: { r: 34 * crouch + 52 * tuck + 26 * land },
        armFront: { r: 30 * crouch - 150 * air },
        forearmFront: { r: -20 * air },
        armBack: { r: 26 * crouch + 140 * air },
        forearmBack: { r: 20 * air },
        head: { r: -4 * air + 3 * crouch },
        tail: { r: -18 * air + 8 * crouch },
        earFront: { r: 10 * air },
        earBack: { r: 8 * air },
      },
      eyes: air > 0.2 ? 'happy' : 'open',
      mouth: air > 0.2 ? 'open' : 'smile',
      lift: 46 * air,
      still: { tail: false },
    };
  },
};

/** Sitting on the ground, feet forward: the base of sit and rest. */
const SEATED: Pose['parts'] = {
  body: { y: 21, r: -3 },
  legFront: { r: -72 },
  shinFront: { r: 72 },
  legBack: { r: -64 },
  shinBack: { r: 66 },
  armFront: { r: -24 },
  forearmFront: { r: -38 },
  armBack: { r: -16 },
  forearmBack: { r: -30 },
  tail: { r: 14, sy: 0.96 },
};

const sit: Clip = {
  id: 'sit',
  duration: 5.6,
  loop: true,
  calm: true,
  stillAt: 0,
  sample: (t) => ({
    parts: {
      ...SEATED,
      head: { r: 2 * wave(t, 5.6), y: 0.6 * wave(t, 5.6, 0.25) },
      scarfEnd: { r: 2 * wave(t, 2.8) },
      earFront: { r: 2 * wave(t, 5.6, 0.4) },
      earBack: { r: -2 * wave(t, 5.6, 0.1) },
    },
    eyes: 'open',
    mouth: 'grin',
    look: { x: 0.1 + 0.3 * wave(t, 11.2), y: 0.1 },
  }),
};

const rest: Clip = {
  id: 'rest',
  duration: 6,
  loop: true,
  calm: true,
  stillAt: 0,
  sample: (t) => ({
    parts: {
      ...SEATED,
      body: { y: 22, r: -1 },
      torso: { sy: 1 + 0.02 * wave(t, 3) },
      head: { r: 9 + 1.5 * wave(t, 3), y: 2.5 + 0.8 * wave(t, 3) },
      earFront: { r: 10 },
      earBack: { r: 8 },
      tail: { r: 18 + 2 * wave(t, 6), sy: 0.95 },
    },
    eyes: 'closed',
    mouth: 'flat',
    fx: ['zzz'],
    fxT: t,
    still: { breathe: false, blink: false },
  }),
};

const waveClip: Clip = {
  id: 'wave',
  duration: 1.8,
  loop: false,
  stillAt: 0.9,
  sample: (t) => {
    const up = between(t, 0, 0.25) * (1 - between(t, 1.55, 1.8));
    return {
      parts: {
        body: { r: -2 * up },
        armFront: { r: -152 * up },
        forearmFront: { r: (-18 + 24 * wave(t, 0.56)) * up },
        handFront: { r: 10 * wave(t, 0.56, 0.1) * up },
        armBack: { r: 6 * up },
        head: { r: -5 * up + 1.5 * wave(t, 0.56) * up },
        earFront: { r: -4 * up },
        tail: { r: 6 * wave(t, 0.9) },
      },
      eyes: 'happy',
      mouth: 'open',
      fx: up > 0.5 ? ['exclaim'] : [],
      fxT: t,
      look: { x: 0, y: 0 },
    };
  },
};

const laugh: Clip = {
  id: 'laugh',
  duration: 1.7,
  loop: false,
  stillAt: 0.6,
  sample: (t) => {
    const on = between(t, 0, 0.15) * (1 - between(t, 1.45, 1.7));
    const shake = wave(t, 0.16);
    return {
      parts: {
        body: { y: 1.6 * shake * on, r: -3 * on },
        head: { r: (-8 + 2.5 * shake) * on, y: -1 * on },
        armBack: { r: -18 * on },
        forearmBack: { r: -46 * on },
        armFront: { r: 6 * on },
        forearmFront: { r: -58 * on },
        tail: { r: 8 * wave(t, 0.34) },
        earFront: { r: 4 * shake * on },
        earBack: { r: -4 * shake * on },
      },
      eyes: on > 0.3 ? 'happy' : 'open',
      mouth: on > 0.3 ? 'open' : 'smile',
      still: { tail: false },
    };
  },
};

const THINK_ARM = reach('front', [151, 129], -1);

const think: Clip = {
  id: 'think',
  duration: 3.2,
  loop: true,
  calm: true,
  stillAt: 1,
  sample: (t) => ({
    parts: {
      armFront: { r: THINK_ARM.upper },
      forearmFront: { r: THINK_ARM.fore + 1.5 * wave(t, 1.6) },
      handFront: { r: -150 },
      armBack: { r: -12 },
      forearmBack: { r: -60 },
      head: { r: 7 + 1.5 * wave(t, 3.2), y: 0.5 },
      browNear: { y: -2.4 },
      browFar: { y: -1.2, r: -4 },
      earFront: { r: -5 },
      tail: { r: 4 * wave(t, 3.2) },
    },
    eyes: 'open',
    mouth: 'flat',
    look: { x: 0.55, y: -0.85 },
    fx: ['think'],
    fxT: t,
  }),
};

const curious: Clip = {
  id: 'curious',
  duration: 3,
  loop: true,
  calm: true,
  stillAt: 0.6,
  sample: (t) => ({
    parts: {
      body: { r: 4 },
      head: { r: -11 + 2 * wave(t, 3), y: -1 },
      earFront: { r: -9 },
      earBack: { r: 7 },
      browNear: { y: -2.6 },
      armFront: { r: -6 },
      forearmFront: { r: -30 },
      tail: { r: 7 * wave(t, 1.5) },
    },
    eyes: 'wide',
    mouth: 'o',
    look: { x: 0.9 * Math.sign(wave(t, 3)) || 0.9, y: -0.1 },
    fx: ['question'],
    fxT: t,
    still: { tail: false },
  }),
};

const celebrate: Clip = {
  id: 'celebrate',
  duration: 1.6,
  loop: false,
  stillAt: 0.55,
  sample: (t) => {
    const air = t > 0.2 && t < 0.78 ? Math.sin(((t - 0.2) / 0.58) * Math.PI) : 0;
    const crouch = between(t, 0, 0.16) * (1 - between(t, 0.16, 0.24)) + between(t, 0.76, 0.84) * (1 - between(t, 0.9, 1.1));
    const arms = between(t, 0.1, 0.3) * (1 - between(t, 1.3, 1.6));
    return {
      parts: {
        body: { y: 6 * crouch, sy: 1 - 0.05 * crouch },
        legFront: { r: -20 * crouch - 26 * air },
        shinFront: { r: 36 * crouch + 50 * air },
        legBack: { r: -14 * crouch - 16 * air },
        shinBack: { r: 30 * crouch + 44 * air },
        armFront: { r: -150 * arms },
        forearmFront: { r: -12 * arms + 8 * wave(t, 0.3) * arms },
        armBack: { r: 146 * arms },
        forearmBack: { r: 12 * arms - 8 * wave(t, 0.3) * arms },
        head: { r: -5 * arms },
        tail: { r: -14 * air + 10 * wave(t, 0.4) },
        earFront: { r: 8 * air },
        earBack: { r: 6 * air },
      },
      eyes: 'happy',
      mouth: 'open',
      lift: 38 * air,
      fx: ['confetti', 'sparkles'],
      fxT: t,
      still: { tail: false },
    };
  },
};

const holdSign: Clip = {
  id: 'holdSign',
  duration: 3.6,
  loop: true,
  calm: true,
  stillAt: 0,
  sample: (t) => ({
    parts: {
      armFront: { r: -164 },
      forearmFront: { r: 6 + 1.5 * wave(t, 3.6) },
      handFront: { r: -22 },
      armBack: { r: 22 },
      forearmBack: { r: -72 },
      handBack: { r: -20 },
      head: { r: -3 + 1.2 * wave(t, 3.6, 0.2), y: 0.4 * wave(t, 3.6) },
      body: { r: -1.5 },
      earFront: { r: 2 * wave(t, 3.6, 0.5) },
      earBack: { r: -2 * wave(t, 3.6) },
      scarfEnd: { r: 2 * wave(t, 2.4) },
    },
    eyes: 'open',
    mouth: 'smile',
    props: ['sign'],
    look: { x: 0.2, y: -0.15 },
  }),
};

const point: Clip = {
  id: 'point',
  duration: 2.4,
  loop: true,
  calm: true,
  stillAt: 0.3,
  sample: (t, params) => {
    // 0° = straight ahead (his right), 90° = straight down.
    const aim = params?.aim ?? 20;
    const nudge = 2.5 * Math.max(0, wave(t, 1.2));
    return {
      parts: {
        body: { r: 2 },
        armFront: { r: -90 + aim - nudge },
        forearmFront: { r: -4 },
        handFront: { r: -6 },
        armBack: { r: 10 },
        forearmBack: { r: -20 },
        head: { r: Math.max(-6, Math.min(10, aim * 0.15)) },
        earFront: { r: -4 },
        tail: { r: 4 * wave(t, 2.4) },
      },
      eyes: 'open',
      mouth: 'smile',
      props: ['finger'],
      look: { x: Math.cos((aim * Math.PI) / 180), y: Math.sin((aim * Math.PI) / 180) * 0.9 },
      fx: ['sparkles'],
      fxT: t,
    };
  },
};

const DRAW_ARM = reach('front', [150, 160], 1);

const draw: Clip = {
  id: 'draw',
  duration: 2.4,
  loop: true,
  stillAt: 0.4,
  sample: (t) => {
    const scribble = wave(t, 0.36);
    return {
      parts: {
        armFront: { r: DRAW_ARM.upper + 2 * wave(t, 1.2) },
        forearmFront: { r: DRAW_ARM.fore + 6 * scribble },
        handFront: { r: 40 + 8 * wave(t, 0.18) },
        armBack: { r: -10 },
        forearmBack: { r: -30 },
        head: { r: 9 + 1.2 * wave(t, 2.4), y: 1.5 },
        earFront: { r: -3 + 2 * wave(t, 2.4) },
      },
      eyes: 'open',
      mouth: 'tongue',
      props: ['pad', 'pencil'],
      look: { x: 0.1, y: 0.95 },
    };
  },
};

export const CLIPS: Record<AnimationId, Clip> = {
  idle,
  walk,
  run,
  jump,
  sit,
  rest,
  wave: waveClip,
  laugh,
  think,
  curious,
  celebrate,
  holdSign,
  point,
  draw,
};

export { clamp01, mix };
