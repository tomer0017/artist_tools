/**
 * Deterministic black & white vector trace.
 *
 * This is a *filter*, not an interpretation. It has no notion of faces, hair,
 * subjects, backgrounds or importance, and it never decides what is worth
 * drawing — the operator does. Given the same pixels and the same settings it
 * produces exactly the same paths, every time.
 *
 * Three controls carry the work, and they are deliberately named for what the
 * painter sees rather than for the operation underneath:
 *
 *   ink         how much of the image becomes black
 *   detail      how small a shape is allowed to remain
 *   separation  how far apart the lights and darks are pushed before thresholding
 *
 * All three are 0–100 and resolution-independent: the same numbers give the
 * same drawing whether the frame is 600px or 4000px across. Raw pixel counts
 * and raw threshold levels are derived internally and exposed only as advanced
 * read-outs, because "166 px" means nothing to a painter and means something
 * different on every image size.
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
   * 0–100. How much of the image becomes black. Mapped through a curve onto
   * the threshold, so the useful portrait band occupies most of the travel
   * instead of being squeezed into a few percent at one end.
   */
  ink: number;
  /**
   * 0–100. How small a shape may remain. 0 keeps everything the threshold
   * found; higher values drop small isolated marks. Expressed as a share of
   * the frame, never as a pixel count.
   */
  detail: number;
  /**
   * 0–100. How far apart the lights and darks are pushed before thresholding —
   * a black/white point stretch plus a gentle S-curve. This is what keeps an
   * eye distinct from the shadow around it, and a brow distinct from the hair,
   * at a threshold that would otherwise merge them.
   */
  separation: number;
  /** Trace the lights instead of the darks. */
  invert: boolean;

  /* --- advanced ---------------------------------------------------------- */
  /** 0–100. Edge-preserving pre-blur; how much fine texture reaches the threshold. */
  smoothing: number;
  /**
   * 0 = one global threshold for the whole frame.
   * 1–50 = radius of the local reference, as a percentage of the diagonal.
   * Uneven lighting sinks a global threshold — one side of a face goes solid
   * black — and this is the standard answer to it.
   */
  local: number;
  /** 0–100. Path fitting: 0 follows the pixel mask exactly, 100 is very loose. */
  simplify: number;
  /** 0–100. 0 leaves polygon corners sharp, 100 rounds every turn. */
  corners: number;
}

/**
 * Tuned by sweeping real scenes, not by taste. Smoothing carries more of the
 * load than it looks like it should: texture — foliage, fabric weave, grain —
 * is best removed *before* the threshold, because once it has become black
 * shapes no size-based cleanup can separate a clump of leaves from an iris.
 * They are the same number of pixels.
 */
export const DEFAULT_TRACE: TraceSettings = {
  ink: 45,
  detail: 60,
  separation: 30,
  invert: false,
  smoothing: 55,
  local: 8,
  simplify: 40,
  corners: 60,
};

/**
 * Named starting points — each is only a set of control values. Selecting one
 * fills the sliders in; every one of them stays adjustable afterwards.
 */
export const TRACE_PRESETS: { id: string; label: string; settings: TraceSettings }[] = [
  { id: 'balanced', label: 'Balanced', settings: { ...DEFAULT_TRACE } },
  {
    id: 'graphic',
    label: 'Graphic',
    settings: { ...DEFAULT_TRACE, ink: 34, detail: 70, separation: 55, smoothing: 80, simplify: 55, corners: 80 },
  },
  {
    id: 'rich',
    label: 'Rich shadows',
    settings: { ...DEFAULT_TRACE, ink: 68, detail: 55, separation: 20, smoothing: 60 },
  },
  {
    id: 'fine',
    label: 'Fine detail',
    settings: { ...DEFAULT_TRACE, ink: 48, detail: 30, separation: 35, smoothing: 40, simplify: 15, corners: 35 },
  },
];

export interface TraceSource {
  width: number;
  height: number;
  /** Rec. 601 luminance, 0..255. */
  gray: Float32Array;
  /**
   * Memo chain. Each stage is keyed on the setting that produces it, so moving
   * Ink (the most-dragged control) re-runs only the threshold and the cleanup,
   * and never the expensive smoothing or local-reference passes.
   */
  cache: {
    smoothing: number;
    smoothed: Float32Array | null;
    separation: number;
    prepared: Float32Array | null;
    local: number;
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
    /** The threshold Ink resolved to, for the advanced read-out. */
    threshold: number;
    /** The smallest surviving shape, in pixels of the processed frame. */
    minShapePx: number;
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
    cache: {
      smoothing: -1,
      smoothed: null,
      separation: -1,
      prepared: null,
      local: -1,
      reference: null,
    },
  };
}

/* ------------------------------------------------------------- the mapping -- */

/** Ease-in-out: fine control in the middle, coarser at the extremes. */
const ease = (t: number) => t * t * (3 - 2 * t) * 0.75 + t * 0.25;

/**
 * Ink → threshold ratio against the local reference.
 *
 * The band was measured, not guessed. Sweeping a portrait: around 0.32 of the
 * local highlight only the darkest accents survive; 0.46 is a clean readable
 * portrait; 0.56 is a bold stencil with the background starting to encroach;
 * past 0.65 the face floods and merges with everything behind it. So the
 * control spans 0.30–0.62 and puts 0.46 — where the good pictures are — dead
 * centre, with the ease giving the middle the most physical room.
 *
 * The first attempt at this spanned 0.44–0.96, which put the entire useful
 * band inside the first tenth of the slider and left the other nine tenths
 * producing a black mask. Getting the band right matters more than the curve.
 */
export function inkToRatio(ink: number): number {
  return 0.3 + ease(clamp(ink, 0, 100) / 100) * 0.32;
}

/** Ink → absolute level, for the global (non-local) threshold. */
export function inkToLevel(ink: number): number {
  return Math.round(30 + ease(clamp(ink, 0, 100) / 100) * 180);
}

/**
 * Detail → the smallest black shape that survives, as a share of the frame.
 *
 * The ceiling is the important number, and it is set by anatomy. On a portrait
 * filling the frame an iris covers roughly 0.12% of it, a nostril 0.02%, the
 * lip line about 0.1%; speckle from texture and compression sits below 0.01%.
 * So the control tops out at 0.05% — comfortably above every kind of noise and
 * comfortably below every feature that matters. An earlier ceiling of 0.6% did
 * clear the background beautifully and took both eyes with it.
 *
 * Squared, so the left half of the travel moves in small steps: that is where
 * the difference between keeping and losing a nostril lives. A share of the
 * frame rather than a pixel count is what makes the control mean the same thing
 * on a phone-sized crop and a full-resolution scan.
 */
export function detailToAreaFraction(detail: number): number {
  const t = clamp(detail, 0, 100) / 100;
  return t * t * 0.0005;
}

/* ------------------------------------------------------------------ trace -- */

export function traceImage(source: TraceSource, settings: TraceSettings): TraceResult {
  const { width: w, height: h } = source;
  const n = w * h;
  const diag = Math.hypot(w, h);
  const s = normalize(settings);
  const cache = source.cache;

  // --- 1. Smoothing -------------------------------------------------------
  // Edge-preserving, so raising it removes texture without dragging the
  // boundaries of everything else with it.
  let plane = source.gray;
  if (s.smoothing > 0) {
    if (cache.smoothing !== s.smoothing || !cache.smoothed) {
      cache.smoothed = domainTransform(source.gray, w, h, (s.smoothing / 100) * diag * 0.02, 30);
      cache.smoothing = s.smoothing;
      cache.separation = -1; // invalidate what was built on top of it
      cache.local = -1;
    }
    plane = cache.smoothed;
  }

  // --- 2. Separation ------------------------------------------------------
  if (s.separation > 0) {
    if (cache.separation !== s.separation || !cache.prepared) {
      cache.prepared = separate(plane, s.separation);
      cache.separation = s.separation;
      cache.local = -1;
    }
    plane = cache.prepared;
  }

  // --- 3. Threshold -------------------------------------------------------
  const threshold = s.local <= 0 ? inkToLevel(s.ink) : inkToRatio(s.ink);
  const mask = new Uint8Array(n);
  if (s.local <= 0) {
    // Global: one level for the whole frame, as Photoshop's Threshold.
    for (let p = 0; p < n; p++) if (plane[p] < threshold) mask[p] = 1;
  } else {
    // Local: compare against the surrounding highlight. The reference is a
    // local *maximum* rather than a mean, so a large dark area is measured
    // against the lit surface around it instead of against its own interior —
    // otherwise big masses come out hollow.
    const radius = (s.local / 100) * diag;
    if (cache.local !== s.local || !cache.reference) {
      cache.reference = gaussBlur(maxFilter(plane, w, h, radius), w, h, radius * 0.6);
      cache.local = s.local;
    }
    const reference = cache.reference;
    for (let p = 0; p < n; p++) if (plane[p] < reference[p] * threshold) mask[p] = 1;
  }
  if (s.invert) for (let p = 0; p < n; p++) mask[p] ^= 1;

  // --- 4. Detail ----------------------------------------------------------
  const minShapePx = Math.max(2, Math.round(detailToAreaFraction(s.detail) * n));
  let cleaned = mask;

  // Opening removes speckle. The radius is deliberately tiny and grows slowly:
  // morphology is blunt, and a radius large enough to matter also rounds every
  // corner off the drawing. The connected-component pass below does the real
  // work, because it removes a shape on its *area* without touching the shape
  // of anything that stays.
  const openRadius = Math.min(3, Math.floor(Math.sqrt(minShapePx) / 3));
  if (openRadius >= 1) {
    cleaned = openMask(cleaned, w, h, openRadius);
    // Closing is kept to half the opening radius. It welds a broken mass back
    // together, but it is also what swallows the gap between a brow and an eye,
    // so it is the one operation here that must stay timid.
    const closeRadius = Math.floor(openRadius / 2);
    if (closeRadius >= 1) cleaned = closeMask(cleaned, w, h, closeRadius);
  }

  // White pockets are cleaned *independently* and far more conservatively than
  // black shapes. An eye white, the gap between a moustache and a lip, the slot
  // between brow and lid — these are small, and they are the difference between
  // a face and a silhouette. Only pockets well below the black threshold are
  // filled, and a pocket that looks like a feature (roughly round, solidly
  // filled) is kept even then.
  cleaned = fillSmallHoles(cleaned, w, h, Math.max(2, Math.round(minShapePx * HOLE_SHARE)), {
    protectShaped: true,
    tinyArea: TINY_HOLE_PX,
  });
  if (minShapePx > 2) cleaned = dropSmallRegions(cleaned, w, h, minShapePx);

  // --- 5. Paths -----------------------------------------------------------
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
    stats: {
      coverage: black / n,
      regions: countRegions(cleaned, w, h),
      threshold: s.local <= 0 ? threshold : Math.round(threshold * 255),
      minShapePx,
    },
  };
}

/**
 * How small a white pocket has to be, relative to the black-shape threshold,
 * before it counts as a defect rather than a feature. Half, and then only if it
 * is also the wrong *shape* — the Detail control is about black marks, and it
 * must never quietly close the eyes.
 */
const HOLE_SHARE = 0.5;
/** Pockets below this are always filled — printer dust, not anatomy. */
const TINY_HOLE_PX = 6;

/* ---------------------------------------------------------------- helpers -- */

const clamp = (v: number, lo: number, hi: number) =>
  Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : lo;

/**
 * Black/white point stretch plus a gentle S-curve.
 *
 * The stretch is taken from the image's own 2nd and 98th percentiles, so a flat
 * scan and a contrasty one both land on a usable range; the S-curve then pushes
 * midtones apart around the middle. Deliberately *not* a local-contrast method:
 * CLAHE and friends pull skin texture and JPEG blocking back up out of the
 * noise floor, which is precisely what the smoothing pass just removed.
 */
function separate(plane: Float32Array, amount: number): Float32Array {
  const t = clamp(amount, 0, 100) / 100;
  const { lo, hi } = percentileRange(plane, 0.02, 0.98);
  const span = Math.max(1, hi - lo);
  // Stretch is eased in so the first third of the control is a light touch.
  const stretch = t * 0.85;
  const contrast = 1 + t * 1.1;
  const out = new Float32Array(plane.length);
  for (let p = 0; p < plane.length; p++) {
    const raw = plane[p];
    const stretched = raw + ((((raw - lo) / span) * 255 - raw) * stretch);
    const v = 128 + (stretched - 128) * contrast;
    out[p] = v < 0 ? 0 : v > 255 ? 255 : v;
  }
  return out;
}

/** Histogram-based percentile pair; exact sorting would cost a full copy. */
function percentileRange(src: Float32Array, loP: number, hiP: number) {
  const BINS = 256;
  const hist = new Uint32Array(BINS);
  for (let i = 0; i < src.length; i++) {
    const v = src[i];
    hist[v <= 0 ? 0 : v >= 255 ? 255 : v | 0]++;
  }
  const total = src.length;
  let acc = 0;
  let lo = 0;
  let hi = 255;
  for (let b = 0; b < BINS; b++) {
    acc += hist[b];
    if (acc >= loP * total) {
      lo = b;
      break;
    }
  }
  acc = 0;
  for (let b = BINS - 1; b >= 0; b--) {
    acc += hist[b];
    if (acc >= (1 - hiP) * total) {
      hi = b;
      break;
    }
  }
  return { lo, hi: Math.max(lo + 1, hi) };
}

function normalize(s: TraceSettings): TraceSettings {
  return {
    ink: clamp(s.ink, 0, 100),
    detail: clamp(s.detail, 0, 100),
    separation: clamp(s.separation, 0, 100),
    invert: !!s.invert,
    smoothing: clamp(s.smoothing, 0, 100),
    local: clamp(s.local, 0, 50),
    simplify: clamp(s.simplify, 0, 100),
    corners: clamp(s.corners, 0, 100),
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
