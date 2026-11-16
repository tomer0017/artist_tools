// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { SketchPipeline, OUTLINE_LAYERS } from './pipeline';
import { DEFAULT_CONTROLS, normalizeControls, pencilShading, type SketchControls } from './styles';
import { isoLoops } from './vector';

// A synthetic reference with known geometry: a large dark disc and a thin dark
// line on a light ground, plus deterministic sensor noise.
const W = 480;
const H = 360;
const DISC = { x: 170, y: 180, r: 110 };
const lineY = (x: number) => 80 + 0.3 * (x - 280);

/**
 * The reference at `scale` × (480 × 360): the same shapes, sharp at every
 * size, with ±`noise`/2 grey levels of per-pixel noise (±3: a clean photo).
 */
function synthetic(scale = 1, noise = 6): Uint8ClampedArray {
  const w = W * scale;
  const h = H * scale;
  const rgba = new Uint8ClampedArray(w * h * 4);
  let seed = 7;
  const rnd = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const sx = x / scale;
      const sy = y / scale;
      let v = 210;
      if ((sx - DISC.x) ** 2 + (sy - DISC.y) ** 2 < DISC.r ** 2) v = 45;
      if (Math.abs(sy - lineY(sx)) < 1.2 && sx > 300 && sx < 460) v = 60;
      v += (rnd() - 0.5) * noise;
      const i = (y * w + x) * 4;
      rgba[i] = rgba[i + 1] = rgba[i + 2] = v;
      rgba[i + 3] = 255;
    }
  }
  return rgba;
}

const grey = (out: Uint8ClampedArray) => {
  const g = new Uint8Array(W * H);
  for (let p = 0; p < g.length; p++) g[p] = out[p * 4];
  return g;
};

/** FNV-1a over the bytes, to pin the exact output. */
function fnv1a(bytes: Uint8Array | Uint8ClampedArray): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < bytes.length; i++) {
    h ^= bytes[i];
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

/** Share of pixels in a solid near-black mass: below 25 % grey with every neighbour within `r` px also below it. */
function solidBlackShare(g: Uint8Array, r: number): number {
  let solid = 0;
  for (let y = r; y < H - r; y++) {
    for (let x = r; x < W - r; x++) {
      let all = true;
      for (let dy = -r; dy <= r && all; dy++) for (let dx = -r; dx <= r && all; dx++) if (g[(y + dy) * W + x + dx] >= 64) all = false;
      if (all) solid++;
    }
  }
  return solid / (W * H);
}

const inkShare = (g: Uint8Array) => g.reduce((n, v) => n + (v < 200 ? 1 : 0), 0) / g.length;
const meanDarkness = (g: Uint8Array) => g.reduce((n, v) => n + (255 - v), 0) / g.length / 255;

describe('sketch pipeline', () => {
  it('is deterministic, and pinned: the same picture and controls give exactly the same pixels', () => {
    const a = new SketchPipeline(synthetic(), W, H);
    const b = new SketchPipeline(synthetic(), W, H, true);
    for (const style of ['outline', 'pencil'] as const) {
      const first = a.render(style, DEFAULT_CONTROLS);
      expect(fnv1a(b.render(style, DEFAULT_CONTROLS))).toBe(fnv1a(first));
      // Re-rendering from the caches changes nothing either.
      expect(fnv1a(a.render(style, DEFAULT_CONTROLS))).toBe(fnv1a(first));
    }
    // Golden values: an intended change to the look updates these on purpose.
    expect(fnv1a(a.render('outline', DEFAULT_CONTROLS))).toMatchInlineSnapshot(`"317d0eb6"`);
    expect(fnv1a(a.render('pencil', DEFAULT_CONTROLS))).toMatchInlineSnapshot(`"1ad9f121"`);
  });

  it('Clean Outline: thin dark lines on white, no solid black, nothing filled in', () => {
    const g = grey(new SketchPipeline(synthetic(), W, H).render('outline', DEFAULT_CONTROLS));
    expect(solidBlackShare(g, 2)).toBe(0);
    // The darkest a line gets is 92 % ink, never pure black.
    expect(g.reduce((m, v) => Math.min(m, v), 255)).toBeGreaterThanOrEqual(Math.round(255 * 0.08) - 1);
    // Paper stays white: the disc's inside is not filled.
    let inside = 0;
    let n = 0;
    for (let y = DISC.y - 40; y < DISC.y + 40; y++) for (let x = DISC.x - 40; x < DISC.x + 40; x++, n++) inside += g[y * W + x] > 245 ? 1 : 0;
    expect(inside / n).toBeGreaterThan(0.98);
    expect(inkShare(g)).toBeLessThan(0.12);
  });

  it('Clean Outline follows the true edges: the disc outline sits within 2.5 px of it, and the thin line is drawn', () => {
    // At a working size like a photo's (960 × 720): the engine scales with the
    // frame, and a tiny frame would exaggerate the line's offset.
    const S = 2;
    const w = W * S;
    const h = H * S;
    const out = new SketchPipeline(synthetic(S), w, h).render('outline', DEFAULT_CONTROLS);
    const ink = (x: number, y: number) => (255 - out[(y * w + x) * 4]) / 255;
    const cx = DISC.x * S;
    const cy = DISC.y * S;
    const R = DISC.r * S;
    let offset = 0;
    let rays = 0;
    for (let a = 0; a < 360; a += 2) {
      const ca = Math.cos((a * Math.PI) / 180);
      const sa = Math.sin((a * Math.PI) / 180);
      let wsum = 0;
      let rsum = 0;
      for (let r = R - 24; r <= R + 24; r += 0.5) {
        const x = Math.round(cx + r * ca);
        const y = Math.round(cy + r * sa);
        if (x < 0 || y < 0 || x >= w || y >= h) continue;
        wsum += ink(x, y);
        rsum += ink(x, y) * r;
      }
      if (wsum > 0.5) {
        offset += rsum / wsum - R;
        rays++;
      }
    }
    expect(rays).toBeGreaterThanOrEqual(170); // the whole circle is outlined
    // Lines sit just inside the dark side of an edge, like a pen line drawn
    // along a shadow; the lab measured ≈ 2 px at review size.
    expect(Math.abs(offset / rays)).toBeLessThan(2.5);
    let lineInk = 0;
    let count = 0;
    for (let x = 320 * S; x < 440 * S; x++, count++) {
      const y = Math.round(lineY(x / S) * S);
      lineInk += Math.max(...[-2, -1, 0, 1, 2].map((d) => ink(x, y + d)));
    }
    expect(lineInk / count).toBeGreaterThan(0.5);
  });

  it('heavy noise in a dark area shows as specks, and lowering Detail removes them without losing the outline', () => {
    // ±8 grey levels per pixel in a dark area is a high-ISO shadow: the
    // shadow lift that finds an ear in shadow also lifts that noise.
    const S = 2;
    const w = W * S;
    const p = new SketchPipeline(synthetic(S, 16), w, H * S);
    const clean = (detail: number) => {
      const out = p.render('outline', { ...DEFAULT_CONTROLS, detail });
      let white = 0;
      let n = 0;
      for (let y = (DISC.y - 40) * S; y < (DISC.y + 40) * S; y++) for (let x = (DISC.x - 40) * S; x < (DISC.x + 40) * S; x++, n++) white += out[(y * w + x) * 4] > 245 ? 1 : 0;
      let outlined = 0;
      for (let a = 0; a < 360; a += 4) {
        let best = 0;
        for (let r = (DISC.r - 10) * S; r <= (DISC.r + 10) * S; r++) {
          const x = Math.round(DISC.x * S + r * Math.cos((a * Math.PI) / 180));
          const y = Math.round(DISC.y * S + r * Math.sin((a * Math.PI) / 180));
          best = Math.max(best, 255 - out[(y * w + x) * 4]);
        }
        outlined += best > 128 ? 1 : 0;
      }
      return { white: white / n, outlined: outlined / 90 };
    };
    expect(clean(50).white).toBeLessThan(0.97);
    expect(clean(30)).toEqual({ white: 1, outlined: 1 });
  });

  it('Pencil Study: graphite tones, never a solid black mass, lights stay paper', () => {
    const g = grey(new SketchPipeline(synthetic(), W, H).render('pencil', DEFAULT_CONTROLS));
    expect(solidBlackShare(g, 2)).toBe(0);
    // The disc is shaded, not black: its middle stays well above 25 % grey.
    let disc = 0;
    let n = 0;
    for (let y = DISC.y - 30; y < DISC.y + 30; y++) for (let x = DISC.x - 30; x < DISC.x + 30; x++, n++) disc += g[y * W + x];
    expect(disc / n).toBeGreaterThan(70);
    expect(disc / n).toBeLessThan(200);
    // The light ground is clean paper.
    let paper = 0;
    let m = 0;
    for (let y = 280; y < 340; y++) for (let x = 380; x < 460; x++, m++) paper += g[y * W + x];
    expect(paper / m).toBeGreaterThan(235);
  });

  it('each control moves the drawing the way its name says', () => {
    const p = new SketchPipeline(synthetic(), W, H);
    const at = (style: 'outline' | 'pencil', c: Partial<SketchControls>) => grey(p.render(style, { ...DEFAULT_CONTROLS, ...c }));
    const ink = (c: Partial<SketchControls>) => inkShare(at('outline', c));
    expect(ink({ detail: 0 })).toBeLessThanOrEqual(ink({ detail: 50 }));
    expect(ink({ detail: 50 })).toBeLessThanOrEqual(ink({ detail: 100 }));
    expect(ink({ lineWeight: 0 })).toBeLessThan(ink({ lineWeight: 50 }));
    expect(ink({ lineWeight: 50 })).toBeLessThan(ink({ lineWeight: 100 }));
    const dark = (shading: number) => meanDarkness(at('pencil', { shading }));
    expect(dark(0)).toBeLessThan(dark(50));
    expect(dark(50)).toBeLessThan(dark(100));
    expect(pencilShading(50)).toEqual({ max: 0.62, deepen: 0 });
    // The deepest shading still has no black mass (the boldest lines can be
    // dark strokes, but not areas).
    expect(solidBlackShare(at('pencil', { shading: 100 }), 2)).toBe(0);
    expect(solidBlackShare(at('pencil', { shading: 100, lineWeight: 100, detail: 100 }), 5)).toBe(0);
  });

  it('caches by stage: a control change only recomputes what depends on it', () => {
    const p = new SketchPipeline(synthetic(), W, H);
    p.render('pencil', DEFAULT_CONTROLS);
    const first = Object.keys(p.stats().timings);
    expect(first).toEqual(expect.arrayContaining(['smooth', 'directions', 'lines', 'tone', 'grain', 'detail', 'compose']));
    p.render('pencil', { ...DEFAULT_CONTROLS, shading: 80 });
    expect(Object.keys(p.stats().timings)).toEqual(['compose']);
    p.render('pencil', { ...DEFAULT_CONTROLS, shading: 80, lineWeight: 70 });
    expect(Object.keys(p.stats().timings).sort()).toEqual(['compose', 'weight']);
    p.render('outline', DEFAULT_CONTROLS);
    // The DoG response is shared; Clean Outline only adds its soft ridges.
    expect(Object.keys(p.stats().timings)).not.toContain('lines');
    expect(Object.keys(p.stats().timings)).toContain('ridges');
  });

  it('stays inside its memory budget, and gives everything back on release', () => {
    const n = W * H;
    const p = new SketchPipeline(synthetic(), W, H);
    p.render('outline', DEFAULT_CONTROLS);
    p.render('pencil', DEFAULT_CONTROLS);
    p.render('outline', { ...DEFAULT_CONTROLS, detail: 70, lineWeight: 80 });
    const s = p.stats();
    // Measured: 68 bytes per pixel at the peak, 48 held (both styles cached).
    expect(s.peakBytes / n).toBeLessThanOrEqual(72);
    expect(s.liveBytes / n).toBeLessThanOrEqual(52);
    p.release();
    expect(p.stats().liveBytes).toBe(0);
    expect(p.stats().allocatedBytes).toBe(0);

    // Compact (phones): only the active style is held.
    const c = new SketchPipeline(synthetic(), W, H, true);
    c.render('outline', DEFAULT_CONTROLS);
    c.render('pencil', DEFAULT_CONTROLS);
    expect(c.stats().liveBytes / n).toBeLessThanOrEqual(36);
    c.render('outline', DEFAULT_CONTROLS);
    expect(c.stats().liveBytes / n).toBeLessThanOrEqual(24);
    expect(c.stats().allocatedBytes / n).toBeLessThanOrEqual(36);
  });

  it('draws the overlay in red over a lightened copy of the photo', () => {
    const p = new SketchPipeline(synthetic(), W, H);
    const out = p.overlay('outline', DEFAULT_CONTROLS);
    const ink = grey(p.render('outline', DEFAULT_CONTROLS));
    let red = 0;
    let lines = 0;
    for (let i = 0; i < W * H; i++) {
      if (ink[i] < 60) {
        lines++;
        if (out[i * 4] > 180 && out[i * 4 + 1] < 90 && out[i * 4 + 2] < 90) red++;
      }
    }
    expect(red / lines).toBeGreaterThan(0.95);
    // Away from lines it is the photo, lightened: the disc reads darker than the ground.
    const at = (x: number, y: number) => out[(y * W + x) * 4 + 1];
    expect(at(DISC.x, DISC.y)).toBeLessThan(at(400, 300));
    expect(at(DISC.x, DISC.y)).toBeGreaterThan(140);
  });

  it('exports Clean Outline as true vector shapes that match the raster', () => {
    const p = new SketchPipeline(synthetic(), W, H);
    const svg = p.outlineSvg(DEFAULT_CONTROLS, 1200, 900);
    expect(svg).toMatch(/^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" width="1200" height="900" viewBox="0 0 480 360">/);
    // Only vector elements: no embedded raster of any kind.
    expect(svg).not.toMatch(/<image|data:|base64|<foreignObject/i);
    const tags = [...svg.matchAll(/<(\w+)/g)].map((m) => m[1]);
    expect(new Set(tags)).toEqual(new Set(['svg', 'rect', 'path']));
    expect(svg).toContain('fill-rule="evenodd"');

    // Every layer's shapes cover the pixels whose ink reaches that layer's level.
    const ink = new Float32Array(W * H);
    const g = grey(p.render('outline', DEFAULT_CONTROLS));
    for (let i = 0; i < ink.length; i++) ink[i] = (255 - g[i]) / 255 / 0.92;
    for (const layer of OUTLINE_LAYERS.slice(1)) {
      const loops = isoLoops(ink, W, H, layer.level);
      // Loops are in pixel space: pixel (x, y) has its centre at (x + 0.5, y + 0.5).
      const inside = (x: number, y: number) => {
        let c = false;
        for (const l of loops) {
          for (let i = 0, j = l.length - 2; i < l.length; j = i, i += 2) {
            const [xi, yi, xj, yj] = [l[i], l[i + 1], l[j], l[j + 1]];
            if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
          }
        }
        return c;
      };
      let both = 0;
      let either = 0;
      for (let y = 0; y < H; y += 2) {
        for (let x = 0; x < W; x += 2) {
          const a = ink[y * W + x] >= layer.level;
          const b = inside(x + 0.5, y + 0.5);
          if (a && b) both++;
          if (a || b) either++;
        }
      }
      expect(both / either).toBeGreaterThan(0.85);
    }
  });

  it('reads damaged settings safely', () => {
    expect(normalizeControls({ lineWeight: 140, detail: -3, shading: Number.NaN })).toEqual({ lineWeight: 100, detail: 0, shading: 50 });
    expect(normalizeControls(undefined)).toEqual(DEFAULT_CONTROLS);
    expect(() => new SketchPipeline(new Uint8ClampedArray(10), 4, 4)).toThrow();
  });
});
