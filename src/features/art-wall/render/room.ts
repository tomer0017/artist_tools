// Room Studio: a living room seen straight on, in true perspective. The wall
// is the picture plane (s pixels per centimetre at the wall); the camera stands
// CAMERA.D cm away at eye height CAMERA.H, so the floor, rug and sofa recede
// toward one vanishing point and everything keeps its real size.

import { roomOf, type RoomPreset, type SofaStyle } from '../types';
import { paintWall } from './wall';
import { clouds, css, ctxOf, grainTile, luminance, makeCanvas, mix, overlayGrain, overlayTexture, rgbOf, rng, roundRectPath, shade, type Ctx, type RGB } from './util';

export const CAMERA = { D: 460, H: 125 } as const;

export interface RoomView {
  W: number;
  H: number;
  /** Pixels per centimetre at the wall. */
  s: number;
  cx: number;
  /** Eye level on the canvas. */
  horizon: number;
}

const k = (z: number) => CAMERA.D / (CAMERA.D - Math.min(z, CAMERA.D - 1));
/** A point x (right of centre), y (above the floor), z (out from the wall), all cm, on the canvas. */
export const proj = (v: RoomView, x: number, y: number, z: number): [number, number] => [v.cx + x * v.s * k(z), v.horizon - (y - CAMERA.H) * v.s * k(z)];
/** Where the floor at depth z meets the canvas. */
export const floorAt = (v: RoomView, z: number) => v.horizon + CAMERA.H * v.s * k(z);
/** The depth whose floor is at canvas row y. */
const depthAtRow = (v: RoomView, y: number) => CAMERA.D - CAMERA.D / Math.max(1.0001, (y - v.horizon) / (CAMERA.H * v.s));

export interface SofaDims {
  w: number;
  seat: number;
  back: number;
  arm: number;
  depth: number;
  armW: number;
  legs: number;
}
export const SOFAS: Record<SofaStyle, SofaDims> = {
  modern: { w: 224, seat: 44, back: 84, arm: 62, depth: 92, armW: 20, legs: 14 },
  curved: { w: 236, seat: 42, back: 80, arm: 68, depth: 98, armW: 30, legs: 0 },
  chesterfield: { w: 214, seat: 46, back: 76, arm: 76, depth: 92, armW: 26, legs: 9 },
  lounge: { w: 242, seat: 38, back: 70, arm: 52, depth: 104, armW: 28, legs: 3 },
};

/** Where the room's view stands for a framed piece of outer size w × h cm hung with its centre at `centre` cm. */
export function roomView(W: number, H: number, outer: { w: number; h: number }, centre: number, sofa: SofaDims): RoomView {
  const top = centre + outer.h / 2 + 40;
  const front = 175;
  const spanCm = top - CAMERA.H + CAMERA.H * k(front);
  const viewW = Math.max(430, outer.w * 1.9, sofa.w * 1.5);
  const s = Math.min(W / viewW, (H * 0.97) / spanCm);
  const spanPx = spanCm * s;
  const horizon = (H - spanPx) / 2 + (top - CAMERA.H) * s;
  return { W, H, s, cx: W / 2, horizon };
}

// ── the room behind ─────────────────────────────────────────────────────────
export function drawRoomBack(ctx: Ctx, v: RoomView, room: RoomPreset, seed = 3): void {
  const floorY = floorAt(v, 0);
  paintWall(ctx, 0, 0, v.W, floorY, room.wall.color, room.wall.texture, v.s, seed);
  const wall = rgbOf(room.wall.color);
  if (room.wainscot) drawWainscot(ctx, v, wall, floorY);
  // Baseboard (10 cm) and the soft occlusion where wall meets floor.
  const bb = rgbOf(room.baseboard);
  const bbTop = floorY - 10 * v.s;
  ctx.fillStyle = css(bb);
  ctx.fillRect(0, bbTop, v.W, floorY - bbTop);
  ctx.fillStyle = css(shade(bb, 0.25));
  ctx.fillRect(0, bbTop, v.W, Math.max(1, 0.6 * v.s));
  ctx.fillStyle = 'rgba(0,0,0,0.12)';
  ctx.fillRect(0, bbTop - Math.max(1, 0.3 * v.s), v.W, Math.max(1, 0.3 * v.s));
  const g = ctx.createLinearGradient(0, bbTop - 14 * v.s, 0, bbTop);
  g.addColorStop(0, 'rgba(0,0,0,0)');
  g.addColorStop(1, 'rgba(0,0,0,0.06)');
  ctx.fillStyle = g;
  ctx.fillRect(0, bbTop - 14 * v.s, v.W, 14 * v.s);
  drawFloor(ctx, v, room, seed);
  if (room.rug) drawRug(ctx, v, room.rug, seed);
}

function drawWainscot(ctx: Ctx, v: RoomView, wall: RGB, floorY: number): void {
  const rail = floorY - 92 * v.s;
  const line = (x0: number, y0: number, x1: number, y1: number, color: string, width: number) => {
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.stroke();
  };
  const w = Math.max(1, 0.5 * v.s);
  ctx.fillStyle = css(shade(wall, 0.06));
  ctx.fillRect(0, rail - 3 * v.s, v.W, 3 * v.s);
  line(0, rail - 3 * v.s, v.W, rail - 3 * v.s, css(shade(wall, 0.2)), w);
  line(0, rail, v.W, rail, css(shade(wall, -0.25)), w);
  const panel = 78 * v.s;
  const top = rail + 9 * v.s;
  const bottom = floorY - 20 * v.s;
  for (let x = v.cx - panel * 0.5 - Math.ceil(v.cx / panel) * panel; x < v.W; x += panel) {
    const x0 = x + 7 * v.s;
    const x1 = x + panel - 7 * v.s;
    line(x0, top, x1, top, css(shade(wall, -0.22)), w);
    line(x0, top, x0, bottom, css(shade(wall, -0.18)), w);
    line(x1, top, x1, bottom, css(shade(wall, 0.18)), w);
    line(x0, bottom, x1, bottom, css(shade(wall, 0.22)), w);
  }
}

function drawFloor(ctx: Ctx, v: RoomView, room: RoomPreset, seed: number): void {
  const floorY = floorAt(v, 0);
  const base = rgbOf(room.floor.color);
  const dark = rgbOf(room.floor.dark);
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, floorY, v.W, v.H - floorY);
  ctx.clip();
  ctx.fillStyle = css(base);
  ctx.fillRect(0, floorY, v.W, v.H - floorY);
  const random = rng(seed * 7 + 5);
  const zBottom = depthAtRow(v, v.H);
  if (room.floor.kind === 'wood' && room.floor.plankCm > 0) {
    const plank = room.floor.plankCm;
    const half = v.W / 2 / (v.s * k(zBottom)) + plank * 2;
    const seam = css(shade(dark, -0.35), 0.55);
    for (let x = -Math.ceil(half / plank) * plank; x < half; x += plank) {
      let z = -random() * 160;
      while (z < zBottom) {
        const len = 110 + random() * 120;
        const z0 = Math.max(0, z);
        const z1 = Math.min(zBottom + 5, z + len);
        if (z1 > z0) {
          const tone = mix(base, dark, random() * 0.55);
          const [ax, ay] = proj(v, x, 0, z0);
          const [bx] = proj(v, x + plank, 0, z0);
          const [cx, cy] = proj(v, x + plank, 0, z1);
          const [dx] = proj(v, x, 0, z1);
          ctx.beginPath();
          ctx.moveTo(ax, ay);
          ctx.lineTo(bx, ay);
          ctx.lineTo(cx, cy);
          ctx.lineTo(dx, cy);
          ctx.closePath();
          ctx.fillStyle = css(tone);
          ctx.fill();
          // Grain along the plank.
          for (let i = 0; i < 3; i++) {
            const fx = x + plank * (0.15 + random() * 0.7);
            const [gx0, gy0] = proj(v, fx, 0, z0);
            const [gx1, gy1] = proj(v, fx + (random() - 0.5) * 2, 0, z1);
            ctx.strokeStyle = css(shade(tone, random() < 0.5 ? -0.12 : 0.1), 0.35);
            ctx.lineWidth = Math.max(0.5, v.s * 0.12 * k(z1));
            ctx.beginPath();
            ctx.moveTo(gx0, gy0);
            ctx.lineTo(gx1, gy1);
            ctx.stroke();
          }
          // The end joint.
          ctx.strokeStyle = seam;
          ctx.lineWidth = Math.max(0.6, v.s * 0.1 * k(z1));
          ctx.beginPath();
          ctx.moveTo(dx, cy);
          ctx.lineTo(cx, cy);
          ctx.stroke();
        }
        z += len;
      }
      const [lx0, ly0] = proj(v, x, 0, 0);
      const [lx1, ly1] = proj(v, x, 0, zBottom + 5);
      ctx.strokeStyle = seam;
      ctx.lineWidth = Math.max(0.6, v.s * 0.12);
      ctx.beginPath();
      ctx.moveTo(lx0, ly0);
      ctx.lineTo(lx1, ly1);
      ctx.stroke();
    }
  } else {
    overlayTexture(ctx, clouds(Math.min(v.W, 1400), Math.min(v.H - floorY, 600) || 1, 40 * v.s * Math.min(1, 1400 / v.W), seed + 11, 4, 2.5), 0, floorY, v.W, v.H - floorY, 0.4);
    overlayGrain(ctx, 0, floorY, v.W, v.H - floorY, 0.14);
  }
  // Light on the floor: a sheen near the wall, deepening toward the viewer.
  const g = ctx.createLinearGradient(0, floorY, 0, v.H);
  g.addColorStop(0, 'rgba(255,255,255,0.10)');
  g.addColorStop(0.35, 'rgba(255,255,255,0.02)');
  g.addColorStop(1, 'rgba(0,0,0,0.22)');
  ctx.fillStyle = g;
  ctx.fillRect(0, floorY, v.W, v.H - floorY);
  const ao = ctx.createLinearGradient(0, floorY, 0, floorY + 5 * v.s);
  ao.addColorStop(0, 'rgba(0,0,0,0.28)');
  ao.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = ao;
  ctx.fillRect(0, floorY, v.W, 5 * v.s);
  ctx.restore();
}

function quad(ctx: Ctx, pts: [number, number][]): void {
  ctx.beginPath();
  pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  ctx.closePath();
}

function drawRug(ctx: Ctx, v: RoomView, rug: { color: string; border: string }, seed: number): void {
  const c = rgbOf(rug.color);
  const corners = (x0: number, x1: number, z0: number, z1: number): [number, number][] => [proj(v, x0, 0, z0), proj(v, x1, 0, z0), proj(v, x1, 0, z1), proj(v, x0, 0, z1)];
  ctx.save();
  quad(ctx, corners(-170, 170, 40, 250));
  ctx.fillStyle = 'rgba(0,0,0,0.18)';
  ctx.fill();
  quad(ctx, corners(-168, 168, 38, 248));
  ctx.fillStyle = css(c);
  ctx.fill();
  ctx.clip();
  quad(ctx, corners(-156, 156, 50, 236));
  ctx.strokeStyle = css(rgbOf(rug.border));
  ctx.lineWidth = Math.max(1, 2.4 * v.s);
  ctx.stroke();
  quad(ctx, corners(-148, 148, 58, 228));
  ctx.strokeStyle = css(rgbOf(rug.border), 0.6);
  ctx.lineWidth = Math.max(0.8, 0.8 * v.s);
  ctx.stroke();
  const top = floorAt(v, 38);
  overlayTexture(ctx, clouds(Math.min(v.W, 1200), 300, 18, seed + 21, 3), 0, top, v.W, v.H - top, 0.3);
  overlayGrain(ctx, 0, top, v.W, v.H - top, 0.22, 1.4);
  ctx.restore();
}

// ── the sofa ────────────────────────────────────────────────────────────────
interface Box {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
  z0: number;
  z1: number;
  /** Rounding of the front face, cm. */
  r?: number;
  tone?: number;
}

function fabricFace(ctx: Ctx, base: RGB, pts: [number, number][], tone: number, top: [number, number], bottom: [number, number]): void {
  quad(ctx, pts);
  const g = ctx.createLinearGradient(top[0], top[1], bottom[0], bottom[1]);
  g.addColorStop(0, css(shade(base, tone + 0.06)));
  g.addColorStop(1, css(shade(base, tone - 0.1)));
  ctx.fillStyle = g;
  ctx.fill();
}

/** One upholstered block: its inner side, its top and its rounded front, lit from above. */
function drawBox(ctx: Ctx, v: RoomView, b: Box, base: RGB, sheen: boolean): void {
  const tone = b.tone ?? 0;
  if (b.x1 < 0) {
    const pts: [number, number][] = [proj(v, b.x1, b.y0, b.z0), proj(v, b.x1, b.y1, b.z0), proj(v, b.x1, b.y1, b.z1), proj(v, b.x1, b.y0, b.z1)];
    fabricFace(ctx, base, pts, tone - 0.16, pts[1], pts[0]);
  }
  if (b.x0 > 0) {
    const pts: [number, number][] = [proj(v, b.x0, b.y0, b.z0), proj(v, b.x0, b.y1, b.z0), proj(v, b.x0, b.y1, b.z1), proj(v, b.x0, b.y0, b.z1)];
    fabricFace(ctx, base, pts, tone - 0.16, pts[1], pts[0]);
  }
  if (b.y1 < CAMERA.H) {
    const pts: [number, number][] = [proj(v, b.x0, b.y1, b.z0), proj(v, b.x1, b.y1, b.z0), proj(v, b.x1, b.y1, b.z1), proj(v, b.x0, b.y1, b.z1)];
    fabricFace(ctx, base, pts, tone + 0.1, pts[0], pts[3]);
  }
  const [fx0, fy0] = proj(v, b.x0, b.y1, b.z1);
  const [fx1, fy1] = proj(v, b.x1, b.y0, b.z1);
  const r = (b.r ?? 3) * v.s * k(b.z1);
  ctx.beginPath();
  roundRectPath(ctx, fx0, fy0, fx1 - fx0, fy1 - fy0, r);
  const g = ctx.createLinearGradient(0, fy0, 0, fy1);
  g.addColorStop(0, css(shade(base, tone + 0.08)));
  g.addColorStop(0.18, css(shade(base, tone + 0.02)));
  g.addColorStop(1, css(shade(base, tone - 0.16)));
  ctx.fillStyle = g;
  ctx.fill();
  if (sheen) {
    const hg = ctx.createLinearGradient(0, fy0, 0, fy1);
    hg.addColorStop(0, 'rgba(255,255,255,0.22)');
    hg.addColorStop(0.12, 'rgba(255,255,255,0.04)');
    hg.addColorStop(0.5, 'rgba(255,255,255,0)');
    ctx.fillStyle = hg;
    ctx.fill();
  }
  ctx.strokeStyle = css(shade(base, tone - 0.32), 0.55);
  ctx.lineWidth = Math.max(0.6, 0.25 * v.s);
  ctx.stroke();
}

function drawLeg(ctx: Ctx, v: RoomView, x: number, z: number, h: number, kind: 'metal' | 'wood' | 'bun'): void {
  if (h <= 0) return;
  const [x0, y0] = proj(v, x - (kind === 'bun' ? 4 : 1.6), h, z);
  const [x1, y1] = proj(v, x + (kind === 'bun' ? 4 : 1.6), 0, z);
  const color = kind === 'metal' ? '#1c1c1c' : '#3b2618';
  ctx.fillStyle = color;
  if (kind === 'bun') {
    ctx.beginPath();
    ctx.ellipse((x0 + x1) / 2, (y0 + y1) / 2, (x1 - x0) / 2, (y1 - y0) / 2, 0, 0, Math.PI * 2);
    ctx.fill();
  } else {
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y0);
    ctx.lineTo(x1 - (x1 - x0) * 0.25, y1);
    ctx.lineTo(x0 + (x1 - x0) * 0.25, y1);
    ctx.closePath();
    ctx.fill();
  }
}

/** The sofa against the wall, centred under the artwork. */
export function drawSofa(ctx: Ctx, v: RoomView, style: SofaStyle, color: string, seed = 5): void {
  const d = SOFAS[style];
  const base = rgbOf(color);
  const sheen = luminance(base) < 0.2;
  const half = d.w / 2;
  const back0 = 5;
  const backDepth = style === 'lounge' ? 20 : 18;
  // Contact shadow on the floor.
  const [sx, sy] = proj(v, 0, 0, back0 + d.depth * 0.55);
  const rx = half * v.s * k(d.depth * 0.6) * 1.02;
  const ry = (floorAt(v, back0 + d.depth + 8) - floorAt(v, back0)) * 0.62;
  ctx.save();
  ctx.translate(sx, sy);
  ctx.scale(1, ry / rx);
  const sg = ctx.createRadialGradient(0, 0, rx * 0.2, 0, 0, rx);
  sg.addColorStop(0, 'rgba(0,0,0,0.42)');
  sg.addColorStop(0.7, 'rgba(0,0,0,0.22)');
  sg.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = sg;
  ctx.beginPath();
  ctx.arc(0, 0, rx, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  const front = back0 + d.depth;
  // The sofa itself on its own layer (its box only), so its fabric texture stays on it.
  // The front is nearer the camera, so it is the widest part on the canvas; the back is the highest.
  const [, by0] = proj(v, 0, d.back + 30, back0);
  const [bx0] = proj(v, -half - 8, 0, front + 8);
  const [bx1] = proj(v, half + 8, 0, front + 8);
  const by1 = floorAt(v, front + 8);
  const ox = Math.floor(Math.max(0, bx0));
  const oy = Math.floor(Math.max(0, by0));
  const lw = Math.ceil(Math.min(v.W, bx1) - ox);
  const lh = Math.ceil(Math.min(v.H, by1) - oy);
  if (lw <= 0 || lh <= 0) return;
  const layer = makeCanvas(lw, lh);
  const target = ctx;
  ctx = ctxOf(layer);
  ctx.translate(-ox, -oy);
  const legKind = style === 'chesterfield' ? 'bun' : style === 'modern' ? 'metal' : 'wood';
  [-half + 9, half - 9].forEach((x) => drawLeg(ctx, v, x, front - 8, d.legs, legKind));
  if (style === 'curved' || style === 'lounge') {
    // A recessed plinth instead of legs.
    const [px0, py0] = proj(v, -half + 6, 8, front - 6);
    const [px1, py1] = proj(v, half - 6, 0, front - 6);
    ctx.fillStyle = css(shade(base, -0.55));
    ctx.fillRect(px0, py0, px1 - px0, py1 - py0);
  }
  const y0 = Math.max(d.legs, style === 'curved' || style === 'lounge' ? 7 : d.legs);

  // Back.
  if (style === 'chesterfield') {
    drawBox(ctx, v, { x0: -half + 4, x1: half - 4, y0, y1: d.back, z0: back0, z1: back0 + backDepth + 4, r: 6, tone: -0.02 }, base, sheen);
    tufting(ctx, v, base, -half + d.armW, half - d.armW, d.seat + 6, d.back - 6, back0 + backDepth + 4);
  } else {
    drawBox(ctx, v, { x0: -half, x1: half, y0, y1: d.back - (style === 'curved' ? 0 : 6), z0: back0, z1: back0 + backDepth, r: style === 'curved' ? 16 : 4, tone: -0.04 }, base, sheen);
  }
  // Seat base.
  drawBox(ctx, v, { x0: -half + d.armW - 1, x1: half - d.armW + 1, y0, y1: d.seat - 12, z0: back0 + backDepth, z1: front, r: 2, tone: -0.06 }, base, sheen);
  // Back cushions.
  if (style === 'modern' || style === 'lounge') {
    const n = style === 'lounge' ? 2 : 3;
    const inner = d.w - 2 * d.armW;
    for (let i = 0; i < n; i++) {
      const x0 = -half + d.armW + (inner / n) * i + 1;
      drawBox(ctx, v, { x0, x1: x0 + inner / n - 2, y0: d.seat - 6, y1: d.back - 2, z0: back0 + backDepth, z1: back0 + backDepth + 20, r: 9, tone: 0.02 }, base, sheen);
    }
  }
  // Seat cushions.
  const seats = style === 'curved' ? 1 : style === 'chesterfield' ? 2 : style === 'lounge' ? 2 : 3;
  const inner = d.w - 2 * d.armW;
  for (let i = 0; i < seats; i++) {
    const x0 = -half + d.armW + (inner / seats) * i + 0.6;
    drawBox(ctx, v, { x0, x1: x0 + inner / seats - 1.2, y0: d.seat - 13, y1: d.seat, z0: back0 + backDepth + (style === 'modern' || style === 'lounge' ? 18 : 2), z1: front + 2, r: style === 'curved' ? 8 : 4, tone: 0.03 }, base, sheen);
  }
  // Arms.
  const armR = style === 'curved' ? d.armW / 2 : style === 'chesterfield' ? 10 : 3;
  drawBox(ctx, v, { x0: -half, x1: -half + d.armW, y0, y1: d.arm, z0: back0, z1: front + 2, r: armR, tone: -0.01 }, base, sheen);
  drawBox(ctx, v, { x0: half - d.armW, x1: half, y0, y1: d.arm, z0: back0, z1: front + 2, r: armR, tone: -0.01 }, base, sheen);
  if (style === 'chesterfield') {
    // Rolled arm fronts.
    [-half + d.armW / 2, half - d.armW / 2].forEach((x) => {
      const [ax, ay] = proj(v, x, d.arm - 9, front + 2);
      const rr = (d.armW / 2) * v.s * k(front + 2);
      const g = ctx.createRadialGradient(ax - rr * 0.3, ay - rr * 0.3, rr * 0.1, ax, ay, rr);
      g.addColorStop(0, css(shade(base, 0.14)));
      g.addColorStop(1, css(shade(base, -0.2)));
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(ax, ay, rr * 0.9, 0, Math.PI * 2);
      ctx.fill();
    });
  }
  // Throw pillows.
  const accent = shade(mix(base, [205, 190, 160], 0.55), luminance(base) > 0.6 ? -0.18 : 0.12);
  const random = rng(seed);
  [[-1, -0.12], [1, 0.1]].forEach(([side, tilt]) => {
    const x = side * (half - d.armW - 26);
    const [px, py] = proj(v, x, d.seat + 22, back0 + backDepth + 26);
    const size = 44 * v.s * k(back0 + backDepth + 26);
    ctx.save();
    ctx.translate(px, py);
    ctx.rotate(tilt + (random() - 0.5) * 0.06);
    ctx.beginPath();
    roundRectPath(ctx, -size / 2, -size / 2, size, size * 0.92, size * 0.22);
    const pg = ctx.createLinearGradient(0, -size / 2, 0, size / 2);
    pg.addColorStop(0, css(shade(accent, 0.12)));
    pg.addColorStop(1, css(shade(accent, -0.16)));
    ctx.fillStyle = pg;
    ctx.fill();
    ctx.restore();
  });
  // Fabric texture, masked to the sofa (bouclé for the curved one).
  const tex = makeCanvas(lw, lh);
  const tc = ctxOf(tex);
  const pattern = tc.createPattern(grainTile(23), 'repeat');
  if (pattern) {
    if (style === 'curved' && typeof DOMMatrix !== 'undefined') pattern.setTransform(new DOMMatrix().scale(2.2, 2.2));
    tc.fillStyle = pattern;
    tc.fillRect(0, 0, lw, lh);
    tc.globalCompositeOperation = 'destination-in';
    tc.drawImage(layer, 0, 0);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = 'soft-light';
    ctx.globalAlpha = style === 'curved' ? 0.34 : 0.16;
    ctx.drawImage(tex, 0, 0);
  }
  target.drawImage(layer, ox, oy);
}

function tufting(ctx: Ctx, v: RoomView, base: RGB, x0: number, x1: number, y0: number, y1: number, z: number): void {
  const cols = 9;
  const rows = 3;
  for (let r = 0; r <= rows; r++) {
    for (let c = 0; c <= cols; c++) {
      if ((r + c) % 2) continue;
      const [bx, by] = proj(v, x0 + ((x1 - x0) * c) / cols, y1 - ((y1 - y0) * r) / rows, z);
      const rr = Math.max(0.8, 0.9 * v.s);
      ctx.fillStyle = css(shade(base, -0.35));
      ctx.beginPath();
      ctx.arc(bx, by, rr, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = css(shade(base, -0.25), 0.4);
      ctx.lineWidth = Math.max(0.5, 0.25 * v.s);
      const d = ((x1 - x0) / cols) * v.s * 0.9;
      ctx.beginPath();
      ctx.moveTo(bx - d, by - d * 0.5);
      ctx.lineTo(bx, by);
      ctx.lineTo(bx + d, by - d * 0.5);
      ctx.stroke();
    }
  }
}

// ── decor ───────────────────────────────────────────────────────────────────
export function drawDecor(ctx: Ctx, v: RoomView, room: RoomPreset, sofa: SofaDims, seed = 9): void {
  const random = rng(seed);
  if (room.decor === 'plant') {
    const x = sofa.w / 2 + 48;
    const z = 40;
    const [px, py] = proj(v, x, 42, z);
    const [, pyb] = proj(v, x, 0, z);
    const pw = 36 * v.s * k(z);
    const pot = ctx.createLinearGradient(px - pw / 2, 0, px + pw / 2, 0);
    pot.addColorStop(0, '#d9d3c9');
    pot.addColorStop(0.45, '#f1ede6');
    pot.addColorStop(1, '#bdb5a8');
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.beginPath();
    ctx.ellipse(px, pyb, pw * 0.62, pw * 0.12, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = pot;
    ctx.beginPath();
    ctx.moveTo(px - pw / 2, py);
    ctx.lineTo(px + pw / 2, py);
    ctx.lineTo(px + pw * 0.4, pyb);
    ctx.lineTo(px - pw * 0.4, pyb);
    ctx.closePath();
    ctx.fill();
    const greens: RGB[] = [[58, 92, 60], [74, 112, 70], [44, 74, 50], [92, 130, 84]];
    for (let i = 0; i < 26; i++) {
      const a = -Math.PI / 2 + (random() - 0.5) * 2.2;
      const len = (40 + random() * 80) * v.s * k(z);
      const lx = px + Math.cos(a) * len * 0.75;
      const ly = py - 4 * v.s + Math.sin(a) * len;
      ctx.strokeStyle = 'rgba(40,60,40,0.7)';
      ctx.lineWidth = Math.max(0.6, 0.35 * v.s);
      ctx.beginPath();
      ctx.moveTo(px, py);
      ctx.quadraticCurveTo(px + (lx - px) * 0.3, ly + (py - ly) * 0.4, lx, ly);
      ctx.stroke();
      ctx.save();
      ctx.translate(lx, ly);
      ctx.rotate(a + Math.PI / 2 + (random() - 0.5) * 0.8);
      ctx.fillStyle = css(shade(greens[i % greens.length], (random() - 0.5) * 0.2));
      ctx.beginPath();
      ctx.ellipse(0, 0, (7 + random() * 6) * v.s * k(z), (14 + random() * 8) * v.s * k(z), 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  } else if (room.decor === 'lamp') {
    const x = -(sofa.w / 2 + 46);
    const z = 30;
    const [bx, by] = proj(v, x, 0, z);
    const [, ty] = proj(v, x, 150, z);
    const kk = k(z);
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.beginPath();
    ctx.ellipse(bx, by, 16 * v.s * kk, 3 * v.s * kk, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#2a2622';
    ctx.fillRect(bx - 12 * v.s * kk, by - 2 * v.s * kk, 24 * v.s * kk, 2 * v.s * kk);
    ctx.fillRect(bx - 0.8 * v.s * kk, ty, 1.6 * v.s * kk, by - ty);
    const sw = 44 * v.s * kk;
    const sh = 30 * v.s * kk;
    const shade1 = ctx.createLinearGradient(bx - sw / 2, 0, bx + sw / 2, 0);
    shade1.addColorStop(0, '#d9cbb3');
    shade1.addColorStop(0.5, '#f3e8d4');
    shade1.addColorStop(1, '#c8b89c');
    ctx.fillStyle = shade1;
    ctx.beginPath();
    ctx.moveTo(bx - sw * 0.36, ty - sh);
    ctx.lineTo(bx + sw * 0.36, ty - sh);
    ctx.lineTo(bx + sw / 2, ty);
    ctx.lineTo(bx - sw / 2, ty);
    ctx.closePath();
    ctx.fill();
  } else if (room.decor === 'vase') {
    const x = sofa.w / 2 + 44;
    const z = 34;
    const kk = k(z);
    const [tx, ty] = proj(v, x, 52, z);
    const [, by] = proj(v, x, 0, z);
    const tw = 46 * v.s * kk;
    ctx.fillStyle = 'rgba(0,0,0,0.22)';
    ctx.beginPath();
    ctx.ellipse(tx, by, tw * 0.5, tw * 0.09, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#1f1d1b';
    ctx.fillRect(tx - 1.2 * v.s * kk, ty, 2.4 * v.s * kk, by - ty);
    ctx.fillStyle = '#2b2826';
    ctx.beginPath();
    ctx.ellipse(tx, ty, tw / 2, tw * 0.1, 0, 0, Math.PI * 2);
    ctx.fill();
    const vh = 34 * v.s * kk;
    const vw = 16 * v.s * kk;
    const vg = ctx.createLinearGradient(tx - vw / 2, 0, tx + vw / 2, 0);
    vg.addColorStop(0, '#9c9184');
    vg.addColorStop(0.5, '#d6cec2');
    vg.addColorStop(1, '#857a6d');
    ctx.fillStyle = vg;
    ctx.beginPath();
    ctx.ellipse(tx, ty - vh * 0.45, vw / 2, vh / 2, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#4a3a2c';
    ctx.lineWidth = Math.max(0.6, 0.3 * v.s);
    for (let i = 0; i < 6; i++) {
      const a = -Math.PI / 2 + (random() - 0.5) * 1.1;
      const len = (50 + random() * 40) * v.s * kk;
      ctx.beginPath();
      ctx.moveTo(tx, ty - vh * 0.8);
      ctx.quadraticCurveTo(tx + Math.cos(a) * len * 0.2, ty - vh - len * 0.5, tx + Math.cos(a) * len * 0.6, ty - vh * 0.8 + Math.sin(a) * len);
      ctx.stroke();
    }
  }
}

export { roomOf };
