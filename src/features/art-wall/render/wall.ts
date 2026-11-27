// Wall surfaces, drawn at real scale (s pixels per centimetre) so plaster,
// brick or slats read at their true size next to the artwork.

import type { WallTexture } from '../types';
import { clouds as fullClouds, css, overlayGrain, overlayTexture, rgbOf, rng, shade, type Ctx } from './util';

/** Soft clouds are smooth: made at most ~1400 px and drawn scaled up (saves memory in large exports). */
function clouds(w: number, h: number, cellPx: number, seed: number, octaves = 3, stretch = 1): HTMLCanvasElement {
  const f = Math.min(1, 1400 / Math.max(w, h));
  return fullClouds(w * f, h * f, cellPx * f, seed, octaves, stretch);
}

export function paintWall(ctx: Ctx, x: number, y: number, w: number, h: number, color: string, texture: WallTexture, s: number, seed = 1): void {
  const base = rgbOf(color);
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  ctx.fillStyle = css(base);
  ctx.fillRect(x, y, w, h);
  const random = rng(seed * 31 + texture.length);
  switch (texture) {
    case 'paint':
      overlayTexture(ctx, clouds(w, h, 70 * s, seed, 2), x, y, w, h, 0.05);
      overlayGrain(ctx, x, y, w, h, 0.03);
      break;
    case 'plaster':
      overlayTexture(ctx, clouds(w, h, 45 * s, seed + 1, 4), x, y, w, h, 0.13);
      overlayTexture(ctx, clouds(w, h, 9 * s, seed + 2, 2), x, y, w, h, 0.12);
      overlayGrain(ctx, x, y, w, h, 0.06);
      break;
    case 'limewash':
      overlayTexture(ctx, clouds(w, h, 28 * s, seed + 3, 4, 2.6), x, y, w, h, 0.42);
      overlayTexture(ctx, clouds(w, h, 60 * s, seed + 4, 2), x, y, w, h, 0.18);
      overlayGrain(ctx, x, y, w, h, 0.05);
      break;
    case 'concrete': {
      overlayTexture(ctx, clouds(w, h, 32 * s, seed + 5, 4), x, y, w, h, 0.18);
      overlayTexture(ctx, clouds(w, h, 6 * s, seed + 6, 2), x, y, w, h, 0.2);
      overlayGrain(ctx, x, y, w, h, 0.065);
      // Pores and the faint seams of the formwork.
      const pores = Math.min(6000, Math.round(((w / s) * (h / s)) / 45));
      for (let i = 0; i < pores; i++) {
        const r = (0.04 + random() * 0.16) * s;
        ctx.fillStyle = `rgba(0,0,0,${0.12 + random() * 0.22})`;
        ctx.beginPath();
        ctx.arc(x + random() * w, y + random() * h, Math.max(0.4, r), 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.strokeStyle = 'rgba(0,0,0,0.06)';
      ctx.lineWidth = Math.max(0.6, 0.12 * s);
      for (let yy = y + 60 * s; yy < y + h; yy += 120 * s) {
        ctx.beginPath();
        ctx.moveTo(x, yy);
        ctx.lineTo(x + w, yy);
        ctx.stroke();
      }
      break;
    }
    case 'linen': {
      const step = Math.max(1, 0.18 * s);
      for (let yy = y; yy < y + h; yy += step) {
        ctx.fillStyle = `rgba(${random() < 0.5 ? '0,0,0' : '255,255,255'},${0.025 + random() * 0.05})`;
        ctx.fillRect(x, yy, w, Math.max(0.5, step * (0.3 + random() * 0.5)));
      }
      for (let xx = x; xx < x + w; xx += step * 1.6) {
        ctx.fillStyle = `rgba(${random() < 0.5 ? '0,0,0' : '255,255,255'},${0.015 + random() * 0.03})`;
        ctx.fillRect(xx, y, Math.max(0.5, step * 0.4), h);
      }
      overlayTexture(ctx, clouds(w, h, 50 * s, seed + 7, 2), x, y, w, h, 0.12);
      break;
    }
    case 'brick': {
      // Whitewashed brick: 21.5 × 6.5 cm, 1 cm joints, running bond.
      const bw = 21.5 * s;
      const bh = 6.5 * s;
      const j = 1 * s;
      ctx.fillStyle = css(shade(base, -0.12));
      ctx.fillRect(x, y, w, h);
      let row = 0;
      for (let yy = y + h; yy > y - bh; yy -= bh + j, row++) {
        const offset = row % 2 ? (bw + j) / 2 : 0;
        for (let xx = x - offset; xx < x + w; xx += bw + j) {
          ctx.fillStyle = css(shade(base, (random() - 0.5) * 0.16));
          ctx.fillRect(xx, yy - bh, bw, bh);
          ctx.fillStyle = 'rgba(0,0,0,0.08)';
          ctx.fillRect(xx, yy - Math.max(0.6, 0.6 * s), bw, Math.max(0.6, 0.6 * s));
          ctx.fillStyle = 'rgba(255,255,255,0.1)';
          ctx.fillRect(xx, yy - bh, bw, Math.max(0.5, 0.4 * s));
        }
      }
      overlayTexture(ctx, clouds(w, h, 30 * s, seed + 8, 3), x, y, w, h, 0.35);
      overlayGrain(ctx, x, y, w, h, 0.12);
      break;
    }
    case 'slats': {
      // Vertical wood slats: 4 cm wide, 1.2 cm shadowed gaps.
      const sw = 4 * s;
      const gap = 1.2 * s;
      ctx.fillStyle = css(shade(base, -0.55));
      ctx.fillRect(x, y, w, h);
      for (let xx = x - (random() * sw); xx < x + w; xx += sw + gap) {
        const tone = shade(base, (random() - 0.5) * 0.12);
        const g = ctx.createLinearGradient(xx, 0, xx + sw, 0);
        g.addColorStop(0, css(shade(tone, 0.12)));
        g.addColorStop(0.5, css(tone));
        g.addColorStop(1, css(shade(tone, -0.18)));
        ctx.fillStyle = g;
        ctx.fillRect(xx, y, sw, h);
      }
      overlayTexture(ctx, clouds(w, h, 12 * s, seed + 9, 3, 0.15), x, y, w, h, 0.25);
      break;
    }
  }
  ctx.restore();
}
