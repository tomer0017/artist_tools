import { describe, expect, it } from 'vitest';
import { analyzeSketch } from './pipeline';
import type { SketchSource, SketchStroke } from './types';

const W = 220;
const H = 220;
const BOX = { x0: 60, y0: 55, x1: 160, y1: 175 };

/**
 * A dark rectangle on a light ground, buried in fine texture. This is the
 * benchmark the redesign is aimed at: an edge detector reports the texture,
 * a drawing reports the rectangle.
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

  it('reveals progressively more of the drawing as detail rises', () => {
    const scene = syntheticScene(10);
    const simple = analyzeSketch(scene, { detail: 0 });
    const detailed = analyzeSketch(scene, { detail: 1 });
    const length = (d: typeof simple) =>
      d.strokes.reduce((n, s) => n + s.points.length / 2, 0);
    expect(length(detailed)).toBeGreaterThanOrEqual(length(simple));
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
    const inside = tone[(115 * W + 110)];
    const outside = tone[(20 * W + 20)];
    expect(inside).toBeGreaterThan(outside);
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
    expect(performance.now() - t0).toBeLessThan(2500);
  });
});
