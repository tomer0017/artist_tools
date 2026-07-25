/**
 * Sketch engine — the semantic pipeline.
 *
 *   photo → noise reduction → large-shape detection → contour extraction
 *         → feature prioritisation → variable line weight → optional shading
 *
 * Split in two, and the split is the point:
 *
 *   buildSketchAnalysis(src)      — everything that does not depend on Detail
 *   composeSketch(analysis, opts) — pure selection, driven by Detail
 *
 * The analysis produces one fixed set of strokes with fixed geometry, fixed
 * widths and a fixed ranking. Detail only decides how much of each drawing
 * layer to include, so Simple ⊂ Balanced ⊂ Detailed by construction: the
 * slider adds to the drawing you already had rather than redrawing it. Every
 * line must also earn its place — kept because it is long, persists at a coarse
 * scale, sits on the subject or marks a facial accent, not because its gradient
 * cleared a threshold.
 *
 * Extraction is deliberately generous and *selection* is strict. A global
 * threshold has to choose between losing a soft shoulder line and admitting
 * every fabric edge in the picture; ranking contours against an ink budget
 * does not.
 */

import {
  clamp01,
  domainTransform,
  gaussBlur,
  hysteresis,
  luminance,
  multiChannelGradient,
  nonMaxSuppress,
  normalizeMap,
  normalizedMax,
  percentile,
  smoothstep,
  type Gradient,
} from './imageOps';
import { buildAnalysisMaps, type AnalysisMaps } from './analysis';
import {
  linkContours,
  polylineLength,
  simplify,
  traceContours,
  type RawContour,
} from './contours';
import { DEFAULT_SKETCH_STYLE, styleParams } from './styles';
import {
  LAYER_ORDER,
  type BudgetCurve,
  type LayerMap,
  type LineWeight,
  type SketchAnalysis,
  type SketchDrawing,
  type SketchLayer,
  type SketchOptions,
  type SketchParams,
  type SketchShading,
  type SketchSource,
  type SketchStroke,
  type SketchStyleId,
  type WeightMap,
} from './types';

/**
 * How much authority a colour-only boundary carries relative to a value one.
 * Just under parity: painters read value first, but an edge that exists only
 * in hue is still an edge they draw.
 */
const CHROMA_AUTHORITY = 0.85;

/**
 * Fraction of the hysteresis low threshold that must still be present along a
 * bridge for two fragments to be joined.
 */
const LINK_EVIDENCE_RATIO = 0.45;

/** What counts as a compact accent mark (an eye, a nostril, a lip). */
const ACCENT_FEATURE = 0.5;

interface Candidate {
  raw: RawContour;
  length: number;
  /** All 0..1, image-relative. */
  contrast: number;
  persistence: number;
  lengthScore: number;
  subject: number;
  clutter: number;
  crowding: number;
  feature: number;
  priority: number;
  score: number;
  structural: number;
  /** Came from the fine extraction pass — a strand, wrinkle or secondary fold. */
  fromFinePass: boolean;
}

/* ------------------------------------------------------------ public API -- */

/** Convenience: analyse and compose in one call. */
export function analyzeSketch(src: SketchSource, opts: SketchOptions): SketchDrawing {
  return composeSketch(buildSketchAnalysis(src, opts.style), opts);
}

/**
 * The expensive half. Detail-independent, so a host can build it once per image
 * and re-compose on every slider tick for free.
 */
export function buildSketchAnalysis(
  src: SketchSource,
  styleId: SketchStyleId = DEFAULT_SKETCH_STYLE,
): SketchAnalysis {
  const { width: w, height: h } = src;
  const diag = Math.hypot(w, h);
  const params = styleParams(styleId);

  const lum = luminance(src.data, w, h);

  // --- Stage 1: noise reduction -------------------------------------------
  // Edge-preserving, so pores / weave / grain / foliage speckle collapse while
  // the boundaries a painter cares about stay exactly where the camera put them.
  const base = domainTransform(lum, w, h, params.denoise.spatialFrac * diag, params.denoise.range);
  // Opponent-colour planes, so an edge that exists only in hue (a blue shirt
  // against green foliage at the same value) is still a line. Chroma is smooth
  // in a photograph to begin with, so it only needs the noise taken off.
  const chroma = chromaPlanes(src.data, w, h, diag * 0.002);
  const gChroma = multiChannelGradient(
    [
      { data: chroma.a, weight: 1 },
      { data: chroma.b, weight: 1 },
    ],
    w,
    h,
  );

  // --- Stage 2: large shape detection -------------------------------------
  // A much coarser version of the same image. Anything still showing an edge
  // here is a real mass boundary rather than surface incident.
  const shape = domainTransform(base, w, h, params.shape.spatialFrac * diag, params.shape.range);
  const coarseChroma = chromaPlanes(src.data, w, h, params.shape.spatialFrac * diag * 0.7);
  const gCoarseChroma = multiChannelGradient(
    [
      { data: coarseChroma.a, weight: 1 },
      { data: coarseChroma.b, weight: 1 },
    ],
    w,
    h,
  );

  const gLum = multiChannelGradient([{ data: base, weight: 1 }], w, h);
  const gFine = normalizedMax(
    gLum,
    gChroma,
    percentile(gLum.mag, 0.985),
    Math.max(1e-3, percentile(gChroma.mag, 0.985)),
    CHROMA_AUTHORITY,
  );
  const gShapeLum = multiChannelGradient([{ data: shape, weight: 1 }], w, h);
  const gShape = normalizedMax(
    gShapeLum,
    gCoarseChroma,
    percentile(gShapeLum.mag, 0.985),
    Math.max(1e-3, percentile(gCoarseChroma.mag, 0.985)),
    CHROMA_AUTHORITY,
  );
  const maps = buildAnalysisMaps(src.data, base, shape, gFine, gShape, w, h, diag);

  const magRef = Math.max(1e-3, percentile(gFine.mag, 0.985));
  const coarseRef = Math.max(1e-3, percentile(gShape.mag, 0.985));
  const lengthRef = diag * 0.3;

  // --- Stage 3: contour extraction ----------------------------------------
  const primary = extractContours(gFine, w, h, params, diag, params.contour.highPercentile);

  // --- Stage 3b: the fine pass (the source of the `fine` layer) ------------
  // A second, separate extraction on a barely-smoothed image, admitted only
  // where the subject is and only as *long coherent chains*. Hair strands and
  // wrinkles pass; fabric weave and pores, which are short isotropic
  // fragments, do not — something a lower threshold could never separate.
  // It runs at every detail level: the strokes have to exist in the pool for
  // Detailed to be able to add them to the same drawing Simple showed.
  const fineBase = domainTransform(lum, w, h, diag * 0.003, 12);
  const gExtra = multiChannelGradient([{ data: fineBase, weight: 1 }], w, h);
  const fineRaw = extractContours(gExtra, w, h, params, diag, params.fine.highPercentile);

  // Line crowding: a contour surrounded by many parallel neighbours is part of
  // a texture field (weave, foliage, gravel), while a feature line stands
  // alone.
  const crowding = buildCrowdingMap([...primary, ...fineRaw], w, h, diag);

  const measured = (raw: RawContour, grad: Gradient, fromFinePass: boolean) =>
    measure(raw, grad, gShape, maps, crowding, w, params, magRef, coarseRef, lengthRef, fromFinePass);

  const candidates = primary.map((raw) => measured(raw, gFine, false));
  const fineMinLength =
    Math.max(params.priority.minLengthFrac, params.fine.minLengthFrac) * diag;
  const fineCandidates = fineRaw
    .map((raw) => measured(raw, gExtra, true))
    .filter((c) => c.length >= fineMinLength && c.subject >= params.fine.minSubject);

  // --- Stage 4: feature prioritisation ------------------------------------
  const pool = [...candidates, ...fineCandidates];
  const eligible = filterEligible(pool, params, diag);

  // --- Stage 5: variable line weight --------------------------------------
  // Every quantile here is taken over the whole eligible pool, never over the
  // selected subset — a line has to look the same at every detail level, and a
  // cut that moved with the slider would restyle strokes the artist had already
  // got used to.
  const structurals = eligible
    .filter((c) => !c.fromFinePass)
    .map((c) => c.structural)
    .sort((a, b) => a - b);
  const structureCut = quantile(structurals, params.priority.structureQuantile);
  const compositionCut = quantile(structurals, params.priority.compositionQuantile);

  const layerCounts: LayerMap<number> = { structure: 0, face: 0, secondary: 0, fine: 0 };
  const byLayer: LayerMap<Candidate[]> = { structure: [], face: [], secondary: [], fine: [] };
  for (const c of eligible) {
    const layer = classify(c, structureCut, compositionCut, params);
    if (!layer) continue; // background with nothing to say
    byLayer[layer].push(c);
    layerCounts[layer]++;
  }

  // The heavy/medium split is taken *within* each layer. Against the whole
  // pool it is degenerate: structure is by definition the most structural
  // slice of that pool, so every one of its lines clears the cut and the
  // silhouette comes out at a single uniform weight. Splitting inside the
  // layer is what separates the true outline from the merely-major boundary.
  const heavyCut = layerQuantile(byLayer.structure, params.hierarchy.heavyQuantile);
  const mediumCut = layerQuantile(byLayer.secondary, params.hierarchy.mediumQuantile);

  const baseWidth = params.hierarchy.baseWidthFrac * diag;
  const epsilon = params.simplifyFrac * diag;
  const strokes: SketchStroke[] = [];
  let nextId = 0;
  for (const layer of LAYER_ORDER) {
    const group = byLayer[layer].sort((a, b) => b.score - a.score);
    for (const c of group) {
      if (strokes.length >= params.maxStrokes) break;
      const weightClass = weightFor(layer, c, heavyCut, mediumCut);
      const stroke = buildStroke(
        nextId,
        c,
        layer,
        weightClass,
        baseWidth,
        epsilon,
        gFine,
        w,
        h,
        magRef,
        params,
      );
      if (!stroke) continue;
      nextId++;
      strokes.push(stroke);
    }
  }

  // --- Stage 6: pencil shading (built once; the caller decides to show it) --
  const shading =
    params.shading.amount > 0.01 ? buildShading(shape, w, h, diag, params) : null;

  return {
    width: w,
    height: h,
    style: styleId,
    params,
    strokes,
    shading,
    stats: {
      traced: primary.length + fineRaw.length,
      eligible: eligible.length,
      layers: layerCounts,
    },
  };
}

/**
 * The cheap half: pick a prefix of each layer's fixed ranking, sized by Detail.
 *
 * Because the rankings never change and every budget curve is non-decreasing,
 * the stroke set at a lower detail is always a subset of the set at a higher
 * one. That is the whole guarantee — "more detail" can only ever mean "the same
 * drawing, plus more".
 */
export function composeSketch(analysis: SketchAnalysis, opts: SketchOptions): SketchDrawing {
  const detail = clamp01(opts.detail);
  const diag = Math.hypot(analysis.width, analysis.height);
  const { params } = analysis;

  const weights: WeightMap<number> = { heavy: 0, medium: 0, light: 0 };
  const layers: LayerMap<number> = { structure: 0, face: 0, secondary: 0, fine: 0 };
  const kept: SketchStroke[] = [];

  for (const layer of LAYER_ORDER) {
    const budget = resolveBudget(params.layers[layer], detail) * diag;
    if (budget <= 0) continue;
    let spent = 0;
    for (const stroke of analysis.strokes) {
      if (stroke.layer !== layer) continue;
      if (spent >= budget) break;
      kept.push(stroke);
      weights[stroke.weightClass]++;
      layers[layer]++;
      spent += stroke.length;
    }
  }

  return {
    width: analysis.width,
    height: analysis.height,
    strokes: kept,
    shading: opts.shading ? analysis.shading : null,
    style: analysis.style,
    detail,
    paper: params.paper,
    ink: params.ink,
    opacity: params.hierarchy.opacity,
    stats: { traced: analysis.stats.traced, kept: kept.length, weights, layers },
  };
}

/** Piecewise-linear across [Simple, Balanced, Detailed]. */
export function resolveBudget(curve: BudgetCurve, detail: number): number {
  const d = clamp01(detail);
  return d <= 0.5
    ? curve[0] + (curve[1] - curve[0]) * (d / 0.5)
    : curve[1] + (curve[2] - curve[1]) * ((d - 0.5) / 0.5);
}

/* ---------------------------------------------------------------- helpers -- */

/** Blurred red–green / yellow–blue opponent planes, scaled to luminance units. */
function chromaPlanes(data: Uint8ClampedArray, w: number, h: number, sigma: number) {
  const n = w * h;
  const a = new Float32Array(n);
  const b = new Float32Array(n);
  for (let p = 0, i = 0; p < n; p++, i += 4) {
    a[p] = data[i] - data[i + 1];
    b[p] = (data[i] + data[i + 1]) / 2 - data[i + 2];
  }
  return { a: gaussBlur(a, w, h, sigma), b: gaussBlur(b, w, h, sigma) };
}

function extractContours(
  grad: Gradient,
  w: number,
  h: number,
  params: SketchParams,
  diag: number,
  highPercentile: number,
): RawContour[] {
  const nms = nonMaxSuppress(grad, w, h);
  const high = percentile(nms, highPercentile, true);
  if (high <= 0) return [];
  const low = high * params.contour.lowRatio;
  const traced = traceContours(hysteresis(nms, w, h, high, low), w, h);
  // Drop specks before linking — they are never lines, and skipping them keeps
  // the endpoint search small.
  const minSpeck = Math.max(3, diag * 0.004);
  const worth = traced.filter((c) => polylineLength(c.pts) >= minSpeck);
  return linkContours(
    worth,
    params.link.gapFrac * diag,
    params.link.minCos,
    grad.mag,
    low * LINK_EVIDENCE_RATIO,
    w,
    h,
  );
}

function buildCrowdingMap(
  contours: RawContour[],
  w: number,
  h: number,
  diag: number,
): Float32Array {
  const density = new Float32Array(w * h);
  for (const c of contours) {
    const pts = c.pts;
    for (let i = 0; i < pts.length; i += 2) {
      const x = pts[i] | 0;
      const y = pts[i + 1] | 0;
      if (x < 0 || y < 0 || x >= w || y >= h) continue;
      density[y * w + x] += 1;
    }
  }
  return normalizeMap(gaussBlur(density, w, h, diag * 0.01), 0.2, 0.96);
}

function measure(
  raw: RawContour,
  grad: Gradient,
  gShape: Gradient,
  maps: AnalysisMaps,
  crowding: Float32Array,
  w: number,
  params: SketchParams,
  magRef: number,
  coarseRef: number,
  lengthRef: number,
  fromFinePass: boolean,
): Candidate {
  const pts = raw.pts;
  const n = pts.length / 2;
  // Long contours are sampled rather than walked in full; the averages are
  // stable well before then and this keeps a dense photo interactive.
  const step = Math.max(1, Math.floor(n / 96));
  let mag = 0;
  let coarse = 0;
  let subject = 0;
  let clutter = 0;
  let crowd = 0;
  let priority = 0;
  let feature = 0;
  let samples = 0;
  for (let i = 0; i < n; i += step) {
    const o = (pts[i * 2 + 1] | 0) * w + (pts[i * 2] | 0);
    mag += grad.mag[o];
    coarse += gShape.mag[o];
    subject += maps.subject[o];
    clutter += maps.clutter[o];
    crowd += crowding[o];
    priority += maps.priority[o];
    if (maps.feature[o] > feature) feature = maps.feature[o];
    samples++;
  }
  const inv = samples ? 1 / samples : 0;
  const length = polylineLength(pts);

  const contrast = clamp01((mag * inv) / magRef);
  const persistence = clamp01((coarse * inv) / coarseRef);
  const lengthScore = clamp01(length / lengthRef);
  const subjectScore = clamp01(subject * inv);
  const clutterScore = clamp01(clutter * inv);
  const crowdScore = clamp01(crowd * inv);
  const priorityScore = clamp01(priority * inv);

  const wgt = params.priority.weights;
  const merit =
    wgt.contrast * contrast +
    wgt.persistence * persistence +
    wgt.length * lengthScore +
    wgt.subject * subjectScore +
    wgt.feature * Math.max(feature, priorityScore * 0.8);

  // Background / texture suppression. Two independent penalties, each relaxed
  // by the thing that distinguishes a real line from the texture it resembles:
  //   • clutter (fine detail with no large-scale structure) is relaxed by
  //     persistence — that is how a compositionally important background
  //     element, a horizon or a doorway or a tree trunk, survives while the
  //     foliage around it does not;
  //   • crowding (many parallel neighbours) is relaxed by length — a hundred
  //     hair strands and one shoulder line are equally "crowded", and only the
  //     shoulder is long.
  // Both are then relaxed by the feature map, so an eye inside a busy region is
  // never erased.
  //
  // Crowding is a tiebreaker, not a primary lever. It is normalised across the
  // whole frame, and in a portrait the densest place is the face itself — lean
  // on it hard and the eyes go down with the foliage. Scale-aware clutter does
  // the real background suppression.
  //
  // The fine pass is judged with more tolerance for repetition still: drawing a
  // few members of a repeated set is exactly its job, and its separate ink
  // budget is what keeps "a few strands" from becoming "every hair".
  const crowdPenalty =
    params.priority.crowdPenalty * (fromFinePass ? params.fine.crowdTolerance : 1);
  const clutterTerm = params.priority.clutterPenalty * clutterScore * (1 - persistence * 0.85);
  const crowdTerm = crowdPenalty * crowdScore * crowdScore * (1 - lengthScore * 0.4);
  const suppression = (clutterTerm + crowdTerm) * (1 - Math.max(feature, priorityScore) * 0.8);

  return {
    raw,
    length,
    contrast,
    persistence,
    lengthScore,
    subject: subjectScore,
    clutter: clutterScore,
    crowding: crowdScore,
    feature,
    priority: priorityScore,
    score: clamp01(merit - suppression),
    structural: 0.5 * persistence + 0.35 * lengthScore + 0.15 * contrast,
    fromFinePass,
  };
}

/**
 * Everything that is worth drawing at *some* detail level. Rejection here is
 * permanent, which is what lets the top of the slider add information freely:
 * fabric weave, pores and compression mush are removed from the pool entirely
 * rather than merely out-ranked, so no budget can ever reach them.
 */
function filterEligible(pool: Candidate[], params: SketchParams, diag: number): Candidate[] {
  const minLen = params.priority.minLengthFrac * diag;
  const { texture } = params.priority;
  let best = 0;
  for (const c of pool) if (!c.fromFinePass && c.score > best) best = c.score;
  // Relative to the best contour in *this* photograph: what counts as a weak
  // line on a crisp studio portrait is a strong one on a soft overcast
  // landscape, and an absolute number is wrong on both.
  const floor = Math.max(params.priority.scoreFloor, best * params.priority.relativeFloor);

  return pool.filter((c) => {
    if (c.score < floor) return false;
    if (c.clutter >= texture.clutter && c.persistence < texture.persistence && c.feature < 0.4) {
      return false;
    }
    // Accents are short by nature; a strong feature score buys a contour most
    // of the way past the length gate.
    return c.length >= (c.feature > 0.6 ? minLen * 0.4 : minLen);
  });
}

/**
 * Which layer of the drawing a contour belongs to, or `null` if it belongs in
 * no drawing at all.
 *
 * Order matters. Structure wins over face — a jawline is both, and it belongs
 * in the layer drawn first and heaviest. Off the subject, only a strongly
 * structural line survives, and it survives as structure: that is how a
 * horizon or a doorway stays while the foliage beside it goes. Everything from
 * the fine pass is fine detail whatever else it scores, so a strand can never
 * present itself as a contour.
 */
function classify(
  c: Candidate,
  structureCut: number,
  compositionCut: number,
  params: SketchParams,
): SketchLayer | null {
  const onSubject = c.subject >= params.priority.backgroundSubject;
  if (c.structural >= structureCut && (onSubject || c.structural >= compositionCut)) {
    return c.fromFinePass ? 'fine' : 'structure';
  }
  if (!onSubject) return null;
  if (c.fromFinePass) return 'fine';
  const { faceRegion, faceContrast } = params.priority;
  if (c.priority >= faceRegion && (c.feature >= ACCENT_FEATURE || c.contrast >= faceContrast)) {
    return 'face';
  }
  return 'secondary';
}

function weightFor(
  layer: SketchLayer,
  c: Candidate,
  heavyCut: number,
  mediumCut: number,
): LineWeight {
  if (layer === 'fine') return 'light';
  if (layer === 'structure') return c.structural >= heavyCut ? 'heavy' : 'medium';
  if (layer === 'face') return 'medium';
  return c.structural >= mediumCut ? 'medium' : 'light';
}

/** Quantile of the structural score among one layer's members. */
function layerQuantile(group: Candidate[], q: number): number {
  return quantile(
    group.map((c) => c.structural).sort((a, b) => a - b),
    q,
  );
}

function quantile(sorted: number[], q: number): number {
  if (!sorted.length) return 0;
  const i = Math.min(sorted.length - 1, Math.max(0, Math.round(q * (sorted.length - 1))));
  return sorted[i];
}

function buildStroke(
  id: number,
  c: Candidate,
  layer: SketchLayer,
  weightClass: LineWeight,
  baseWidth: number,
  epsilon: number,
  gFine: Gradient,
  w: number,
  h: number,
  magRef: number,
  params: SketchParams,
): SketchStroke | null {
  const pts = simplify(c.raw.pts, epsilon);
  const n = pts.length / 2;
  if (n < 2) return null;

  const width = baseWidth * params.hierarchy.widthScale[weightClass];
  const { taper, taperDepth, pressure } = params.hierarchy;

  // Arc-length parameterisation, so the taper reads the same on a short mark
  // and a long sweeping contour.
  const cum = new Float32Array(n);
  for (let i = 1; i < n; i++) {
    cum[i] = cum[i - 1] + Math.hypot(pts[i * 2] - pts[i * 2 - 2], pts[i * 2 + 1] - pts[i * 2 - 1]);
  }
  const total = cum[n - 1] || 1;

  const widths = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = cum[i] / total;
    const taperFactor = c.raw.closed
      ? 1
      : 1 - taperDepth * (1 - smoothstep(0, taper, t) * smoothstep(0, taper, 1 - t));
    const x = Math.min(w - 1, Math.max(0, pts[i * 2] | 0));
    const y = Math.min(h - 1, Math.max(0, pts[i * 2 + 1] | 0));
    // Local contrast becomes pencil pressure: the line thickens where the form
    // turns hard and thins where it dissolves.
    const local = clamp01(gFine.mag[y * w + x] / magRef);
    const pressureFactor = 1 - pressure * 0.5 + pressure * local;
    widths[i] = Math.max(0.35, width * taperFactor * pressureFactor);
  }

  return {
    id,
    points: pts,
    widths,
    weightClass,
    layer,
    length: total,
    score: c.score,
    closed: c.raw.closed,
  };
}

/**
 * Tone taken from the large-shape image, gated to the darks and quantised into
 * a few bands — a painter's shadow block-in, not a grayscale copy of the photo.
 */
function buildShading(
  shape: Float32Array,
  w: number,
  h: number,
  diag: number,
  params: SketchParams,
): SketchShading {
  const lo = percentile(shape, 0.03);
  const hi = Math.max(lo + 1, percentile(shape, 0.97));
  const span = hi - lo;
  const { amount, bands, start } = params.shading;
  const tone = new Float32Array(w * h);
  for (let p = 0; p < tone.length; p++) {
    const darkness = clamp01((hi - shape[p]) / span);
    const t = smoothstep(start, 0.98, darkness);
    tone[p] = t > 0 ? (Math.round(t * bands) / bands) * amount : 0;
  }
  return {
    width: w,
    height: h,
    tone: gaussBlur(tone, w, h, diag * 0.004),
    hatch: params.shading.hatch,
  };
}
