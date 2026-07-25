/**
 * Sketch engine — style registry.
 *
 * A style is *data*: one detail-independent parameter set describing how the
 * photograph is read, plus four ink-budget curves describing how much of each
 * drawing layer to include at Simple / Balanced / Detailed.
 *
 * That separation is deliberate. Everything that decides *what a line is* —
 * denoise scale, thresholds, linking, geometry, stroke width — is fixed, so a
 * line looks identical at every position of the slider. Only the budgets move.
 * The slider therefore adds to the drawing rather than regenerating it, which
 * is what "more detail" means to an artist.
 *
 * Adding a style means adding one entry here — `pipeline.ts` and `render.ts`
 * never branch on the style id.
 */

import type { BudgetCurve, LayerMap, SketchParams, SketchStyleId } from './types';

export interface SketchStyleDefinition {
  id: SketchStyleId;
  label: string;
  description: string;
  params: SketchParams;
}

const PAPER = '#ffffff';
const INK = '#131316';

/* ---------------------------------------------------------------- artist -- */

/**
 * Ink budgets, in multiples of the image diagonal, at [Simple, Balanced,
 * Detailed]. Each curve must be non-decreasing — that is what makes the slider
 * cumulative.
 *
 * Simple is a *usable tracing guide*, not a minimum: structure and face are
 * both funded from the start, because a construction sketch without eyes,
 * brows, nose and lips is not something a painter can transfer. What Simple
 * withholds is everything in `secondary` and `fine` — masses, folds, strands,
 * wrinkles — which is exactly the material that reads as noise when it arrives
 * before the drawing underneath it is established.
 */
const ARTIST_LAYERS: LayerMap<BudgetCurve> = {
  structure: [3.6, 4.6, 5.4],
  face: [1.4, 2.2, 3.0],
  secondary: [0, 4.0, 6.5],
  fine: [0, 0.5, 5.0],
};

const ARTIST: SketchParams = {
  denoise: { spatialFrac: 0.009, range: 24 },
  shape: { spatialFrac: 0.038, range: 55 },
  contour: { highPercentile: 0.78, lowRatio: 0.38 },
  link: { gapFrac: 0.016, minCos: 0.72 },
  fine: { highPercentile: 0.95, minSubject: 0.45, minLengthFrac: 0.03, crowdTolerance: 0.4 },
  priority: {
    minLengthFrac: 0.016,
    scoreFloor: 0.07,
    relativeFloor: 0.3,
    clutterPenalty: 0.8,
    crowdPenalty: 0.25,
    weights: { contrast: 0.2, persistence: 0.26, length: 0.18, subject: 0.16, feature: 0.2 },
    texture: { clutter: 0.72, persistence: 0.3 },
    structureQuantile: 0.72,
    backgroundSubject: 0.45,
    compositionQuantile: 0.93,
    faceRegion: 0.5,
    faceContrast: 0.35,
  },
  hierarchy: {
    heavyQuantile: 0.62,
    mediumQuantile: 0.35,
    baseWidthFrac: 0.003,
    widthScale: { heavy: 1, medium: 0.58, light: 0.34 },
    opacity: { heavy: 0.95, medium: 0.78, light: 0.5 },
    taper: 0.14,
    taperDepth: 0.55,
    pressure: 0.34,
  },
  shading: { amount: 0.32, bands: 3, hatch: 0.4, start: 0.5 },
  layers: ARTIST_LAYERS,
  simplifyFrac: 0.0018,
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
    // Budget curves are arrays and must be replaced wholesale, never merged.
    out[key] =
      value &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      current &&
      typeof current === 'object'
        ? merge(current, value as DeepPartial<typeof current>)
        : (value as T[keyof T]);
  }
  return out;
}

/** Derive a style from the artist params by patching only what differs. */
function variant(
  id: SketchStyleId,
  label: string,
  description: string,
  patch: DeepPartial<SketchParams>,
): SketchStyleDefinition {
  return { id, label, description, params: merge(ARTIST, patch) };
}

export const SKETCH_STYLES: Record<SketchStyleId, SketchStyleDefinition> = {
  artist: {
    id: 'artist',
    label: 'Artist sketch',
    description: 'Clean contours, grouped masses, three line weights — a drawing to transfer.',
    params: ARTIST,
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
    layers: {
      structure: [3.6, 4.8, 6.0],
      face: [1.0, 1.4, 1.8],
      secondary: [0, 0.8, 1.6],
      fine: [0, 0, 0],
    },
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
        structureQuantile: 0.55,
        compositionQuantile: 0.88,
      },
      layers: {
        structure: [4.5, 6.0, 7.5],
        face: [0.8, 1.2, 1.6],
        secondary: [0, 1.5, 3.0],
        fine: [0, 0, 0],
      },
      simplifyFrac: 0.006,
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

export function styleParams(style: SketchStyleId): SketchParams {
  return (SKETCH_STYLES[style] ?? SKETCH_STYLES[DEFAULT_SKETCH_STYLE]).params;
}
