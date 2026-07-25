/**
 * Sketch engine — style registry.
 *
 * A style is *data*: three anchor parameter sets describing what the drawing
 * should be at Simple, Balanced and Detailed. The Detail slider interpolates
 * between them, so every position on the slider is a deliberately-tuned
 * drawing rather than "the same drawing with a different threshold".
 *
 * Adding a style means adding one entry here — `pipeline.ts` and `render.ts`
 * never branch on the style id.
 */

import type { SketchParams, SketchStyleId } from './types';

export interface SketchStyleDefinition {
  id: SketchStyleId;
  label: string;
  description: string;
  /** [simple, balanced, detailed] */
  anchors: [SketchParams, SketchParams, SketchParams];
}

const PAPER = '#ffffff';
const INK = '#131316';

/* ---------------------------------------------------------------- artist -- */

/**
 * Simple — silhouette, large contours, almost no internal lines.
 *
 * Heavy stage-1 smoothing plus a long minimum contour length means only the
 * boundaries that survive being blurred at 1.6% of the image diagonal make it
 * through. Persistence and length dominate the score: this level is asking
 * "what is the shape of the thing?".
 */
const ARTIST_SIMPLE: SketchParams = {
  denoise: { spatialFrac: 0.016, range: 34 },
  shape: { spatialFrac: 0.045, range: 60 },
  contour: { highPercentile: 0.86, lowRatio: 0.4 },
  link: { gapFrac: 0.02, minCos: 0.7 },
  fine: { budgetFrac: 0, floorRatio: 1, crowdTolerance: 0, highPercentile: 0.985, minSubject: 0.7, minLengthFrac: 0.05 },
  priority: {
    minLengthFrac: 0.06,
    budgetFrac: 2.5,
    scoreFloor: 0.1,
    accentShare: 0.18,
    clutterPenalty: 0.6,
    crowdPenalty: 0.2,
    weights: { contrast: 0.18, persistence: 0.34, length: 0.3, subject: 0.12, feature: 0.06 },
  },
  hierarchy: {
    heavyQuantile: 0.72,
    mediumQuantile: 0.3,
    baseWidthFrac: 0.0034,
    widthScale: { heavy: 1, medium: 0.6, light: 0.36 },
    opacity: { heavy: 0.96, medium: 0.8, light: 0.52 },
    taper: 0.16,
    taperDepth: 0.5,
    pressure: 0.3,
  },
  shading: { amount: 0.22, bands: 2, hatch: 0.35, start: 0.55 },
  simplifyFrac: 0.0022,
  maxStrokes: 3000,
  paper: PAPER,
  ink: INK,
};

/**
 * Balanced — contours, facial features, major folds, important structure.
 *
 * The fine pass switches partially on and the feature map starts to carry
 * weight, which is what brings eyes, nostrils and the lip line in. Minimum
 * length drops to roughly an eyebrow.
 */
const ARTIST_BALANCED: SketchParams = {
  denoise: { spatialFrac: 0.01, range: 26 },
  shape: { spatialFrac: 0.038, range: 55 },
  contour: { highPercentile: 0.76, lowRatio: 0.38 },
  link: { gapFrac: 0.016, minCos: 0.72 },
  fine: { budgetFrac: 0.8, floorRatio: 0.8, crowdTolerance: 0.3, highPercentile: 0.965, minSubject: 0.5, minLengthFrac: 0.035 },
  priority: {
    minLengthFrac: 0.02,
    budgetFrac: 5.5,
    scoreFloor: 0.08,
    accentShare: 0.35,
    // Note this *rises* with detail: the more lines we let through, the harder
    // background texture has to be pushed down to keep the drawing readable.
    clutterPenalty: 0.8,
    crowdPenalty: 0.25,
    weights: { contrast: 0.22, persistence: 0.28, length: 0.2, subject: 0.18, feature: 0.12 },
  },
  hierarchy: {
    heavyQuantile: 0.8,
    mediumQuantile: 0.4,
    baseWidthFrac: 0.003,
    widthScale: { heavy: 1, medium: 0.58, light: 0.34 },
    opacity: { heavy: 0.95, medium: 0.78, light: 0.5 },
    taper: 0.14,
    taperDepth: 0.55,
    pressure: 0.34,
  },
  shading: { amount: 0.32, bands: 3, hatch: 0.4, start: 0.5 },
  simplifyFrac: 0.0018,
  maxStrokes: 4500,
  paper: PAPER,
  ink: INK,
};

/**
 * Detailed — hair strands, wrinkles, clothing folds, secondary detail.
 *
 * The extra information comes from the fine pass, which is gated on
 * subject-ness *and* on contour length. That distinction matters: a hair
 * strand and a fabric weave look identical to a threshold, but the strand is
 * a long coherent chain and the weave is a field of 3-pixel fragments.
 */
const ARTIST_DETAILED: SketchParams = {
  denoise: { spatialFrac: 0.006, range: 18 },
  shape: { spatialFrac: 0.032, range: 50 },
  contour: { highPercentile: 0.72, lowRatio: 0.35 },
  link: { gapFrac: 0.012, minCos: 0.75 },
  fine: { budgetFrac: 5, floorRatio: 0.32, crowdTolerance: 0.45, highPercentile: 0.93, minSubject: 0.4, minLengthFrac: 0.025 },
  priority: {
    minLengthFrac: 0.01,
    budgetFrac: 12,
    scoreFloor: 0.06,
    accentShare: 0.34,
    clutterPenalty: 1.0,
    crowdPenalty: 0.3,
    weights: { contrast: 0.26, persistence: 0.18, length: 0.14, subject: 0.24, feature: 0.18 },
  },
  hierarchy: {
    heavyQuantile: 0.86,
    mediumQuantile: 0.5,
    baseWidthFrac: 0.0026,
    widthScale: { heavy: 1, medium: 0.55, light: 0.3 },
    opacity: { heavy: 0.94, medium: 0.76, light: 0.46 },
    taper: 0.12,
    taperDepth: 0.6,
    pressure: 0.38,
  },
  shading: { amount: 0.4, bands: 4, hatch: 0.45, start: 0.46 },
  simplifyFrac: 0.0014,
  maxStrokes: 6000,
  paper: PAPER,
  ink: INK,
};

/* ------------------------------------------------------------- variations -- */

type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K] };

function merge<T>(base: T, patch: DeepPartial<T> | undefined): T {
  if (!patch) return base;
  const out = { ...base } as T;
  for (const key of Object.keys(patch) as (keyof T)[]) {
    const value = patch[key as keyof DeepPartial<T>] as unknown;
    const current = base[key];
    out[key] =
      value && typeof value === 'object' && current && typeof current === 'object'
        ? merge(current, value as DeepPartial<typeof current>)
        : (value as T[keyof T]);
  }
  return out;
}

/** Derive a style from the artist anchors by patching only what differs. */
function variant(
  id: SketchStyleId,
  label: string,
  description: string,
  patch: DeepPartial<SketchParams> | [DeepPartial<SketchParams>, DeepPartial<SketchParams>, DeepPartial<SketchParams>],
): SketchStyleDefinition {
  const patches = Array.isArray(patch) ? patch : ([patch, patch, patch] as const);
  return {
    id,
    label,
    description,
    anchors: [
      merge(ARTIST_SIMPLE, patches[0]),
      merge(ARTIST_BALANCED, patches[1]),
      merge(ARTIST_DETAILED, patches[2]),
    ],
  };
}

export const SKETCH_STYLES: Record<SketchStyleId, SketchStyleDefinition> = {
  artist: {
    id: 'artist',
    label: 'Artist sketch',
    description: 'Clean contours, grouped masses, three line weights — a drawing to transfer.',
    anchors: [ARTIST_SIMPLE, ARTIST_BALANCED, ARTIST_DETAILED],
  },
  outline: variant('outline', 'Outline', 'Boundaries only, one confident weight, no shading.', {
    hierarchy: {
      heavyQuantile: 0.35,
      mediumQuantile: 0.34,
      widthScale: { heavy: 1, medium: 0.85, light: 0.7 },
      opacity: { heavy: 0.96, medium: 0.92, light: 0.86 },
      taperDepth: 0.25,
      pressure: 0.12,
    },
    fine: { budgetFrac: 0 },
    shading: { amount: 0 },
  }),
  pencil: variant('pencil', 'Pencil', 'Softer, greyer line with visible tonal masses.', {
    hierarchy: {
      opacity: { heavy: 0.8, medium: 0.6, light: 0.36 },
      pressure: 0.5,
      taperDepth: 0.7,
    },
    shading: { amount: 0.85, bands: 5, hatch: 0.6 },
    ink: '#2b2b30',
  }),
  construction: variant(
    'construction',
    'Construction',
    'Long blocked-in structural lines for measuring proportion.',
    {
      priority: {
        weights: { contrast: 0.12, persistence: 0.38, length: 0.36, subject: 0.1, feature: 0.04 },
        budgetFrac: 4,
      },
      link: { gapFrac: 0.03 },
      simplifyFrac: 0.006,
      fine: { budgetFrac: 0 },
      shading: { amount: 0 },
      hierarchy: { taperDepth: 0.2, pressure: 0.15 },
    },
  ),
  ink: variant('ink', 'Ink', 'Bold, flat, high-contrast line with no tonal support.', {
    hierarchy: {
      baseWidthFrac: 0.0042,
      opacity: { heavy: 1, medium: 0.98, light: 0.9 },
      taperDepth: 0.35,
      pressure: 0.2,
    },
    shading: { amount: 0 },
    ink: '#0b0b0d',
  }),
};

export const DEFAULT_SKETCH_STYLE: SketchStyleId = 'artist';

/** Deep numeric interpolation between two anchors; strings snap at the midpoint. */
function lerpDeep<T>(a: T, b: T, t: number): T {
  if (typeof a === 'number' && typeof b === 'number') {
    return (a + (b - a) * t) as unknown as T;
  }
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    const out = {} as T;
    for (const key of Object.keys(a as object) as (keyof T)[]) {
      out[key] = lerpDeep(a[key], b[key], t);
    }
    return out;
  }
  return t < 0.5 ? a : b;
}

/**
 * Resolve the parameters for a detail position.
 *
 * 0 → 0.5 interpolates Simple → Balanced, 0.5 → 1 Balanced → Detailed. Values
 * that must stay whole (band counts) are rounded on the way out.
 */
export function resolveParams(style: SketchStyleId, detail: number): SketchParams {
  const def = SKETCH_STYLES[style] ?? SKETCH_STYLES[DEFAULT_SKETCH_STYLE];
  const d = detail < 0 ? 0 : detail > 1 ? 1 : detail;
  const [simple, balanced, detailed] = def.anchors;
  const params =
    d <= 0.5 ? lerpDeep(simple, balanced, d / 0.5) : lerpDeep(balanced, detailed, (d - 0.5) / 0.5);
  params.shading = { ...params.shading, bands: Math.max(2, Math.round(params.shading.bands)) };
  params.maxStrokes = Math.round(params.maxStrokes);
  return params;
}
