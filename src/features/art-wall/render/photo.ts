// My Room: the framed piece placed on the person's own photo. Its four corners
// can be moved one by one (perspective): the piece is mapped onto them by a
// homography, sampled in this browser (bilinear, premultiplied, so edges stay
// smooth), and set into the photo with a shadow that takes the wall's light.
// Nothing about the photo or the artwork is redrawn or invented.

import type { Pt } from '../types';
import { ctxOf, makeCanvas, type Ctx } from './util';

export type Mat3 = [number, number, number, number, number, number, number, number, number];

/** The homography taking the unit square (0,0)(1,0)(1,1)(0,1) to the quad q0…q3 (Heckbert). */
export function squareToQuad(q: [Pt, Pt, Pt, Pt]): Mat3 {
  const [p0, p1, p2, p3] = q;
  const dx1 = p1.x - p2.x;
  const dx2 = p3.x - p2.x;
  const dy1 = p1.y - p2.y;
  const dy2 = p3.y - p2.y;
  const sx = p0.x - p1.x + p2.x - p3.x;
  const sy = p0.y - p1.y + p2.y - p3.y;
  const den = dx1 * dy2 - dx2 * dy1 || 1e-9;
  const g = (sx * dy2 - dx2 * sy) / den;
  const h = (dx1 * sy - sx * dy1) / den;
  return [p1.x - p0.x + g * p1.x, p3.x - p0.x + h * p3.x, p0.x, p1.y - p0.y + g * p1.y, p3.y - p0.y + h * p3.y, p0.y, g, h, 1];
}

export function invert3(m: Mat3): Mat3 {
  const [a, b, c, d, e, f, g, h, i] = m;
  const A = e * i - f * h;
  const B = -(d * i - f * g);
  const C = d * h - e * g;
  const det = a * A + b * B + c * C || 1e-12;
  return [A / det, -(b * i - c * h) / det, (b * f - c * e) / det, B / det, (a * i - c * g) / det, -(a * f - c * d) / det, C / det, -(a * h - b * g) / det, (a * e - b * d) / det];
}

export function apply3(m: Mat3, x: number, y: number): Pt {
  const w = m[6] * x + m[7] * y + m[8];
  return { x: (m[0] * x + m[1] * y + m[2]) / w, y: (m[3] * x + m[4] * y + m[5]) / w };
}

/** Whether four points make a convex quad in order (a usable placement). */
export function isConvex(q: [Pt, Pt, Pt, Pt]): boolean {
  let sign = 0;
  for (let i = 0; i < 4; i++) {
    const a = q[i];
    const b = q[(i + 1) % 4];
    const c = q[(i + 2) % 4];
    const cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
    if (Math.abs(cross) < 1e-9) return false;
    const s = Math.sign(cross);
    if (sign && s !== sign) return false;
    sign = s;
  }
  return true;
}

/**
 * The source image warped onto quad (canvas px). Returns a canvas covering the
 * quad's bounding box and that box's offset.
 */
export function warpToQuad(source: HTMLCanvasElement, quad: [Pt, Pt, Pt, Pt]): { canvas: HTMLCanvasElement; x: number; y: number } {
  const xs = quad.map((p) => p.x);
  const ys = quad.map((p) => p.y);
  const x0 = Math.floor(Math.min(...xs)) - 1;
  const y0 = Math.floor(Math.min(...ys)) - 1;
  const w = Math.ceil(Math.max(...xs)) + 1 - x0;
  const h = Math.ceil(Math.max(...ys)) + 1 - y0;
  const out = makeCanvas(w, h);
  if (w <= 2 || h <= 2) return { canvas: out, x: x0, y: y0 };
  // A transparent border of 2 px around the source, so its edges blend out.
  const pad = 2;
  const sw = source.width + 2 * pad;
  const sh = source.height + 2 * pad;
  const padded = makeCanvas(sw, sh);
  ctxOf(padded).drawImage(source, pad, pad);
  const src = ctxOf(padded).getImageData(0, 0, sw, sh).data;
  // Premultiply once.
  const pm = new Float32Array(sw * sh * 4);
  for (let i = 0; i < sw * sh; i++) {
    const a = src[i * 4 + 3] / 255;
    pm[i * 4] = src[i * 4] * a;
    pm[i * 4 + 1] = src[i * 4 + 1] * a;
    pm[i * 4 + 2] = src[i * 4 + 2] * a;
    pm[i * 4 + 3] = src[i * 4 + 3];
  }
  // Unit square ↔ the quad; the padded source sits slightly outside the unit square.
  const local = quad.map((p) => ({ x: p.x - x0, y: p.y - y0 })) as [Pt, Pt, Pt, Pt];
  const inv = invert3(squareToQuad(local));
  const ctx = ctxOf(out);
  const img = ctx.createImageData(w, h);
  const d = img.data;
  const fx = source.width / sw;
  const fy = source.height / sh;
  const ox = pad / sw;
  const oy = pad / sh;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const px = x + 0.5;
      const py = y + 0.5;
      const ww = inv[6] * px + inv[7] * py + inv[8];
      const u = (inv[0] * px + inv[1] * py + inv[2]) / ww;
      const v = (inv[3] * px + inv[4] * py + inv[5]) / ww;
      // Unit square → padded source pixels.
      const sxf = (u * fx + ox) * sw - 0.5;
      const syf = (v * fy + oy) * sh - 0.5;
      if (sxf < -1 || syf < -1 || sxf > sw || syf > sh) continue;
      const ix = Math.floor(sxf);
      const iy = Math.floor(syf);
      const tx = sxf - ix;
      const ty = syf - iy;
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let j = 0; j < 4; j++) {
        const cx = ix + (j & 1);
        const cy = iy + (j >> 1);
        if (cx < 0 || cy < 0 || cx >= sw || cy >= sh) continue;
        const wgt = (j & 1 ? tx : 1 - tx) * (j >> 1 ? ty : 1 - ty);
        const k = (cy * sw + cx) * 4;
        r += pm[k] * wgt;
        g += pm[k + 1] * wgt;
        b += pm[k + 2] * wgt;
        a += pm[k + 3] * wgt;
      }
      if (a <= 0.5) continue;
      const o = (y * w + x) * 4;
      const inva = 255 / a;
      d[o] = r * inva;
      d[o + 1] = g * inva;
      d[o + 2] = b * inva;
      d[o + 3] = a;
    }
  }
  ctx.putImageData(img, 0, 0);
  return { canvas: out, x: x0, y: y0 };
}

/** Average brightness (0…1) of the photo around the placement, for matching the room's light. */
function regionLuminance(photo: HTMLCanvasElement, quad: [Pt, Pt, Pt, Pt]): number {
  const xs = quad.map((p) => p.x);
  const ys = quad.map((p) => p.y);
  const w = Math.max(...xs) - Math.min(...xs);
  const h = Math.max(...ys) - Math.min(...ys);
  const x = Math.max(0, Math.min(...xs) - w * 0.4);
  const y = Math.max(0, Math.min(...ys) - h * 0.4);
  const sample = makeCanvas(16, 16);
  const ctx = ctxOf(sample);
  ctx.drawImage(photo, x, y, Math.min(photo.width - x, w * 1.8), Math.min(photo.height - y, h * 1.8), 0, 0, 16, 16);
  const data = ctx.getImageData(0, 0, 16, 16).data;
  let sum = 0;
  for (let i = 0; i < 256; i++) sum += (0.2126 * data[i * 4] + 0.7152 * data[i * 4 + 1] + 0.0722 * data[i * 4 + 2]) / 255;
  return sum / 256;
}

export interface PhotoComposite {
  photo: HTMLCanvasElement;
  framed: HTMLCanvasElement;
  /** The corners on `photo`, px. */
  quad: [Pt, Pt, Pt, Pt];
  /** 0…100 */
  shadow: number;
  /** 0…100 */
  match: number;
}

/** Draw the photo with the framed piece set into it. `ctx` is the output, already sized like `photo`. */
export function composePhoto(ctx: Ctx, input: PhotoComposite): void {
  ctx.drawImage(input.photo, 0, 0);
  if (!isConvex(input.quad)) return;
  const warped = warpToQuad(input.framed, input.quad);
  const xs = input.quad.map((p) => p.x);
  const size = Math.max(...xs) - Math.min(...xs);
  // Match the room's light: a neutral dimming where the room is darker.
  if (input.match > 0) {
    const l = regionLuminance(input.photo, input.quad);
    const dim = Math.max(0, Math.min(0.45, (0.78 - l) * 0.9)) * (input.match / 100);
    if (dim > 0.01) {
      const wc = ctxOf(warped.canvas);
      wc.save();
      wc.globalCompositeOperation = 'source-atop';
      wc.fillStyle = `rgba(0,0,0,${dim.toFixed(3)})`;
      wc.fillRect(0, 0, warped.canvas.width, warped.canvas.height);
      wc.restore();
    }
  }
  const k = input.shadow / 100;
  if (k > 0) {
    ctx.save();
    ctx.shadowColor = `rgba(0,0,0,${(0.55 * k).toFixed(3)})`;
    ctx.shadowBlur = size * 0.035 * (0.5 + k);
    ctx.shadowOffsetX = size * 0.008;
    ctx.shadowOffsetY = size * 0.025 * (0.5 + k);
    ctx.drawImage(warped.canvas, warped.x, warped.y);
    ctx.restore();
  }
  ctx.drawImage(warped.canvas, warped.x, warped.y);
}
