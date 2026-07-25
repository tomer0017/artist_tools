import { describe, expect, it } from 'vitest';
import { analyzeSketch, buildSketchAnalysis, composeSketch, resolveBudget } from './pipeline';
import { sketchToSvg } from './vector';
import { SKETCH_STYLES } from './styles';
import { LAYER_ORDER, type SketchDrawing, type SketchSource, type SketchStroke } from './types';

/**
 * Even-odd scanline fill of the traced loops, so the cumulative guarantee can
 * be asserted where it actually matters — on the black pixels a painter sees,
 * not on a proxy like loop count.
 */
function rasterize(drawing: SketchDrawing): Uint8Array {
  const { width: w, height: h } = drawing;
  const out = new Uint8Array(w * h);
  if (!drawing.shapes) return out;
  const xs: number[] = [];
  for (let y = 0; y < h; y++) {
    const scan = y + 0.5;
    xs.length = 0;
    for (const loop of drawing.shapes.loops) {
      const n = loop.length / 2;
      for (let i = 0; i < n; i++) {
        const x1 = loop[i * 2];
        const y1 = loop[i * 2 + 1];
        const x2 = loop[((i + 1) % n) * 2];
        const y2 = loop[((i + 1) % n) * 2 + 1];
        if (y1 === y2) continue;
        if (scan >= Math.min(y1, y2) && scan < Math.max(y1, y2)) {
          xs.push(x1 + ((scan - y1) / (y2 - y1)) * (x2 - x1));
        }
      }
    }
    xs.sort((a, b) => a - b);
    for (let i = 0; i + 1 < xs.length; i += 2) {
      const from = Math.max(0, Math.ceil(xs[i] - 0.5));
      const to = Math.min(w - 1, Math.floor(xs[i + 1] - 0.5));
      for (let x = from; x <= to; x++) out[y * w + x] = 1;
    }
  }
  return out;
}

const W = 220;
const H = 220;
const BOX = { x0: 60, y0: 55, x1: 160, y1: 175 };

/**
 * A dark rectangle on a light ground, buried in fine texture. This is the
 * benchmark the engine is aimed at: an edge detector reports the texture, a
 * drawing reports the rectangle.
 */
function syntheticScene(noise: number): SketchSource {
  const data = new Uint8ClampedArray(W * H * 4);
  // Deterministic pseudo-noise so the assertions below are stable.
  let seed = 12345;
  const rand = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 0xffffffff;
  };
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const inside = x >= BOX.x0 && x < BOX.x1 && y >= BOX.y0 && y < BOX.y1;
      const base = inside ? 48 : 214;
      // High-frequency texture: alternating pixels plus random speckle. Both
      // are exactly the kind of contrast a painter would never draw.
      const texture = ((x + y) % 2 === 0 ? noise : -noise) + (rand() - 0.5) * noise;
      const v = Math.max(0, Math.min(255, base + texture));
      const i = (y * W + x) * 4;
      data[i] = v;
      data[i + 1] = v;
      data[i + 2] = v;
      data[i + 3] = 255;
    }
  }
  return { data, width: W, height: H };
}

/** Fraction of a stroke's points sitting within `tol` px of the box outline. */
function onBoxFraction(stroke: SketchStroke, tol = 4): number {
  const n = stroke.points.length / 2;
  let hits = 0;
  for (let i = 0; i < n; i++) {
    const x = stroke.points[i * 2];
    const y = stroke.points[i * 2 + 1];
    const dx = Math.min(Math.abs(x - BOX.x0), Math.abs(x - BOX.x1));
    const dy = Math.min(Math.abs(y - BOX.y0), Math.abs(y - BOX.y1));
    const insideSpanX = x >= BOX.x0 - tol && x <= BOX.x1 + tol;
    const insideSpanY = y >= BOX.y0 - tol && y <= BOX.y1 + tol;
    if ((dx <= tol && insideSpanY) || (dy <= tol && insideSpanX)) hits++;
  }
  return n ? hits / n : 0;
}

const ids = (strokes: SketchStroke[]) => new Set(strokes.map((s) => s.id));

describe('analyzeSketch (pencil — line work)', () => {
  it('draws the shape and ignores the texture', () => {
    const drawing = analyzeSketch(syntheticScene(22), { detail: 0.5, style: 'artist' });
    expect(drawing.strokes.length).toBeGreaterThan(0);
    // Only the rectangle is worth drawing, so the result must be a handful of
    // strokes rather than a field of texture fragments.
    expect(drawing.strokes.length).toBeLessThan(40);
    const points = drawing.strokes.reduce((n, s) => n + s.points.length / 2, 0);
    const onBox = drawing.strokes.reduce(
      (n, s) => n + onBoxFraction(s) * (s.points.length / 2),
      0,
    );
    expect(onBox / points).toBeGreaterThan(0.8);
  });

  it('never returns an empty drawing for an image that has a shape in it', () => {
    for (const detail of [0, 0.25, 0.5, 0.75, 1]) {
      const drawing = analyzeSketch(syntheticScene(14), { detail, style: 'artist' });
      expect(drawing.strokes.length, `detail=${detail}`).toBeGreaterThan(0);
    }
  });

  it('gives the drawing a line hierarchy rather than one uniform width', () => {
    const drawing = analyzeSketch(syntheticScene(16), { detail: 0.5, style: 'artist' });
    const widths = new Set<number>();
    for (const s of drawing.strokes) {
      for (let i = 0; i < s.widths.length; i++) widths.add(Math.round(s.widths[i] * 4) / 4);
    }
    expect(widths.size).toBeGreaterThan(1);
    expect(drawing.stats.weights.heavy).toBeGreaterThan(0);
  });

  it('produces shading only when asked for it', () => {
    const scene = syntheticScene(12);
    expect(analyzeSketch(scene, { detail: 0.5, style: 'artist' }).shading).toBeNull();
    const shaded = analyzeSketch(scene, { detail: 0.5, shading: true, style: 'artist' });
    expect(shaded.shading).not.toBeNull();
    // Tone belongs in the dark rectangle, not on the light ground.
    const tone = shaded.shading!.tone;
    expect(tone[115 * W + 110]).toBeGreaterThan(tone[20 * W + 20]);
  });

  it('stays interactive on a full-size frame', () => {
    const big: SketchSource = {
      data: new Uint8ClampedArray(900 * 600 * 4),
      width: 900,
      height: 600,
    };
    for (let y = 0; y < 600; y++) {
      for (let x = 0; x < 900; x++) {
        const i = (y * 900 + x) * 4;
        const v = x > 250 && x < 650 && y > 120 && y < 520 ? 60 : 200;
        big.data[i] = big.data[i + 1] = big.data[i + 2] = v + ((x * 7 + y * 3) % 11);
        big.data[i + 3] = 255;
      }
    }
    const t0 = performance.now();
    analyzeSketch(big, { detail: 0.5 });
    expect(performance.now() - t0).toBeLessThan(4000);
  });
});

/**
 * The behaviour the Detail slider is built around: raising it must add to the
 * drawing that was already there, never replace it.
 */
describe('the Detail slider is cumulative (pencil — line work)', () => {
  const analysis = buildSketchAnalysis(syntheticScene(16), 'artist');
  const at = (detail: number) => composeSketch(analysis, { detail });

  it('makes every lower level a strict subset of every higher one', () => {
    const levels = [0, 0.2, 0.4, 0.5, 0.7, 0.9, 1].map(at);
    for (let i = 1; i < levels.length; i++) {
      const lower = ids(levels[i - 1].strokes);
      const higher = ids(levels[i].strokes);
      for (const id of lower) {
        expect(higher.has(id), `stroke ${id} disappeared between step ${i - 1} and ${i}`).toBe(true);
      }
    }
  });

  it('keeps a stroke visually identical wherever it appears', () => {
    const simple = at(0);
    const detailed = at(1);
    const byId = new Map(detailed.strokes.map((s) => [s.id, s]));
    for (const s of simple.strokes) {
      const later = byId.get(s.id)!;
      // Same geometry, same weight class, same widths — the slider must not
      // restyle a line the artist has already been looking at.
      expect(later.weightClass).toBe(s.weightClass);
      expect(later.points).toEqual(s.points);
      expect(later.widths).toEqual(s.widths);
    }
  });

  it('adds information rather than swapping it', () => {
    const simple = at(0);
    const detailed = at(1);
    expect(detailed.strokes.length).toBeGreaterThan(simple.strokes.length);
  });

  it('always funds structure and facial features, even at Simple', () => {
    for (const style of Object.values(SKETCH_STYLES)) {
      if (style.params.render !== 'strokes' && !style.params.outline.enabled) continue;
      expect(style.params.layers.structure[0], style.id).toBeGreaterThan(0);
      expect(style.params.layers.face[0], style.id).toBeGreaterThan(0);
    }
  });

  it('holds fine detail back until the top of the slider', () => {
    // Simple is a clean construction sketch: no strands, no wrinkles.
    expect(SKETCH_STYLES.artist.params.layers.fine[0]).toBe(0);
    expect(SKETCH_STYLES.artist.params.layers.secondary[0]).toBe(0);
    expect(at(0).stats.layers.fine).toBe(0);
    expect(at(1).stats.layers.fine).toBeGreaterThanOrEqual(at(0.5).stats.layers.fine);
  });

  it('uses budget curves that never decrease', () => {
    for (const style of Object.values(SKETCH_STYLES)) {
      for (const layer of LAYER_ORDER) {
        const curve = style.params.layers[layer];
        expect(curve[1], `${style.id}/${layer}`).toBeGreaterThanOrEqual(curve[0]);
        expect(curve[2], `${style.id}/${layer}`).toBeGreaterThanOrEqual(curve[1]);
        // …and so does the interpolation between them.
        let previous = -Infinity;
        for (let d = 0; d <= 1.0001; d += 0.05) {
          const value = resolveBudget(curve, d);
          expect(value, `${style.id}/${layer} @ ${d.toFixed(2)}`).toBeGreaterThanOrEqual(previous);
          previous = value;
        }
      }
    }
  });

  it('re-composes far faster than it analyses', () => {
    const t0 = performance.now();
    for (let i = 0; i < 50; i++) composeSketch(analysis, { detail: i / 50 });
    // 50 slider ticks should cost a small fraction of one analysis pass.
    expect(performance.now() - t0).toBeLessThan(150);
  });
});


/**
 * The vector trace is the default style: black masses, not line work.
 */
describe('vector trace', () => {
  const scene = syntheticScene(18);
  const analysis = buildSketchAnalysis(scene);
  const at = (detail: number) => composeSketch(analysis, { detail });

  it('produces filled regions rather than strokes', () => {
    const drawing = at(0.5);
    expect(drawing.render).toBe('regions');
    expect(drawing.shapes).not.toBeNull();
    expect(drawing.shapes!.loops.length).toBeGreaterThan(0);
    expect(drawing.stats.coverage).toBeGreaterThan(0.02);
  });

  it('turns the dark rectangle into one clean mass, not a field of fragments', () => {
    const drawing = at(0.5);
    // A texture-driven trace would leave dozens of specks; a shape-driven one
    // leaves the rectangle.
    expect(drawing.stats.regions).toBeLessThanOrEqual(3);
    const black = rasterize(drawing);
    let inside = 0;
    let outside = 0;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        if (!black[y * W + x]) continue;
        const within = x >= BOX.x0 - 4 && x < BOX.x1 + 4 && y >= BOX.y0 - 4 && y < BOX.y1 + 4;
        if (within) inside++;
        else outside++;
      }
    }
    expect(inside).toBeGreaterThan(0);
    expect(outside / (inside + outside)).toBeLessThan(0.1);
  });

  it('only ever adds black as Detail rises', () => {
    const levels = [0, 0.25, 0.5, 0.75, 1].map((d) => rasterize(at(d)));
    for (let i = 1; i < levels.length; i++) {
      let lost = 0;
      for (let p = 0; p < levels[i].length; p++) {
        if (levels[i - 1][p] && !levels[i][p]) lost++;
      }
      // A handful of pixels may shift with the traced boundary; a shape going
      // away would be thousands.
      expect(lost, `black lost between step ${i - 1} and ${i}`).toBeLessThan(
        0.0005 * levels[i].length,
      );
    }
  });

  it('grows the amount of drawing with Detail', () => {
    expect(at(1).stats.coverage).toBeGreaterThan(at(0).stats.coverage);
  });

  it('rejects noise at every detail level', () => {
    // Pure noise, no shape at all: nothing here is worth drawing.
    const noise: SketchSource = { data: new Uint8ClampedArray(W * H * 4), width: W, height: H };
    let seed = 99;
    for (let p = 0; p < W * H; p++) {
      seed = (seed * 1103515245 + 12345) >>> 0;
      const v = 110 + ((seed >>> 16) % 60);
      noise.data[p * 4] = noise.data[p * 4 + 1] = noise.data[p * 4 + 2] = v;
      noise.data[p * 4 + 3] = 255;
    }
    const noisy = buildSketchAnalysis(noise);
    for (const detail of [0, 0.5, 1]) {
      const drawing = composeSketch(noisy, { detail });
      expect(drawing.stats.regions, `detail=${detail}`).toBeLessThan(6);
    }
  });

  it('exports an SVG of the same drawing', () => {
    const svg = sketchToSvg(at(0.5));
    expect(svg.startsWith('<svg')).toBe(true);
    expect(svg).toContain('fill-rule="evenodd"');
    expect(svg.trimEnd().endsWith('</svg>')).toBe(true);
  });
});
