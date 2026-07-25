/**
 * Sketch engine — shared types.
 *
 * The engine turns a photograph into a *drawing*: an ordered set of strokes
 * with a real line hierarchy, rather than a per-pixel edge filter.
 *
 * The central design commitment is that **the Detail slider is cumulative**.
 * The whole analysis — denoise scale, thresholds, contour geometry, stroke
 * widths — is detail-*independent* and runs once. Detail then controls only how
 * much of each drawing layer is included. Simple is therefore a strict subset
 * of Balanced, which is a strict subset of Detailed: moving the slider adds
 * lines to the drawing you already had, it never redraws it. Re-running
 * extraction at a different threshold per level is exactly what makes a sketch
 * feel machine-generated, and it is what this structure rules out.
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
 * The four layers of the drawing, in the order an artist builds them. Each is
 * filled from its own ink budget, so detail added to one never costs another —
 * a face is never crowded out by a long background contour.
 *
 *   structure — silhouette, head outline, jaw, ears, neck, shoulders, major
 *               clothing and object contours. Always present.
 *   face      — eyes, brows, nose, nostrils, lips and other priority accents.
 *               Always present: a construction sketch without features is not
 *               usable as a tracing guide.
 *   secondary — eyelids, iris, hair and beard masses, major folds, important
 *               shadow boundaries. Fades in across Simple → Balanced.
 *   fine      — hair and beard strands, wrinkles, secondary folds. Fades in
 *               across Balanced → Detailed.
 */
export type SketchLayer = 'structure' | 'face' | 'secondary' | 'fine';

export const LAYER_ORDER: SketchLayer[] = ['structure', 'face', 'secondary', 'fine'];

export type LayerMap<T> = Record<SketchLayer, T>;

/**
 * Ink allowance at [Simple, Balanced, Detailed], in multiples of the image
 * diagonal. **Must be non-decreasing** — that is what guarantees the slider is
 * cumulative rather than destructive.
 */
export type BudgetCurve = readonly [number, number, number];

/**
 * Tuning for a style. Everything here is detail-independent except `layers`;
 * see the note at the top of the file for why that matters. All spatial values
 * are a fraction of the image diagonal, so a 600px and a 4000px photo produce
 * the same drawing at different resolutions.
 */
export interface SketchParams {
  /** Stage 1 — edge-preserving noise reduction (kills pores/weave/grain). */
  denoise: { spatialFrac: number; range: number };
  /** Stage 2 — the much coarser "large shape" image used for persistence. */
  shape: { spatialFrac: number; range: number };
  /**
   * Stage 3 — contour extraction. Thresholds are deliberately *generous*: the
   * engine extracts liberally and then selects strictly, because a global
   * threshold cannot tell a weak-but-important shoulder line from a
   * strong-but-worthless fabric edge.
   */
  contour: { highPercentile: number; lowRatio: number };
  /** Stage 3 — rejoining fragments broken by suppression/hysteresis. */
  link: { gapFrac: number; minCos: number };
  /**
   * Stage 3b — the separate fine extraction that supplies the `fine` layer:
   * strands and wrinkles the main pass has deliberately smoothed away.
   */
  fine: {
    highPercentile: number;
    minSubject: number;
    minLengthFrac: number;
    /** How much of the crowding penalty applies to fine detail (0..1). */
    crowdTolerance: number;
  };
  /** Stage 4 — which contours a painter would draw, and in which layer. */
  priority: {
    minLengthFrac: number;
    /** Floor below which a contour is never worth drawing at any budget. */
    scoreFloor: number;
    /** …and the same floor expressed against the best contour in this photo. */
    relativeFloor: number;
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
    /**
     * Categorical rejection. A contour this cluttered with this little
     * large-scale structure behind it is fabric weave, pores, gravel or JPEG
     * mush — never drawn, at any detail level. A hard rule rather than a score
     * penalty, so "Detailed" can add information without ever opening the door
     * to texture.
     */
    texture: { clutter: number; persistence: number };
    /** Quantile of the structural score that counts as silhouette/boundary. */
    structureQuantile: number;
    /**
     * Subject-ness a contour needs to be drawn at all once it is not part of
     * the silhouette. Background belongs in the drawing only when it *defines*
     * the composition — a horizon, a doorway, a wall corner — and those are
     * strongly structural, so they come in through `structure` instead. Trees,
     * grass, clouds, floors and walls have nothing else to offer a painter.
     */
    backgroundSubject: number;
    /** …and how structural a low-subject contour must be to count as that. */
    compositionQuantile: number;
    /** Priority-region strength a contour needs to join the `face` layer. */
    faceRegion: number;
    /** …and the contrast it needs there if it is not a compact accent. */
    faceContrast: number;
  };
  /** Stage 5 — line hierarchy and stroke shaping. Detail-independent by design. */
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
  /** The only detail-dependent tuning in the engine. */
  layers: LayerMap<BudgetCurve>;
  /** Polyline simplification epsilon, as a fraction of the diagonal. */
  simplifyFrac: number;
  /** Hard cap so a pathological photo can never stall the UI. */
  maxStrokes: number;
  paper: string;
  ink: string;
}

/** One drawn line. `points` are x,y pairs in processing-space pixels. */
export interface SketchStroke {
  /** Stable identity across detail levels — the same line keeps the same id. */
  id: number;
  points: Float32Array;
  /** Per-point line width in processing-space pixels (taper + pressure baked in). */
  widths: Float32Array;
  weightClass: LineWeight;
  layer: SketchLayer;
  /** Arc length in processing-space pixels; what the ink budget is spent in. */
  length: number;
  /** 0..1 painter-relevance score; ranks the stroke within its layer. */
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

/**
 * Everything the engine derives from a photograph that does *not* depend on the
 * Detail slider. Build it once and re-compose freely: dragging the slider costs
 * a few microseconds of selection rather than a full re-analysis.
 */
export interface SketchAnalysis {
  width: number;
  height: number;
  style: SketchStyleId;
  params: SketchParams;
  /** Every stroke worth drawing, ordered by layer then by score, descending. */
  strokes: SketchStroke[];
  shading: SketchShading | null;
  stats: {
    traced: number;
    eligible: number;
    layers: LayerMap<number>;
  };
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
    layers: LayerMap<number>;
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
  /** 0 = simple (construction sketch) → 1 = detailed. */
  detail: number;
  /** Optional subtle pencil shading under the line work. */
  shading?: boolean;
}
