import { describe, expect, it } from 'vitest';
import { analyzeSketch, buildSketchAnalysis, composeSketch, resolveBudget } from './pipeline';
import { SKETCH_STYLES } from './styles';
import { LAYER_ORDER, type SketchSource, type SketchStroke } from './types';

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

describe('analyzeSketch', () => {
  it('draws the shape and ignores the texture', () => {
    const drawing = analyzeSketch(syntheticScene(22), { detail: 0.5 });
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
      const drawing = analyzeSketch(syntheticScene(14), { detail });
      expect(drawing.strokes.length, `detail=${detail}`).toBeGreaterThan(0);
    }
  });

  it('gives the drawing a line hierarchy rather than one uniform width', () => {
    const drawing = analyzeSketch(syntheticScene(16), { detail: 0.5 });
    const widths = new Set<number>();
    for (const s of drawing.strokes) {
      for (let i = 0; i < s.widths.length; i++) widths.add(Math.round(s.widths[i] * 4) / 4);
    }
    expect(widths.size).toBeGreaterThan(1);
    expect(drawing.stats.weights.heavy).toBeGreaterThan(0);
  });

  it('produces shading only when asked for it', () => {
    const scene = syntheticScene(12);
    expect(analyzeSketch(scene, { detail: 0.5 }).shading).toBeNull();
    const shaded = analyzeSketch(scene, { detail: 0.5, shading: true });
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
    expect(performance.now() - t0).toBeLessThan(3000);
  });
});

/**
 * The behaviour the Detail slider is built around: raising it must add to the
 * drawing that was already there, never replace it.
 */
describe('the Detail slider is cumulative', () => {
  const analysis = buildSketchAnalysis(syntheticScene(16));
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
