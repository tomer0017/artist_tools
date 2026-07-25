/**
 * Deterministic black & white vector trace.
 *
 * This is a *filter*, not an interpretation. It has no notion of faces, hair,
 * subjects, backgrounds or importance, and it never decides what is worth
 * drawing — the operator does, through the same controls a professional trace
 * offers (Illustrator's Image Trace, Photoshop's Threshold):
 *
 *   threshold  how much black
 *   smoothing  how much micro-detail survives the pre-pass
 *   noise      the smallest feature that is allowed to exist
 *   simplify   how tightly the paths follow the pixels
 *   corners    how sharp or rounded the paths turn
 *
 * Given the same pixels and the same settings it produces exactly the same
 * paths, every time. Nothing here is adaptive to "what the picture is about".
 */

import { domainTransform, gaussBlur, luminance } from './imageOps';
import { simplify as simplifyPolyline } from './vector';
import {
  closeMask,
  fillSmallHoles,
  labelComponents,
  maxFilter,
  openMask,
  traceMaskBoundaries,
} from './regions';

export interface TraceSettings {
  /**
   * 0–255. In global mode, exactly Photoshop's Threshold: a pixel darker than
   * this becomes black. In adaptive mode it is the same dial expressed against
   * the local highlight instead of against absolute black.
   */
  threshold: number;
  /**
   * 0 = global threshold (one level for the whole frame).
   * 1–50 = radius of the local reference, as a percentage of the image
   * diagonal. Uneven lighting sinks a global threshold — one side of a face
   * goes solid black — and this is the standard answer to it.
   */
  adaptive: number;
  /** 0–100. Edge-preserving pre-blur; how much fine texture reaches the threshold. */
  smoothing: number;
  /**
   * Minimum feature area **in processing pixels**. Black specks and white
   * pinholes below it are removed. Illustrator calls this Noise.
   */
  noise: number;
  /** 0–100. Path fitting: 0 follows the pixel mask exactly, 100 is very loose. */
  simplify: number;
  /** 0–100. 0 leaves polygon corners sharp, 100 rounds every turn. */
  corners: number;
  /** Trace the lights instead of the darks. */
  invert: boolean;
}

export const DEFAULT_TRACE: TraceSettings = {
  threshold: 128,
  adaptive: 8,
  smoothing: 35,
  noise: 12,
  simplify: 40,
  corners: 60,
  invert: false,
};

/**
 * Named starting points. Each is just a set of control values — selecting one
 * fills the sliders in, and the operator is free to move any of them after.
 */
export const TRACE_PRESETS: { id: string; label: string; settings: TraceSettings }[] = [
  { id: 'balanced', label: 'Balanced', settings: { ...DEFAULT_TRACE } },
  {
    id: 'high-contrast',
    label: 'High contrast',
    settings: { threshold: 150, adaptive: 0, smoothing: 20, noise: 8, simplify: 30, corners: 40, invert: false },
  },
  {
    id: 'poster',
    label: 'Poster',
    settings: { threshold: 120, adaptive: 12, smoothing: 65, noise: 45, simplify: 70, corners: 85, invert: false },
  },
  {
    id: 'fine',
    label: 'Fine detail',
    settings: { threshold: 130, adaptive: 6, smoothing: 12, noise: 3, simplify: 15, corners: 35, invert: false },
  },
];

export interface TraceSource {
  width: number;
  height: number;
  /** Rec. 601 luminance, 0..255. */
  gray: Float32Array;
  /** Memo of the last smoothing / adaptive pass, so slider drags stay cheap. */
  cache: {
    smoothing: number;
    smoothed: Float32Array | null;
    adaptive: number;
    reference: Float32Array | null;
  };
}

export interface TraceResult {
  width: number;
  height: number;
  /** Closed boundary loops. Fill them all in one path with the even-odd rule. */
  loops: Float32Array[];
  settings: TraceSettings;
  stats: {
    /** Fraction of the frame that is black. */
    coverage: number;
    /** Number of separate black masses. */
    regions: number;
  };
}

/** Cheap, done once per image; every control below re-runs without it. */
export function buildTraceSource(src: {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}): TraceSource {
  return {
    width: src.width,
    height: src.height,
    gray: luminance(src.data, src.width, src.height),
    cache: { smoothing: -1, smoothed: null, adaptive: -1, reference: null },
  };
}

export function traceImage(source: TraceSource, settings: TraceSettings): TraceResult {
  const { width: w, height: h } = source;
  const n = w * h;
  const diag = Math.hypot(w, h);
  const s = normalize(settings);

  // --- 1. Smoothing -------------------------------------------------------
  // Edge-preserving, so raising it removes texture without dragging the
  // boundaries of everything else with it.
  let plane = source.gray;
  if (s.smoothing > 0) {
    if (source.cache.smoothing !== s.smoothing || !source.cache.smoothed) {
      const sigmaS = (s.smoothing / 100) * diag * 0.02;
      source.cache.smoothed = domainTransform(source.gray, w, h, sigmaS, 30);
      source.cache.smoothing = s.smoothing;
    }
    plane = source.cache.smoothed;
  }

  // --- 2. Threshold -------------------------------------------------------
  const mask = new Uint8Array(n);
  if (s.adaptive <= 0) {
    // Global: one level for the whole frame, exactly as Photoshop's Threshold.
    for (let p = 0; p < n; p++) if (plane[p] < s.threshold) mask[p] = 1;
  } else {
    // Local: compare against the surrounding highlight. The reference is a
    // local *maximum* rather than a mean, so a large dark area is measured
    // against the lit surface around it instead of against its own interior —
    // otherwise big masses come out hollow.
    const radius = (s.adaptive / 100) * diag;
    if (source.cache.adaptive !== s.adaptive || !source.cache.reference) {
      source.cache.reference = gaussBlur(maxFilter(plane, w, h, radius), w, h, radius * 0.6);
      source.cache.adaptive = s.adaptive;
    }
    const reference = source.cache.reference;
    const ratio = s.threshold / 255;
    for (let p = 0; p < n; p++) if (plane[p] < reference[p] * ratio) mask[p] = 1;
  }
  if (s.invert) for (let p = 0; p < n; p++) mask[p] ^= 1;

  // --- 3. Noise -----------------------------------------------------------
  // "Ignore areas smaller than N pixels", in both directions: an opening takes
  // out black specks, a closing takes out white pinholes, and the connected
  // pass below removes anything that survived at the wrong scale.
  let cleaned = mask;
  const radius = Math.max(0, Math.round(Math.sqrt(Math.max(0, s.noise)) / 2));
  if (radius >= 1) {
    cleaned = openMask(cleaned, w, h, radius);
    cleaned = closeMask(cleaned, w, h, radius);
  }
  if (s.noise >= 1) {
    cleaned = fillSmallHoles(cleaned, w, h, s.noise);
    cleaned = dropSmallRegions(cleaned, w, h, s.noise);
  }

  // --- 4. Paths -----------------------------------------------------------
  const epsilon = (s.simplify / 100) * diag * 0.006;
  const loops = traceMaskBoundaries(cleaned, w, h)
    .map((loop) => (epsilon > 0 ? simplifyPolyline(loop, epsilon) : loop))
    .filter((loop) => loop.length >= 6);

  let black = 0;
  for (let p = 0; p < n; p++) if (cleaned[p]) black++;

  return {
    width: w,
    height: h,
    loops,
    settings: s,
    stats: { coverage: black / n, regions: countRegions(cleaned, w, h) },
  };
}

/* ---------------------------------------------------------------- helpers -- */

function normalize(s: TraceSettings): TraceSettings {
  const clampTo = (v: number, lo: number, hi: number) =>
    Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : lo;
  return {
    threshold: clampTo(s.threshold, 0, 255),
    adaptive: clampTo(s.adaptive, 0, 50),
    smoothing: clampTo(s.smoothing, 0, 100),
    noise: clampTo(s.noise, 0, 5000),
    simplify: clampTo(s.simplify, 0, 100),
    corners: clampTo(s.corners, 0, 100),
    invert: !!s.invert,
  };
}

function dropSmallRegions(
  mask: Uint8Array,
  w: number,
  h: number,
  minArea: number,
): Uint8Array {
  const { labels, components } = labelComponents(mask, w, h);
  const keep = new Uint8Array(components.length);
  for (const c of components) if (c.area >= minArea) keep[c.label] = 1;
  const out = new Uint8Array(mask.length);
  for (let p = 0; p < mask.length; p++) {
    if (labels[p] >= 0 && keep[labels[p]]) out[p] = 1;
  }
  return out;
}

function countRegions(mask: Uint8Array, w: number, h: number): number {
  return labelComponents(mask, w, h).components.length;
}
