/**
 * Sketch engine — shared types.
 *
 * The engine turns a photograph into a *drawing*: an ordered set of strokes
 * with a real line hierarchy, rather than a per-pixel edge filter. Everything
 * downstream of `analyzeSketch()` works on this vector-ish representation, so
 * new styles can change how strokes are chosen and drawn without touching the
 * analysis stages.
 */

/**
 * Sketch styles are data, not code paths. Adding one means adding a definition
 * to the registry in `styles.ts` — the pipeline never branches on the id.
 */
export type SketchStyleId = 'artist' | 'outline' | 'pencil' | 'construction' | 'ink';

/**
 * A drawing has three line weights, in the order a painter would lay them in:
 *   heavy  — silhouette and major object boundaries
 *   medium — facial features, clothing edges, important internal shapes
 *   light  — wrinkles, eyelashes, texture, fine detail
 */
export type LineWeight = 'heavy' | 'medium' | 'light';

/** Painting order: light first so heavy lines always read on top. */
export const WEIGHT_ORDER: LineWeight[] = ['light', 'medium', 'heavy'];

export type WeightMap<T> = Record<LineWeight, T>;

/**
 * Fully resolved tuning for a single run. All spatial values are expressed as
 * a fraction of the image diagonal so a 600px and a 4000px photo produce the
 * same drawing, just at different resolutions.
 */
export interface SketchParams {
  /** Stage 1 — edge-preserving noise reduction (kills pores/weave/grain). */
  denoise: { spatialFrac: number; range: number };
  /** Stage 2 — the much coarser "large shape" image used for persistence. */
  shape: { spatialFrac: number; range: number };
  /**
   * Stage 3 — contour extraction. Thresholds are deliberately *generous*: the
   * engine extracts liberally and then selects strictly in stage 4, because a
   * global threshold cannot tell a weak-but-important shoulder line from a
   * strong-but-worthless fabric edge.
   */
  contour: { highPercentile: number; lowRatio: number };
  /** Stage 3 — rejoining fragments broken by suppression/hysteresis. */
  link: { gapFrac: number; minCos: number };
  /**
   * Stage 3b — the optional fine pass. This is how "Detailed" adds hair
   * strands and wrinkles: a *separate* extraction gated on subject-ness and
   * contour length, not a lowered threshold on the primary pass.
   */
  fine: {
    /** Ink allowance for fine detail, in multiples of the image diagonal. */
    budgetFrac: number;
    /** Fraction of the main drawing's score floor a fine line must reach. */
    floorRatio: number;
    /** How much of the crowding penalty applies to fine detail (0..1). */
    crowdTolerance: number;
    highPercentile: number;
    minSubject: number;
    minLengthFrac: number;
  };
  /** Stage 4 — which contours a painter would actually draw. */
  priority: {
    minLengthFrac: number;
    /**
     * Total drawn line length allowed, in multiples of the image diagonal.
     * Contours are taken best-first until it runs out — so the Detail slider
     * controls how much drawing there is, and the score controls which parts
     * of it. An absolute threshold cannot do that: the same number means
     * "everything" on one photo and "nothing" on the next.
     */
    budgetFrac: number;
    /** Floor below which a contour is never worth drawing at any budget. */
    scoreFloor: number;
    /** Share of the budget reserved for short, high-priority accent marks. */
    accentShare: number;
    clutterPenalty: number;
    /** Penalty for contours packed among many parallel neighbours (texture). */
    crowdPenalty: number;
    weights: {
      contrast: number;
      persistence: number;
      length: number;
      subject: number;
      feature: number;
    };
  };
  /** Stage 5 — line hierarchy and stroke shaping. */
  hierarchy: {
    /** Quantiles of the structural score that split heavy / medium / light. */
    heavyQuantile: number;
    mediumQuantile: number;
    baseWidthFrac: number;
    widthScale: WeightMap<number>;
    opacity: WeightMap<number>;
    /** Fraction of the stroke over which the line tapers in at each end. */
    taper: number;
    /** How thin the tapered end gets (0 = no taper, 1 = to nothing). */
    taperDepth: number;
    /** How much local contrast modulates width — the "pencil pressure" feel. */
    pressure: number;
  };
  /** Stage 6 — optional pencil shading in the deepest masses. */
  shading: { amount: number; bands: number; hatch: number; start: number };
  /** Polyline simplification epsilon, as a fraction of the diagonal. */
  simplifyFrac: number;
  /** Hard cap so a pathological photo can never stall the UI. */
  maxStrokes: number;
  paper: string;
  ink: string;
}

/** One drawn line. `points` are x,y pairs in processing-space pixels. */
export interface SketchStroke {
  points: Float32Array;
  /** Per-point line width in processing-space pixels (taper + pressure baked in). */
  widths: Float32Array;
  weightClass: LineWeight;
  /** 0..1 painter-relevance score; kept for debugging and future styles. */
  score: number;
  closed: boolean;
}

/** Soft tonal pass rendered under the strokes. */
export interface SketchShading {
  width: number;
  height: number;
  /** 0..1 per pixel; already banded and gated to the darks. */
  tone: Float32Array;
  /** 0..1 strength of the diagonal pencil-hatch modulation. */
  hatch: number;
}

export interface SketchDrawing {
  width: number;
  height: number;
  strokes: SketchStroke[];
  shading: SketchShading | null;
  style: SketchStyleId;
  detail: number;
  paper: string;
  ink: string;
  opacity: WeightMap<number>;
  stats: {
    traced: number;
    kept: number;
    weights: WeightMap<number>;
  };
}

export interface SketchSource {
  /** RGBA, length = width * height * 4. */
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

export interface SketchOptions {
  /** Defaults to `'artist'`. */
  style?: SketchStyleId;
  /** 0 = simple (silhouette) → 1 = detailed. */
  detail: number;
  /** Optional subtle pencil shading under the line work. */
  shading?: boolean;
}
