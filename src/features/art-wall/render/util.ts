// Small shared pieces of the Art on Your Wall renderer: canvases, colours and
// seeded randomness (the same seed draws the same wood grain or plaster in the
// preview and in the saved image).

export type Ctx = CanvasRenderingContext2D;

export function makeCanvas(width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width));
  canvas.height = Math.max(1, Math.round(height));
  return canvas;
}

export function ctxOf(canvas: HTMLCanvasElement): Ctx {
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas unavailable');
  return ctx;
}

/** Deterministic PRNG (mulberry32): 0 ≤ n < 1. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A small stable hash for cache keys and seeds. */
export function hash(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return h >>> 0;
}

export type RGB = [number, number, number];

export function rgbOf(hex: string): RGB {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  const n = m ? parseInt(m[1], 16) : 0x808080;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export const css = ([r, g, b]: RGB, a = 1): string => (a >= 1 ? `rgb(${r | 0},${g | 0},${b | 0})` : `rgba(${r | 0},${g | 0},${b | 0},${a})`);

export const mix = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

/** Lighter (k > 0, toward white) or darker (k < 0, toward black). */
export const shade = (c: RGB, k: number): RGB => (k >= 0 ? mix(c, [255, 255, 255], k) : mix(c, [0, 0, 0], -k));

export const luminance = ([r, g, b]: RGB): number => (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;

export const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

/** A canvas of soft grey "clouds" (value noise by upscaled random grids), mean ≈ 128. */
export function clouds(width: number, height: number, cellPx: number, seed: number, octaves = 3, stretch = 1): HTMLCanvasElement {
  const out = makeCanvas(width, height);
  const ctx = ctxOf(out);
  ctx.fillStyle = 'rgb(128,128,128)';
  ctx.fillRect(0, 0, out.width, out.height);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  const random = rng(seed);
  let cell = Math.max(2, cellPx);
  let weight = 0.75;
  for (let o = 0; o < octaves; o++) {
    const gw = Math.max(2, Math.ceil(out.width / (cell * stretch)) + 2);
    const gh = Math.max(2, Math.ceil(out.height / cell) + 2);
    const grid = makeCanvas(gw, gh);
    const g = ctxOf(grid);
    const data = g.createImageData(gw, gh);
    for (let i = 0; i < gw * gh; i++) {
      const v = Math.round(random() * 255);
      data.data[i * 4] = v;
      data.data[i * 4 + 1] = v;
      data.data[i * 4 + 2] = v;
      data.data[i * 4 + 3] = 255;
    }
    g.putImageData(data, 0, 0);
    ctx.globalAlpha = weight;
    // Offset by half a cell so the grid's edges never show.
    ctx.drawImage(grid, -cell * stretch * 0.5, -cell * 0.5, gw * cell * stretch, gh * cell);
    cell /= 2.3;
    weight *= 0.55;
  }
  ctx.globalAlpha = 1;
  return out;
}

const grainCache = new Map<number, HTMLCanvasElement>();
/** A 128 px tile of fine per-pixel grain (for patterns). */
export function grainTile(seed = 7): HTMLCanvasElement {
  const hit = grainCache.get(seed);
  if (hit) return hit;
  const tile = makeCanvas(128, 128);
  const ctx = ctxOf(tile);
  const data = ctx.createImageData(128, 128);
  const random = rng(seed);
  for (let i = 0; i < 128 * 128; i++) {
    const v = Math.round(random() * 255);
    data.data[i * 4] = v;
    data.data[i * 4 + 1] = v;
    data.data[i * 4 + 2] = v;
    data.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(data, 0, 0);
  grainCache.set(seed, tile);
  return tile;
}

/** Overlay a grey texture (mean 128) on what is drawn, lightening and darkening around it. */
export function overlayTexture(ctx: Ctx, texture: CanvasImageSource, x: number, y: number, w: number, h: number, alpha: number, mode: GlobalCompositeOperation = 'soft-light'): void {
  ctx.save();
  ctx.globalCompositeOperation = mode;
  ctx.globalAlpha = alpha;
  ctx.drawImage(texture, x, y, w, h);
  ctx.restore();
}

/** Fine grain over a region, as a repeating pattern. */
export function overlayGrain(ctx: Ctx, x: number, y: number, w: number, h: number, alpha: number, scale = 1, seed = 7): void {
  const pattern = ctx.createPattern(grainTile(seed), 'repeat');
  if (!pattern) return;
  if (scale !== 1 && typeof DOMMatrix !== 'undefined') pattern.setTransform(new DOMMatrix().scale(scale, scale));
  ctx.save();
  ctx.globalCompositeOperation = 'soft-light';
  ctx.globalAlpha = alpha;
  ctx.fillStyle = pattern;
  ctx.fillRect(x, y, w, h);
  ctx.restore();
}

/** Rounded rectangle path (no dependence on ctx.roundRect, which older Safari lacks). */
export function roundRectPath(ctx: Ctx, x: number, y: number, w: number, h: number, r: number | [number, number, number, number]): void {
  const [tl, tr, br, bl] = (Array.isArray(r) ? r : [r, r, r, r]).map((v) => Math.max(0, Math.min(v, w / 2, h / 2)));
  ctx.moveTo(x + tl, y);
  ctx.lineTo(x + w - tr, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + tr);
  ctx.lineTo(x + w, y + h - br);
  ctx.quadraticCurveTo(x + w, y + h, x + w - br, y + h);
  ctx.lineTo(x + bl, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - bl);
  ctx.lineTo(x, y + tl);
  ctx.quadraticCurveTo(x, y, x + tl, y);
  ctx.closePath();
}
