// The framed artwork, drawn at a given scale (pixels per centimetre): the
// moulding (four mitred sides whose grain runs along each side, or a ring for a
// round piece), its profile and the light falling on it from the upper left,
// the mat with its bevelled window, the shadows the frame casts inward, and the
// artwork itself, never recoloured. The wall shadow is the scene's (scene.ts).

import { finishOf, type Finish, type FrameSpec } from '../types';
import { css, ctxOf, makeCanvas, mix, overlayGrain, rgbOf, rng, shade, type Ctx, type RGB } from './util';

export interface FrameGeometry {
  /** Outer size, cm. */
  outerW: number;
  outerH: number;
  /** Moulding face, mat border and floating gap, cm. */
  face: number;
  mat: number;
  gap: number;
}

export function frameGeometry(artW: number, artH: number, frame: FrameSpec): FrameGeometry {
  const face = frame.type === 'frameless' ? 0 : Math.max(0.3, frame.widthCm);
  const mat = frame.type === 'classic' && frame.mat.enabled ? Math.max(0, frame.mat.widthCm) : 0;
  const gap = frame.type === 'floating' ? Math.max(0, frame.gapCm) : 0;
  return { outerW: artW + 2 * (face + mat + gap), outerH: artH + 2 * (face + mat + gap), face, mat, gap };
}

// ── materials ───────────────────────────────────────────────────────────────
const STRIP_LEN = 1024;
const STRIP_W = 96;
/** The length of moulding one strip covers, cm (keeps the grain's scale real). */
const STRIP_CM = 55;
const strips = new Map<string, HTMLCanvasElement>();

/** A strip of the material, grain along its length (seamless lengthwise). */
function materialStrip(finish: Finish, variant: number): HTMLCanvasElement {
  const key = `${finish.id}:${variant}`;
  const hit = strips.get(key);
  if (hit) return hit;
  const canvas = makeCanvas(STRIP_LEN, STRIP_W);
  const ctx = ctxOf(canvas);
  const img = ctx.createImageData(STRIP_LEN, STRIP_W);
  const random = rng(1000 + variant * 97 + finish.id.length * 13);
  const base = rgbOf(finish.base);
  const dark = rgbOf(finish.dark);
  const light = rgbOf(finish.light);
  // Fibres: a smoothed random brightness per row.
  const rows = new Float32Array(STRIP_W);
  for (let y = 0; y < STRIP_W; y++) rows[y] = random() * 2 - 1;
  for (let pass = 0; pass < (finish.kind === 'metal' ? 1 : 2); pass++)
    for (let y = 1; y < STRIP_W - 1; y++) rows[y] = (rows[y - 1] + rows[y] * 2 + rows[y + 1]) / 4;
  const p1 = random() * 6.283;
  const p2 = random() * 6.283;
  const p3 = random() * 6.283;
  const rings = 4 + random() * 4;
  for (let y = 0; y < STRIP_W; y++) {
    const v = y / STRIP_W;
    for (let x = 0; x < STRIP_LEN; x++) {
      const u = x / STRIP_LEN;
      let k: number;
      if (finish.kind === 'wood') {
        const wave = 0.9 * Math.sin(6.283 * 2 * u + p1 + v * 1.4) + 0.45 * Math.sin(6.283 * 5 * u + p2 + v * 2.3) + 0.18 * Math.sin(6.283 * 13 * u + p3);
        const ring = v * rings + wave * 0.55;
        const t = ring - Math.floor(ring);
        const line = Math.pow(Math.max(0, Math.cos(t * 6.283)), 8);
        k = 0.54 + 0.12 * rows[y] - 0.18 * line + 0.025 * Math.sin(6.283 * 41 * u + y * 0.9);
      } else if (finish.kind === 'metal') {
        k = 0.5 + 0.22 * rows[y] + 0.08 * Math.sin(6.283 * 3 * u + p1) * Math.cos(6.283 * 2 * u + p2);
      } else {
        k = 0.5 + 0.03 * rows[y];
      }
      const c: RGB = k < 0.5 ? mix(dark, base, Math.max(0, k * 2)) : mix(base, light, Math.min(1, (k - 0.5) * 2));
      const i = (y * STRIP_LEN + x) * 4;
      img.data[i] = c[0];
      img.data[i + 1] = c[1];
      img.data[i + 2] = c[2];
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  strips.set(key, canvas);
  return canvas;
}

/** Across the moulding, outer edge (0) to inner edge (1): rounded profile, ridge, inner slope, lip. */
function profileStops(kind: Finish['kind']): [number, string][] {
  const k = kind === 'metal' ? 1.6 : kind === 'paint' ? 0.75 : 1;
  const w = (a: number) => `rgba(255,255,255,${Math.min(0.9, a * k).toFixed(3)})`;
  const b = (a: number) => `rgba(0,0,0,${Math.min(0.9, a * k).toFixed(3)})`;
  return [
    [0, b(0.44)], [0.035, w(0.3)], [0.09, w(0.1)],
    [0.76, b(0.02)], [0.88, b(0.08)], [0.92, w(0.16)], [1, b(0.48)],
  ];
}

/** Light from the upper left: how much each side brightens (+) or darkens (−). */
const SIDE_LIGHT = { top: 0.1, left: 0.04, right: -0.1, bottom: -0.2 } as const;

function sideTint(ctx: Ctx, amount: number, w: number, h: number): void {
  ctx.fillStyle = amount >= 0 ? `rgba(255,255,255,${amount})` : `rgba(0,0,0,${-amount})`;
  ctx.fillRect(0, 0, w, h);
}

/** Rectangular moulding: four mitred trapezoids, each with its grain, profile and light. */
function drawMoulding(ctx: Ctx, finish: Finish, W: number, H: number, F: number, s: number): void {
  const sides: { name: keyof typeof SIDE_LIGHT; poly: [number, number][]; len: number; transform: [number, number, number, number, number, number] }[] = [
    { name: 'top', poly: [[0, 0], [W, 0], [W - F, F], [F, F]], len: W, transform: [1, 0, 0, 1, 0, 0] },
    { name: 'right', poly: [[W, 0], [W, H], [W - F, H - F], [W - F, F]], len: H, transform: [0, 1, -1, 0, W, 0] },
    { name: 'bottom', poly: [[W, H], [0, H], [F, H - F], [W - F, H - F]], len: W, transform: [-1, 0, 0, -1, W, H] },
    { name: 'left', poly: [[0, H], [0, 0], [F, F], [F, H - F]], len: H, transform: [0, -1, 1, 0, 0, H] },
  ];
  sides.forEach((side, i) => {
    ctx.save();
    ctx.beginPath();
    side.poly.forEach(([x, y], j) => (j ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.closePath();
    ctx.clip();
    ctx.transform(...side.transform);
    const strip = materialStrip(finish, i);
    const pattern = ctx.createPattern(strip, 'repeat-x');
    if (pattern && typeof DOMMatrix !== 'undefined') {
      const kx = (STRIP_CM * s) / STRIP_LEN;
      pattern.setTransform(new DOMMatrix().translate(-i * 137 * kx, 0).scale(kx, F / STRIP_W));
      ctx.fillStyle = pattern;
    } else ctx.fillStyle = finish.base;
    ctx.fillRect(0, 0, side.len, F);
    const g = ctx.createLinearGradient(0, 0, 0, F);
    for (const [at, color] of profileStops(finish.kind)) g.addColorStop(at, color);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, side.len, F);
    sideTint(ctx, SIDE_LIGHT[side.name] * (finish.kind === 'metal' ? 1.3 : 1), side.len, F);
    ctx.restore();
  });
  // Mitre joints and the outer edge.
  ctx.save();
  ctx.strokeStyle = 'rgba(0,0,0,0.28)';
  ctx.lineWidth = Math.max(0.7, s * 0.025);
  ctx.beginPath();
  ctx.moveTo(0, 0); ctx.lineTo(F, F);
  ctx.moveTo(W, 0); ctx.lineTo(W - F, F);
  ctx.moveTo(W, H); ctx.lineTo(W - F, H - F);
  ctx.moveTo(0, H); ctx.lineTo(F, H - F);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(0,0,0,0.35)';
  ctx.lineWidth = Math.max(1, s * 0.04);
  ctx.strokeRect(0, 0, W, H);
  ctx.restore();
}

/** Round moulding: a ring with concentric grain (or a turned-metal sheen), profile and light. */
function drawRing(ctx: Ctx, finish: Finish, R: number, F: number, s: number): void {
  const c = R;
  const Ri = R - F;
  const ring = () => {
    ctx.beginPath();
    ctx.arc(c, c, R, 0, Math.PI * 2);
    ctx.arc(c, c, Math.max(0, Ri), 0, Math.PI * 2, true);
  };
  ctx.save();
  ring();
  ctx.clip();
  ctx.fillStyle = finish.base;
  ctx.fillRect(0, 0, 2 * R, 2 * R);
  const random = rng(4242 + finish.id.length);
  if (finish.kind === 'wood' || finish.kind === 'metal') {
    const step = Math.max(0.6, s * (finish.kind === 'wood' ? 0.09 : 0.04));
    for (let r = Ri; r < R; r += step) {
      const k = random();
      ctx.strokeStyle = k < 0.5 ? css(rgbOf(finish.dark), (finish.kind === 'wood' ? 0.35 : 0.18) * (1 - k)) : css(rgbOf(finish.light), 0.22 * k);
      ctx.lineWidth = step * (0.4 + random() * 0.8);
      ctx.beginPath();
      ctx.arc(c, c, r, 0, Math.PI * 2);
      ctx.stroke();
    }
  }
  if (finish.kind === 'metal') {
    const conic = (ctx as Ctx & { createConicGradient?: (a: number, x: number, y: number) => CanvasGradient }).createConicGradient;
    if (conic) {
      const g = conic.call(ctx, -Math.PI / 4, c, c);
      [[0, 0.35], [0.12, -0.25], [0.25, 0.3], [0.4, -0.3], [0.55, 0.28], [0.7, -0.2], [0.85, 0.32], [1, 0.35]].forEach(([at, a]) =>
        g.addColorStop(at, a >= 0 ? `rgba(255,255,255,${a})` : `rgba(0,0,0,${-a})`),
      );
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, 2 * R, 2 * R);
    }
  }
  // Profile: outer edge (at R) to inner edge (at Ri).
  const g = ctx.createRadialGradient(c, c, Math.max(0, Ri), c, c, R);
  for (const [at, color] of profileStops(finish.kind)) g.addColorStop(1 - at, color);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 2 * R, 2 * R);
  const light = ctx.createLinearGradient(0, 0, 2 * R, 2 * R);
  light.addColorStop(0, 'rgba(255,255,255,0.16)');
  light.addColorStop(0.5, 'rgba(255,255,255,0)');
  light.addColorStop(1, 'rgba(0,0,0,0.26)');
  ctx.fillStyle = light;
  ctx.fillRect(0, 0, 2 * R, 2 * R);
  ctx.restore();
  ctx.save();
  ctx.strokeStyle = 'rgba(0,0,0,0.35)';
  ctx.lineWidth = Math.max(1, s * 0.04);
  ctx.beginPath();
  ctx.arc(c, c, R - ctx.lineWidth / 2, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

/** The shape a region is cut to: a rectangle or a circle. */
function shapePath(ctx: Ctx, round: boolean, x: number, y: number, w: number, h: number): void {
  ctx.beginPath();
  if (round) ctx.arc(x + w / 2, y + h / 2, Math.min(w, h) / 2, 0, Math.PI * 2);
  else ctx.rect(x, y, w, h);
}

/**
 * A shadow cast inside a region (by the frame's lip, or onto a recess), light
 * from the upper left: the region is clipped, and a band around it, drawn
 * outside, throws its shadow in.
 */
function innerShadow(ctx: Ctx, round: boolean, x: number, y: number, w: number, h: number, blur: number, dx: number, dy: number, alpha: number): void {
  ctx.save();
  shapePath(ctx, round, x, y, w, h);
  ctx.clip();
  ctx.shadowColor = `rgba(0,0,0,${alpha})`;
  ctx.shadowBlur = blur;
  ctx.shadowOffsetX = dx;
  ctx.shadowOffsetY = dy;
  const pad = blur * 3 + Math.abs(dx) + Math.abs(dy) + 4;
  ctx.beginPath();
  ctx.rect(x - pad, y - pad, w + 2 * pad, h + 2 * pad);
  if (round) ctx.arc(x + w / 2, y + h / 2, Math.min(w, h) / 2, 0, Math.PI * 2, true);
  else {
    ctx.moveTo(x, y);
    ctx.lineTo(x, y + h);
    ctx.lineTo(x + w, y + h);
    ctx.lineTo(x + w, y);
    ctx.closePath();
  }
  ctx.fillStyle = '#000';
  ctx.fill('evenodd');
  ctx.restore();
}

function drawArt(ctx: Ctx, art: CanvasImageSource, round: boolean, x: number, y: number, w: number, h: number): void {
  ctx.save();
  shapePath(ctx, round, x, y, w, h);
  ctx.clip();
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(art, x, y, w, h);
  ctx.restore();
}

/** The mat: its colour and paper, and the bevelled window cut around the artwork (core lit from the upper left). */
function drawMat(ctx: Ctx, round: boolean, color: string, x: number, y: number, w: number, h: number, win: { x: number; y: number; w: number; h: number }, s: number): void {
  const base = rgbOf(color);
  ctx.save();
  shapePath(ctx, round, x, y, w, h);
  ctx.fillStyle = css(base);
  ctx.fill();
  ctx.clip();
  overlayGrain(ctx, x, y, w, h, 0.07, 1, 11);
  const bevel = Math.max(1.2, 0.24 * s);
  const core: RGB = mix(base, [248, 246, 240], 0.65);
  if (round) {
    const cx = win.x + win.w / 2;
    const cy = win.y + win.h / 2;
    const r = win.w / 2;
    ctx.beginPath();
    ctx.arc(cx, cy, r + bevel, 0, Math.PI * 2);
    ctx.fillStyle = css(core);
    ctx.fill();
    const g = ctx.createLinearGradient(cx - r, cy - r, cx + r, cy + r);
    g.addColorStop(0, 'rgba(255,255,255,0.35)');
    g.addColorStop(0.5, 'rgba(255,255,255,0)');
    g.addColorStop(1, 'rgba(0,0,0,0.18)');
    ctx.fillStyle = g;
    ctx.fill();
  } else {
    const o = { x: win.x - bevel, y: win.y - bevel, w: win.w + 2 * bevel, h: win.h + 2 * bevel };
    const tri = (pts: [number, number][], tint: number) => {
      ctx.beginPath();
      pts.forEach(([px, py], j) => (j ? ctx.lineTo(px, py) : ctx.moveTo(px, py)));
      ctx.closePath();
      ctx.fillStyle = css(shade(core, tint));
      ctx.fill();
    };
    tri([[o.x, o.y], [o.x + o.w, o.y], [win.x + win.w, win.y], [win.x, win.y]], 0.35);
    tri([[o.x, o.y], [win.x, win.y], [win.x, win.y + win.h], [o.x, o.y + o.h]], 0.2);
    tri([[o.x + o.w, o.y], [o.x + o.w, o.y + o.h], [win.x + win.w, win.y + win.h], [win.x + win.w, win.y]], -0.08);
    tri([[o.x, o.y + o.h], [win.x, win.y + win.h], [win.x + win.w, win.y + win.h], [o.x + o.w, o.y + o.h]], -0.14);
  }
  ctx.restore();
}

export interface FramedOptions {
  /** Light comes from a picture light above (the lip's shadow falls straight down). */
  lightAbove?: boolean;
}

/**
 * The framed artwork at `s` pixels per centimetre, on a transparent canvas of
 * exactly its outer size. `art` is the cropped artwork (its ratio is the
 * artwork's: the size in centimetres follows the crop).
 */
export function renderFramed(art: CanvasImageSource, artW: number, artH: number, frame: FrameSpec, round: boolean, s: number, options: FramedOptions = {}): HTMLCanvasElement {
  const g = frameGeometry(artW, artH, frame);
  const W = Math.max(2, Math.round(g.outerW * s));
  const H = Math.max(2, Math.round(round ? W : g.outerH * s));
  const canvas = makeCanvas(W, H);
  const ctx = ctxOf(canvas);
  const finish = finishOf(frame.finish);
  const F = g.face * s;
  const lipX = options.lightAbove ? 0 : 0.12 * s;
  const lipY = options.lightAbove ? 0.3 * s : 0.22 * s;

  if (frame.type === 'frameless') {
    drawArt(ctx, art, round, 0, 0, W, H);
    // The canvas edge: a lit top-left rim and a shaded bottom-right one.
    ctx.save();
    shapePath(ctx, round, 0, 0, W, H);
    ctx.clip();
    const edge = Math.max(1, 0.12 * s);
    const lg = ctx.createLinearGradient(0, 0, W, H);
    lg.addColorStop(0, 'rgba(255,255,255,0.18)');
    lg.addColorStop(0.5, 'rgba(255,255,255,0)');
    lg.addColorStop(1, 'rgba(0,0,0,0.25)');
    ctx.strokeStyle = lg;
    ctx.lineWidth = edge * 2;
    shapePath(ctx, round, 0, 0, W, H);
    ctx.stroke();
    ctx.restore();
    return canvas;
  }

  if (round) drawRing(ctx, finish, W / 2, F, s);
  else drawMoulding(ctx, finish, W, H, F, s);

  const inner = { x: F, y: F, w: W - 2 * F, h: H - 2 * F };
  const artBox = { x: (g.face + g.mat + g.gap) * s, y: (g.face + g.mat + g.gap) * s, w: artW * s, h: (round ? artW : artH) * s };

  if (frame.type === 'floating') {
    // The recess behind the floating panel, in the frame's own colour, deep in shadow.
    const recess: RGB = finish.id === 'white' ? shade(rgbOf(finish.base), -0.2) : finish.id === 'black' ? [12, 12, 12] : shade(rgbOf(finish.dark), -0.45);
    ctx.save();
    shapePath(ctx, round, inner.x, inner.y, inner.w, inner.h);
    ctx.fillStyle = css(recess);
    ctx.fill();
    ctx.restore();
    innerShadow(ctx, round, inner.x, inner.y, inner.w, inner.h, 0.7 * s, lipX * 1.4, lipY * 1.6, 0.75);
    // The panel floats: it throws a shadow onto the recess.
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.6)';
    ctx.shadowBlur = Math.max(2, 0.45 * s);
    ctx.shadowOffsetX = options.lightAbove ? 0 : 0.14 * s;
    ctx.shadowOffsetY = 0.32 * s;
    shapePath(ctx, round, artBox.x, artBox.y, artBox.w, artBox.h);
    ctx.fillStyle = 'rgb(40,40,40)';
    ctx.fill();
    ctx.restore();
    drawArt(ctx, art, round, artBox.x, artBox.y, artBox.w, artBox.h);
    ctx.save();
    shapePath(ctx, round, artBox.x, artBox.y, artBox.w, artBox.h);
    ctx.clip();
    const lg = ctx.createLinearGradient(artBox.x, artBox.y, artBox.x + artBox.w, artBox.y + artBox.h);
    lg.addColorStop(0, 'rgba(255,255,255,0.2)');
    lg.addColorStop(0.5, 'rgba(255,255,255,0)');
    lg.addColorStop(1, 'rgba(0,0,0,0.3)');
    ctx.strokeStyle = lg;
    ctx.lineWidth = Math.max(1.2, 0.1 * s);
    shapePath(ctx, round, artBox.x, artBox.y, artBox.w, artBox.h);
    ctx.stroke();
    ctx.restore();
    return canvas;
  }

  // Classic: the mat (if any), the artwork in its window, and the lip's shadow over both.
  if (g.mat > 0) drawMat(ctx, round, frame.mat.color, inner.x, inner.y, inner.w, inner.h, artBox, s);
  drawArt(ctx, art, round, artBox.x, artBox.y, artBox.w, artBox.h);
  if (g.mat > 0) innerShadow(ctx, round, artBox.x, artBox.y, artBox.w, artBox.h, Math.max(1, 0.12 * s), 0.04 * s, 0.06 * s, 0.35);
  innerShadow(ctx, round, inner.x, inner.y, inner.w, inner.h, Math.max(1.5, 0.45 * s), lipX, lipY, 0.5);
  return canvas;
}

