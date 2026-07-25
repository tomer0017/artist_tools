import { describe, expect, it } from 'vitest';
import { buildTraceSource, traceImage, DEFAULT_TRACE, TRACE_PRESETS } from './trace';
import { traceToSvg } from './vector';

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
    const target = settings({ threshold: 140, smoothing: 20, noise: 30 });
    const direct = traceImage(source, target);
    // Walk through unrelated settings first; the cache must not leak state.
    traceImage(source, settings({ threshold: 60, smoothing: 90, noise: 4 }));
    traceImage(source, settings({ threshold: 200, adaptive: 0 }));
    const afterDetour = traceImage(source, target);
    expect(afterDetour.stats.coverage).toBe(direct.stats.coverage);
    expect(afterDetour.loops.length).toBe(direct.loops.length);
  });
});

describe('vector trace — the operator owns the result', () => {
  const source = buildTraceSource(scene({ noise: 12 }));

  it('threshold controls how much black, monotonically', () => {
    let previous = -1;
    for (const threshold of [40, 80, 120, 160, 200, 240]) {
      const { stats } = traceImage(source, settings({ threshold, adaptive: 0 }));
      expect(stats.coverage, `threshold=${threshold}`).toBeGreaterThanOrEqual(previous);
      previous = stats.coverage;
    }
  });

  it('reaches all black and all white at the extremes', () => {
    expect(traceImage(source, settings({ threshold: 0, adaptive: 0, noise: 0 })).stats.coverage)
      .toBe(0);
    expect(traceImage(source, settings({ threshold: 255, adaptive: 0, noise: 0 })).stats.coverage)
      .toBe(1);
  });

  it('noise removes small features and nothing else', () => {
    const speckled = buildTraceSource(scene({ specks: 60 }));
    const raw = traceImage(speckled, settings({ noise: 0, smoothing: 0, adaptive: 0, simplify: 0 }));
    const cleaned = traceImage(speckled, settings({ noise: 80, smoothing: 0, adaptive: 0, simplify: 0 }));
    expect(cleaned.stats.regions).toBeLessThan(raw.stats.regions);
    expect(cleaned.stats.regions).toBe(1); // the rectangle, and only the rectangle
  });

  it('simplify reduces the number of points without losing the shape', () => {
    const tight = traceImage(source, settings({ simplify: 0 }));
    const loose = traceImage(source, settings({ simplify: 100 }));
    const points = (r: typeof tight) => r.loops.reduce((n, l) => n + l.length / 2, 0);
    expect(points(loose)).toBeLessThan(points(tight));
    expect(loose.loops.length).toBeGreaterThan(0);
  });

  it('invert swaps black for white', () => {
    const normal = traceImage(source, settings({ noise: 0 }));
    const inverted = traceImage(source, settings({ noise: 0, invert: true }));
    expect(normal.stats.coverage + inverted.stats.coverage).toBeCloseTo(1, 5);
  });

  it('the local threshold survives uneven lighting where a global one cannot', () => {
    const lit = buildTraceSource(scene({ gradient: 150 }));
    const global = traceImage(lit, settings({ adaptive: 0, threshold: 128 }));
    const local = traceImage(lit, settings({ adaptive: 10, threshold: 128 }));
    // The ramp drags one whole side of the frame past a global level; a local
    // reference tracks it and still returns just the rectangle.
    expect(local.stats.coverage).toBeLessThan(global.stats.coverage);
    expect(local.stats.regions).toBeLessThanOrEqual(2);
  });

  it('clamps out-of-range settings instead of misbehaving', () => {
    const wild = traceImage(
      source,
      { threshold: 9999, adaptive: -5, smoothing: 1e6, noise: -20, simplify: 500, corners: -1, invert: false },
    );
    expect(wild.settings.threshold).toBe(255);
    expect(wild.settings.adaptive).toBe(0);
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
