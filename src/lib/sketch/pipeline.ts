/**
 * The sketch engine for one picture: staged, with each stage cached, so a
 * control only recomputes what depends on it.
 *
 *   per picture       lightness → edge-preserving smoothing → edge directions
 *                     → flow DoG response (shared by both styles); coarse
 *                     ridges for soft boundaries (Clean Outline); graphite
 *                     tone, form and grain (Pencil Study, built the first time
 *                     it is asked for)
 *   per Detail        which lines are drawn
 *   per Line weight   how wide they are
 *   per Shading       the graphite tone (Pencil Study)
 *
 * The expensive part is the first; it runs once per picture (≈1 s for 1.6
 * million pixels on a desktop). Moving a control costs tens of milliseconds.
 *
 * Output pixels are identical on every engine: there is no randomness (the
 * pencil grain is a hash of the pixel position) and no floating-point
 * operation whose result depends on the platform.
 */

import {
  PlanePool,
  blur,
  clamp01,
  domainTransform,
  gradients,
  hash01,
  liftShadows,
  lightness,
  sample,
  smoothstep,
  stretch,
  unit,
} from './planes';
import { cleanInk, flowDoG, hysteresis, inkFromDoG, narrow, softRidges, strokeEdges, tangentField, thicken } from './lines';
import {
  CONTOUR,
  OUTLINE,
  PENCIL,
  detailMapping,
  lineWeight,
  normalizeControls,
  pencilShading,
  type SketchControls,
  type SketchStyle,
} from './styles';
import { inkToPathLayers, pathLayersToSvg, type PathLayer } from './vector';

/** Grey of the outline's three vector layers: the raster grey at the middle of each ink band. */
const OUTLINE_BANDS: [number, number][] = [
  [0.15, 0.4],
  [0.4, 0.75],
  [0.75, 1.0],
];
const grey = (v: number) => `#${Math.round(v * 255).toString(16).padStart(2, '0').repeat(3)}`;
export const OUTLINE_LAYERS = OUTLINE_BANDS.map(([lo, hi]) => ({ level: lo, fill: grey(1 - OUTLINE.strength * ((lo + hi) / 2)) }));

/** Red for the outline-over-photo comparison, and how much the photo is lightened under it. */
const OVERLAY_RED = [225, 20, 30] as const;

interface Cached {
  key: string;
  plane: Float32Array;
}

export interface PipelineStats {
  /** Milliseconds per stage of the last call. */
  timings: Record<string, number>;
  /** Most memory the engine's planes held at once, in bytes. */
  peakBytes: number;
  /** Memory in the caches between calls, in bytes. */
  liveBytes: number;
  /** Everything allocated and not yet dropped (caches + planes kept for reuse), in bytes. */
  allocatedBytes: number;
}

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

export class SketchPipeline {
  readonly n: number;
  readonly u: number;
  private readonly pool: PlanePool;
  private timings: Record<string, number> = {};

  // Per picture.
  private response: Float32Array | null = null; // flow DoG response
  private ridges: Float32Array | null = null; // soft-boundary ridge strengths
  private tone: { curve: Float64Array; form: Float32Array; grainA: Float32Array; grainB: Float32Array } | null = null;

  // Per control value (one entry each; a drag changes one control at a time).
  private contour: Cached | null = null; // outline contours at a Detail
  private softKept: Cached | null = null; // soft ridges kept at a Detail
  private outlineInk: Cached | null = null; // final outline ink at Detail + Line weight
  private pencilContour: Cached | null = null;
  private pencilInk: Cached | null = null;

  /**
   * @param compact keep only the active style's caches between calls (phones):
   *   switching style then rebuilds the other one's per-picture stages instead
   *   of holding both in memory.
   */
  constructor(
    private readonly rgba: Uint8ClampedArray,
    readonly width: number,
    readonly height: number,
    private readonly compact = false,
  ) {
    if (width < 1 || height < 1 || rgba.length !== width * height * 4) throw new Error('SketchPipeline: pixel buffer does not match its size');
    this.n = width * height;
    this.u = unit(width, height);
    this.pool = new PlanePool(this.n, compact ? 2 : Infinity);
  }

  private time<T>(label: string, run: () => T): T {
    const t0 = now();
    const out = run();
    this.timings[label] = (this.timings[label] ?? 0) + (now() - t0);
    return out;
  }

  /** CIE lightness, contrast-stretched. */
  private preparedLightness(): Float32Array {
    return stretch(lightness(this.rgba, this.pool.take()), 0.005, 0.995);
  }

  /* ------------------------------------------------- per-picture stages -- */

  /** The flow DoG response (and, for Clean Outline, the soft ridges). */
  private ensureResponse(withRidges: boolean): void {
    if (this.response && (this.ridges || !withRidges)) return;
    const { width: w, height: h, u, pool } = this;
    const S = this.time('smooth', () => {
      const L = liftShadows(this.preparedLightness(), CONTOUR.shadowBoost);
      return domainTransform(L, w, h, CONTOUR.smoothS * u, CONTOUR.smoothR, pool);
    });
    if (!this.response) {
      const field = this.time('directions', () => tangentField(S, w, h, CONTOUR.sigmaC * u, pool));
      this.response = this.time('lines', () => flowDoG(S, w, h, field, Math.max(0.8, CONTOUR.sigmaE * u), CONTOUR.sigmaM * u, pool));
      pool.give(field.tx, field.ty);
    }
    if (withRidges && !this.ridges) this.ridges = this.time('ridges', () => softRidges(S, w, h, OUTLINE.soft.sigma * u, pool));
    pool.give(S);
  }

  private ensureTone(): NonNullable<SketchPipeline['tone']> {
    if (this.tone) return this.tone;
    const { width: w, height: h, n, u, pool } = this;
    const T = this.time('tone', () => {
      const L = liftShadows(this.preparedLightness(), PENCIL.toneLift);
      const T = domainTransform(L, w, h, PENCIL.toneS * u, PENCIL.toneR, pool);
      if (PENCIL.adapt > 0) {
        const B = blur(T, w, h, PENCIL.adaptSigma * u, pool);
        let mean = 0;
        for (let i = 0; i < n; i++) mean += B[i];
        mean /= n;
        for (let i = 0; i < n; i++) if (B[i] < mean) T[i] = clamp01(T[i] + PENCIL.adapt * (mean - B[i]));
        pool.give(B);
      }
      return T;
    });
    const form = this.time('form', () => {
      // How much form a region carries (0 = flat, 1 = clearly shaped): the
      // lightness change at a broad scale, as a lightness step.
      const sigma = PENCIL.formSigma * u;
      const B = blur(T, w, h, sigma, pool);
      const gx = pool.take();
      const gy = pool.take();
      gradients(B, w, h, gx, gy);
      pool.give(B);
      const k = Math.sqrt(2 * Math.PI) * sigma;
      const out = pool.take();
      for (let i = 0; i < n; i++) out[i] = smoothstep(0.02, 0.1, Math.sqrt(gx[i] * gx[i] + gy[i] * gy[i]) * k);
      pool.give(gx, gy);
      return out;
    });
    // The graphite curve of each pixel's tone, before Shading scales it. Kept
    // in double precision: it is exactly the value the compose step would
    // compute, without a Math.pow per pixel on every Shading change.
    const curve = this.time('tone', () => {
      const out = pool.takeWide();
      for (let i = 0; i < n; i++) out[i] = Math.pow(clamp01((1 - T[i] - PENCIL.paper) / (1 - PENCIL.paper)), PENCIL.gamma);
      pool.give(T);
      return out;
    });
    const grainA = this.time('grain', () => this.hatchTexture(45, PENCIL.strokeLength * u, 11));
    const grainB = this.time('grain', () => this.hatchTexture(-45, PENCIL.strokeLength * u, 23));
    this.tone = { curve, form, grainA, grainB };
    return this.tone;
  }

  /**
   * Directional pencil grain: white noise averaged along a fixed stroke angle.
   * Zero mean, unit variance, deterministic.
   */
  private hatchTexture(angleDeg: number, length: number, seed: number): Float32Array {
    const { width: w, height: h, n, pool } = this;
    const noise = pool.take();
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) noise[y * w + x] = hash01(x, y, seed) - 0.5;
    const a = (angleDeg * Math.PI) / 180;
    const dx = Math.cos(a);
    const dy = -Math.sin(a);
    const R = Math.max(1, Math.round(length));
    const out = pool.take();
    let sumSq = 0;
    for (let y = 0; y < h; y++) {
      const interiorRow = y > R && y < h - R - 1;
      for (let x = 0; x < w; x++) {
        let acc = noise[y * w + x];
        if (interiorRow && x > R && x < w - R - 1) {
          // Fast path: every sample is inside the frame, so `sample`'s clamps
          // are no-ops; the arithmetic is identical.
          for (let s = 1; s <= R; s++) {
            let ax = x + s * dx;
            let ay = y + s * dy;
            let x0 = ax | 0;
            let y0 = ay | 0;
            let fx = ax - x0;
            let fy = ay - y0;
            let r0 = y0 * w;
            let r1 = r0 + w;
            let top = noise[r0 + x0] + (noise[r0 + x0 + 1] - noise[r0 + x0]) * fx;
            let bot = noise[r1 + x0] + (noise[r1 + x0 + 1] - noise[r1 + x0]) * fx;
            const a = top + (bot - top) * fy;
            ax = x - s * dx;
            ay = y - s * dy;
            x0 = ax | 0;
            y0 = ay | 0;
            fx = ax - x0;
            fy = ay - y0;
            r0 = y0 * w;
            r1 = r0 + w;
            top = noise[r0 + x0] + (noise[r0 + x0 + 1] - noise[r0 + x0]) * fx;
            bot = noise[r1 + x0] + (noise[r1 + x0 + 1] - noise[r1 + x0]) * fx;
            acc += a + (top + (bot - top) * fy);
          }
        } else {
          for (let s = 1; s <= R; s++) acc += sample(noise, w, h, x + s * dx, y + s * dy) + sample(noise, w, h, x - s * dx, y - s * dy);
        }
        out[y * w + x] = acc;
        sumSq += acc * acc;
      }
    }
    const sd = Math.sqrt(sumSq / n) || 1;
    for (let i = 0; i < n; i++) out[i] /= sd;
    pool.give(noise);
    return out;
  }

  /* ---------------------------------------------- per-control stages -- */

  private replace(slot: 'contour' | 'softKept' | 'outlineInk' | 'pencilContour' | 'pencilInk', key: string, make: () => Float32Array): Float32Array {
    const cached = this[slot];
    if (cached && cached.key === key) return cached.plane;
    // Build first, then drop the old entry, so a stage can read its own
    // previous value's inputs if it needs to; the old plane is only freed
    // once nothing refers to it.
    const plane = make();
    if (cached) this.pool.give(cached.plane);
    this[slot] = { key, plane };
    return plane;
  }

  /** Clean Outline's ink (0..1) for these controls. */
  outlineInkFor(controls: SketchControls): Float32Array {
    const c = normalizeControls(controls);
    this.ensureResponse(true);
    const { width: w, height: h, u, pool } = this;
    const d = detailMapping(c.detail);
    const weight = lineWeight(c.lineWeight);
    const contour = this.replace('contour', `${c.detail}`, () =>
      this.time('detail', () => this.contourInk(OUTLINE, d)),
    );
    const soft = OUTLINE.soft;
    const softKept = this.replace('softKept', `${c.detail}`, () =>
      this.time('detail', () => {
        const ridges = hysteresis(this.ridges!, w, h, soft.low * d.soft, soft.high * d.soft, pool);
        const kept = cleanInk(ridges, w, h, 0.5, 0.5, Math.round(soft.minLength * d.soft * u), pool);
        pool.give(ridges);
        return kept;
      }),
    );
    return this.replace('outlineInk', `${c.detail}/${c.lineWeight}`, () =>
      this.time('weight', () => {
        const base = this.weighted(contour, weight.narrow, weight.thicken);
        const ink = pool.copy(base);
        const lines = strokeEdges(softKept, w, h, soft.width * weight.softWidth * u, pool);
        // Soft boundaries only where no contour is drawn already: the darkest
        // contour ink in a square around each soft-line pixel. (The same
        // window maximum as a full dilation, evaluated only where there is a
        // soft line, which is a few percent of the frame.)
        const R = Math.max(1, Math.round(soft.suppress * u));
        for (let y = 0; y < h; y++) {
          const y0 = y - R < 0 ? 0 : y - R;
          const y1 = y + R > h - 1 ? h - 1 : y + R;
          for (let x = 0; x < w; x++) {
            const i = y * w + x;
            const line = lines[i];
            if (line <= 0) continue;
            const x0 = x - R < 0 ? 0 : x - R;
            const x1 = x + R > w - 1 ? w - 1 : x + R;
            let near = 0;
            for (let yy = y0; yy <= y1; yy++) {
              const row = yy * w;
              for (let xx = x0; xx <= x1; xx++) if (base[row + xx] > near) near = base[row + xx];
            }
            const v = soft.weight * line * (1 - smoothstep(0.15, 0.5, near));
            if (v > ink[i]) ink[i] = v;
          }
        }
        pool.give(base, lines);
        return ink;
      }),
    );
  }

  /** Contour ink at a Detail: the soft threshold, then hysteresis and the size filter. */
  private contourInk(p: { e0: number; e1: number; weak: number; strong: number; minArea: number }, d: ReturnType<typeof detailMapping>): Float32Array {
    const { width: w, height: h, u, pool } = this;
    const H = this.response!;
    const e0 = p.e0 * d.edge;
    const e1 = p.e1 * d.edge;
    const raw = inkFromDoG(H, e0, e1, pool.take());
    // Below the default Detail a stroke must reach a stronger response at its
    // peak; at and above it the approved rule (ink ≥ strong) applies as is.
    const byResponse = d.keep > 1 ? { response: H, min: ((e0 + e1) / 2) * d.keep } : undefined;
    const kept = cleanInk(raw, w, h, p.weak, p.strong, Math.round(p.minArea * d.area * u * u), pool, byResponse);
    pool.give(raw);
    return kept;
  }

  /** Contours at a line weight, as a new pooled plane. */
  private weighted(contour: Float32Array, narrowBy: number, thickenBy: number): Float32Array {
    const { width: w, height: h, u, pool } = this;
    if (narrowBy > 0) return narrow(contour, this.response!, w, h, narrowBy, Math.max(1, 2 * CONTOUR.sigmaE * u), pool);
    if (thickenBy > 0) return thicken(contour, w, h, thickenBy * u, pool);
    return pool.copy(contour);
  }

  /** Pencil Study's contour layer (0..1) for these controls. */
  private pencilInkFor(c: SketchControls): Float32Array {
    this.ensureResponse(false);
    const { width: w, height: h, u, pool } = this;
    const d = detailMapping(c.detail);
    const weight = lineWeight(c.lineWeight);
    const contour = this.replace('pencilContour', `${c.detail}`, () => this.time('detail', () => this.contourInk(PENCIL, d)));
    return this.replace('pencilInk', `${c.detail}/${c.lineWeight}`, () => this.time('weight', () => this.weighted(contour, weight.narrow, weight.thicken)));
  }

  /* ------------------------------------------------------------ output -- */

  /** In compact mode, free what only the other style uses. */
  private focus(style: SketchStyle): void {
    if (!this.compact) return;
    const { pool } = this;
    if (style === 'pencil') {
      pool.give(this.ridges, this.contour?.plane, this.softKept?.plane, this.outlineInk?.plane);
      this.ridges = this.contour = this.softKept = this.outlineInk = null;
    } else {
      if (this.tone) {
        pool.give(this.tone.form, this.tone.grainA, this.tone.grainB);
        pool.giveWide(this.tone.curve);
      }
      pool.give(this.pencilContour?.plane, this.pencilInk?.plane);
      this.tone = this.pencilContour = this.pencilInk = null;
    }
  }

  /** The drawing as RGBA pixels (opaque, grey). */
  render(style: SketchStyle, controls: SketchControls, out = new Uint8ClampedArray(this.n * 4)): Uint8ClampedArray {
    this.timings = {};
    this.focus(style);
    const c = normalizeControls(controls);
    if (style === 'outline') {
      const ink = this.outlineInkFor(c);
      this.time('compose', () => {
        for (let p = 0, i = 0; p < this.n; p++, i += 4) {
          // Rounded through float32 like the approved prototype, so the bytes match it.
          const v = Math.fround(1 - OUTLINE.strength * ink[p]);
          const b = v <= 0 ? 0 : v >= 1 ? 255 : Math.round(v * 255);
          out[i] = out[i + 1] = out[i + 2] = b;
          out[i + 3] = 255;
        }
      });
      return out;
    }
    const tone = this.ensureTone();
    const ink = this.pencilInkFor(c);
    const { max: shading, deepen } = pencilShading(c.shading);
    this.time('compose', () => {
      const { curve, form, grainA, grainB } = tone;
      const cap = shading * 1.15;
      for (let p = 0, i = 0; p < this.n; p++, i += 4) {
        let tone = curve[p];
        if (deepen > 0) tone += deepen * tone * (1 - tone);
        let d = shading * tone;
        // Grain scales with darkness, so the lights stay clean paper, and with
        // form, so a flat backdrop gets an even tone instead of a field of
        // hatching; the cross direction only enters in the darker half.
        const cross = smoothstep(0.25, 0.5, d);
        const g = grainA[p] * (1 - 0.5 * cross) + grainB[p] * 0.5 * cross;
        const amp = PENCIL.grain * (PENCIL.flatGrain + (1 - PENCIL.flatGrain) * form[p]);
        // Capped, so grain can never punch a near-black speck into a dark area.
        d = Math.min(cap, Math.max(0, d * (1 + amp * g)));
        const value = Math.fround((1 - d) * (1 - PENCIL.lineStrength * ink[p]));
        const b = value <= 0 ? 0 : value >= 1 ? 255 : Math.round(value * 255);
        out[i] = out[i + 1] = out[i + 2] = b;
        out[i + 3] = 255;
      }
    });
    return out;
  }

  /** The drawing's lines in red over a lightened grey copy of the photo, for checking them against it. */
  overlay(style: SketchStyle, controls: SketchControls, out = new Uint8ClampedArray(this.n * 4)): Uint8ClampedArray {
    this.timings = {};
    this.focus(style);
    const c = normalizeControls(controls);
    const ink = style === 'outline' ? this.outlineInkFor(c) : this.pencilInkFor(c);
    const strength = style === 'outline' ? OUTLINE.strength : PENCIL.lineStrength;
    const rgba = this.rgba;
    this.time('overlay', () => {
      for (let p = 0, i = 0; p < this.n; p++, i += 4) {
        const luma = 0.2126 * rgba[i] + 0.7152 * rgba[i + 1] + 0.0722 * rgba[i + 2];
        const base = luma * 0.45 + 135;
        const a = Math.min(1, ink[p] * strength * 1.15);
        out[i] = base + (OVERLAY_RED[0] - base) * a;
        out[i + 1] = base + (OVERLAY_RED[1] - base) * a;
        out[i + 2] = base + (OVERLAY_RED[2] - base) * a;
        out[i + 3] = 255;
      }
    });
    return out;
  }

  /** Clean Outline as filled vector layers (working pixels). */
  outlinePaths(controls: SketchControls): PathLayer[] {
    this.timings = {};
    this.focus('outline');
    const ink = this.outlineInkFor(normalizeControls(controls));
    return this.time('vector', () => inkToPathLayers(ink, this.width, this.height, OUTLINE_LAYERS));
  }

  /** Clean Outline as an SVG document that opens at `width` × `height`. */
  outlineSvg(controls: SketchControls, width = this.width, height = this.height): string {
    return pathLayersToSvg(this.outlinePaths(controls), this.width, this.height, width, height);
  }

  stats(): PipelineStats {
    return { timings: { ...this.timings }, peakBytes: this.pool.peak, liveBytes: this.pool.live, allocatedBytes: this.pool.allocated };
  }

  /** Free everything; the pipeline can still be used and rebuilds what it needs. */
  release(): void {
    const { pool } = this;
    pool.give(this.response, this.ridges, this.contour?.plane, this.softKept?.plane, this.outlineInk?.plane, this.pencilContour?.plane, this.pencilInk?.plane);
    if (this.tone) {
      pool.give(this.tone.form, this.tone.grainA, this.tone.grainB);
      pool.giveWide(this.tone.curve);
    }
    this.response = this.ridges = this.tone = null;
    this.contour = this.softKept = this.outlineInk = this.pencilContour = this.pencilInk = null;
    pool.trim();
  }
}
