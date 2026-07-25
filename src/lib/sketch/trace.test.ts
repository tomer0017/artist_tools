import { describe, expect, it } from 'vitest';
import {
  buildTraceSource, traceImage, DEFAULT_TRACE, TRACE_PRESETS,
  inkToRatio, detailToAreaFraction,
} from './trace';
import { traceToSvg } from './vector';
import { fillSmallHoles } from './regions';

const W = 200;
const H = 200;
const BOX = { x0: 55, y0: 50, x1: 150, y1: 165 };

/** A dark rectangle on a light ground, plus speckle noise. */
function scene({ noise = 0, specks = 0, gradient = 0 } = {}) {
  const data = new Uint8ClampedArray(W * H * 4);
  let seed = 4242;
  const rand = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 0xffffffff;
  };
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const inside = x >= BOX.x0 && x < BOX.x1 && y >= BOX.y0 && y < BOX.y1;
      // A left-to-right lighting ramp, to exercise the local threshold.
      let v = (inside ? 40 : 210) + gradient * (x / W - 0.5) * 2;
      v += (rand() - 0.5) * noise;
      const i = (y * W + x) * 4;
      data[i] = data[i + 1] = data[i + 2] = Math.max(0, Math.min(255, v));
      data[i + 3] = 255;
    }
  }
  // Isolated dark specks, the thing "Noise" exists to remove.
  for (let s = 0; s < specks; s++) {
    const cx = 10 + Math.floor(rand() * (W - 20));
    const cy = 10 + Math.floor(rand() * (H - 20));
    for (let dy = 0; dy < 2; dy++) {
      for (let dx = 0; dx < 2; dx++) {
        const i = ((cy + dy) * W + cx + dx) * 4;
        data[i] = data[i + 1] = data[i + 2] = 20;
      }
    }
  }
  return { data, width: W, height: H };
}

const settings = (patch: Partial<typeof DEFAULT_TRACE> = {}) => ({ ...DEFAULT_TRACE, ...patch });

describe('vector trace — determinism', () => {
  it('produces byte-identical paths for the same pixels and settings', () => {
    const s = settings();
    const a = traceImage(buildTraceSource(scene({ noise: 20 })), s);
    const b = traceImage(buildTraceSource(scene({ noise: 20 })), s);
    expect(a.loops.length).toBe(b.loops.length);
    expect(a.stats.coverage).toBe(b.stats.coverage);
    for (let i = 0; i < a.loops.length; i++) expect(a.loops[i]).toEqual(b.loops[i]);
  });

  it('does not depend on the order controls were changed in', () => {
    const source = buildTraceSource(scene({ noise: 15 }));
    const target = settings({ ink: 62, smoothing: 20, detail: 30, separation: 45 });
    const direct = traceImage(source, target);
    // Walk through unrelated settings first; the memo chain must not leak state.
    traceImage(source, settings({ ink: 20, smoothing: 90, detail: 4, separation: 90 }));
    traceImage(source, settings({ ink: 90, local: 0, separation: 0 }));
    const afterDetour = traceImage(source, target);
    expect(afterDetour.stats.coverage).toBe(direct.stats.coverage);
    expect(afterDetour.loops.length).toBe(direct.loops.length);
  });
});

describe('vector trace — the operator owns the result', () => {
  const source = buildTraceSource(scene({ noise: 12 }));

  it('Ink controls how much black, monotonically and without cliffs', () => {
    let previous = -1;
    const steps: number[] = [];
    for (let ink = 0; ink <= 100; ink += 5) {
      const { stats } = traceImage(source, settings({ ink, detail: 0 }));
      expect(stats.coverage, `ink=${ink}`).toBeGreaterThanOrEqual(previous - 1e-9);
      if (previous >= 0) steps.push(stats.coverage - previous);
      previous = stats.coverage;
    }
    // No single 5-point move may swing more than a third of the frame: that is
    // the "whole face goes black in one nudge" failure the curve exists to
    // prevent.
    expect(Math.max(...steps)).toBeLessThan(0.34);
  });

  it('spends its travel on the useful band rather than the extremes', () => {
    // The mapping must not park most of the slider outside the range where a
    // portrait is readable.
    // The band measured on real portraits: below ~0.3 nothing survives, above
    // ~0.65 the face floods solid.
    expect(inkToRatio(0)).toBeGreaterThanOrEqual(0.28);
    expect(inkToRatio(100)).toBeLessThan(0.66);
    // …and the readable middle really is in the middle of the travel.
    const mid = inkToRatio(50);
    expect(mid).toBeGreaterThan(0.42);
    expect(mid).toBeLessThan(0.52);
    // Monotone across the whole control.
    let previous = -1;
    for (let ink = 0; ink <= 100; ink += 1) {
      const r = inkToRatio(ink);
      expect(r).toBeGreaterThanOrEqual(previous);
      previous = r;
    }
  });

  it('Detail removes small shapes and nothing else', () => {
    const speckled = buildTraceSource(scene({ specks: 60 }));
    const raw = traceImage(speckled, settings({ detail: 0, smoothing: 0, local: 0, simplify: 0 }));
    const cleaned = traceImage(speckled, settings({ detail: 60, smoothing: 0, local: 0, simplify: 0 }));
    expect(cleaned.stats.regions).toBeLessThan(raw.stats.regions);
    expect(cleaned.stats.regions).toBe(1); // the rectangle, and only the rectangle
  });

  it('Detail means the same thing at any resolution', () => {
    // The same scene at two sizes must keep or drop the same shapes, because
    // the control is a share of the frame and not a pixel count.
    const small = buildTraceSource(scene({ specks: 40 }));
    const scaled = { data: new Uint8ClampedArray(W * 2 * H * 2 * 4), width: W * 2, height: H * 2 };
    const src = scene({ specks: 40 });
    for (let y = 0; y < H * 2; y++) {
      for (let x = 0; x < W * 2; x++) {
        const from = (((y / 2) | 0) * W + ((x / 2) | 0)) * 4;
        const to = (y * (W * 2) + x) * 4;
        scaled.data[to] = src.data[from];
        scaled.data[to + 1] = src.data[from + 1];
        scaled.data[to + 2] = src.data[from + 2];
        scaled.data[to + 3] = 255;
      }
    }
    const s = settings({ detail: 55, smoothing: 0, local: 0, simplify: 0 });
    const a = traceImage(small, s);
    const b = traceImage(buildTraceSource(scaled), s);
    expect(b.stats.regions).toBe(a.stats.regions);
    expect(b.stats.coverage).toBeCloseTo(a.stats.coverage, 2);
    // …and the raw pixel floor really did scale with the frame.
    expect(b.stats.minShapePx).toBeGreaterThan(a.stats.minShapePx * 3);
  });

  it('Detail is a curve, so the left half moves in small steps', () => {
    expect(detailToAreaFraction(0)).toBe(0);
    expect(detailToAreaFraction(25)).toBeLessThan(detailToAreaFraction(50) / 3);
    let previous = -1;
    for (let d = 0; d <= 100; d += 1) {
      const f = detailToAreaFraction(d);
      expect(f).toBeGreaterThanOrEqual(previous);
      previous = f;
    }
  });

  it('keeps a compact white hole but fills a sliver of the same area', () => {
    // Two pockets of identical area inside one mass: a round one — the shape of
    // an eye white, or the gap between a brow and a lid — and a thin sliver,
    // the shape of a threshold artifact. Judging on size alone takes both.
    // Judging on shape as well must take only the sliver.
    const build = (hole: 'round' | 'sliver') => {
      const m = new Uint8Array(60 * 60);
      for (let y = 10; y < 50; y++) for (let x = 10; x < 50; x++) m[y * 60 + x] = 1;
      if (hole === 'round') {
        for (let y = 28; y < 33; y++) for (let x = 28; x < 33; x++) m[y * 60 + x] = 0;
      } else {
        for (let x = 18; x < 43; x++) m[30 * 60 + x] = 0;
      }
      return m;
    };
    const area = 25;
    const opts = { protectShaped: true, tinyArea: 4 };
    const holeSurvives = (m: Uint8Array) => {
      const filled = fillSmallHoles(m, 60, 60, area * 2, opts);
      let white = 0;
      for (let y = 10; y < 50; y++) for (let x = 10; x < 50; x++) if (!filled[y * 60 + x]) white++;
      return white > 0;
    };
    expect(holeSurvives(build('round'))).toBe(true);
    expect(holeSurvives(build('sliver'))).toBe(false);
  });

  it('leaves eye-sized marks alone at every Detail setting', () => {
    // An iris covers roughly 0.12% of a frame-filling portrait. The cleanup
    // ceiling must sit below that, or the control quietly closes the eyes.
    expect(detailToAreaFraction(100)).toBeLessThan(0.001);
  });

  it('Separation pushes lights and darks apart without inventing shapes', () => {
    const flat = buildTraceSource(scene({ noise: 8 }));
    const none = traceImage(flat, settings({ separation: 0 }));
    const strong = traceImage(flat, settings({ separation: 80 }));
    // It changes the picture…
    expect(strong.stats.coverage).not.toBe(none.stats.coverage);
    // …but it must not shatter it into a field of fragments.
    expect(strong.stats.regions).toBeLessThan(none.stats.regions + 6);
  });

  it('spreads the picture across the travel instead of clipping at the ends', () => {
    // Measured in the default local mode, which is what the UI ships.
    const at = (ink: number) =>
      traceImage(source, settings({ ink, detail: 0, separation: 0 })).stats.coverage;
    const low = at(0);
    const mid = at(50);
    const high = at(100);
    // Low keeps the darkest areas — "minimal ink", not a blank page.
    expect(low).toBeGreaterThan(0);
    expect(low).toBeLessThan(mid);
    expect(mid).toBeLessThan(high);
    // And the picture is already well established by the middle of the travel,
    // rather than everything happening in the last few percent.
    expect(mid).toBeGreaterThan(0.2);
  });

  it('simplify reduces the number of points without losing the shape', () => {
    const tight = traceImage(source, settings({ simplify: 0 }));
    const loose = traceImage(source, settings({ simplify: 100 }));
    const points = (r: typeof tight) => r.loops.reduce((n, l) => n + l.length / 2, 0);
    expect(points(loose)).toBeLessThan(points(tight));
    expect(loose.loops.length).toBeGreaterThan(0);
  });

  it('invert swaps black for white', () => {
    const normal = traceImage(source, settings({ detail: 0 }));
    const inverted = traceImage(source, settings({ detail: 0, invert: true }));
    expect(normal.stats.coverage + inverted.stats.coverage).toBeCloseTo(1, 5);
  });

  it('the local threshold survives uneven lighting where a global one cannot', () => {
    const lit = buildTraceSource(scene({ gradient: 150 }));
    const global = traceImage(lit, settings({ local: 0, ink: 50 }));
    const local = traceImage(lit, settings({ local: 10, ink: 50 }));
    // The ramp drags one whole side of the frame past a global level; a local
    // reference tracks it and still returns just the rectangle.
    expect(local.stats.coverage).toBeLessThan(global.stats.coverage);
    expect(local.stats.regions).toBeLessThanOrEqual(2);
  });

  it('clamps out-of-range settings instead of misbehaving', () => {
    const wild = traceImage(source, {
      ink: 9999, detail: -20, separation: NaN, invert: false,
      smoothing: 1e6, local: -5, simplify: 500, corners: -1,
    });
    expect(wild.settings.ink).toBe(100);
    expect(wild.settings.detail).toBe(0);
    expect(wild.settings.separation).toBe(0);
    expect(wild.settings.local).toBe(0);
    expect(wild.settings.simplify).toBe(100);
    expect(Number.isFinite(wild.stats.coverage)).toBe(true);
  });

  it('ships presets that are just control values', () => {
    for (const preset of TRACE_PRESETS) {
      const result = traceImage(source, preset.settings);
      expect(result.settings, preset.id).toEqual(preset.settings);
      expect(result.stats.coverage, preset.id).toBeGreaterThan(0);
    }
  });

  it('exports the same paths as SVG', () => {
    const result = traceImage(source, settings());
    const svg = traceToSvg(result);
    expect(svg.startsWith('<svg')).toBe(true);
    expect(svg).toContain('fill-rule="evenodd"');
    expect(svg.trimEnd().endsWith('</svg>')).toBe(true);
    // Sharp corners emit line segments, rounded ones emit quadratics.
    expect(traceToSvg(traceImage(source, settings({ corners: 0 })))).not.toContain('Q');
    expect(traceToSvg(traceImage(source, settings({ corners: 100 })))).toContain('Q');
  });

  it('stays interactive on a full-size frame', () => {
    const big = { data: new Uint8ClampedArray(900 * 600 * 4), width: 900, height: 600 };
    for (let p = 0; p < 900 * 600; p++) {
      const x = p % 900;
      const y = (p / 900) | 0;
      const v = x > 250 && x < 650 && y > 120 && y < 520 ? 50 : 200;
      big.data[p * 4] = big.data[p * 4 + 1] = big.data[p * 4 + 2] = v;
      big.data[p * 4 + 3] = 255;
    }
    const src = buildTraceSource(big);
    const t0 = performance.now();
    traceImage(src, settings());
    expect(performance.now() - t0).toBeLessThan(4000);
  });
});
