/**
 * Sketch engine — the semantic pipeline.
 *
 *   photo → noise reduction → large-shape detection → contour extraction
 *         → feature prioritisation → variable line weight → optional shading
 *
 * The guiding rule is that every line must earn its place: a contour is kept
 * because it is long, persists at a coarse scale, sits on the subject, or
 * marks a facial accent — not because its gradient cleared a threshold. That
 * is the difference between "more edges" and "better information".
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
import { DEFAULT_SKETCH_STYLE, resolveParams } from './styles';
import type {
  LineWeight,
  SketchDrawing,
  SketchOptions,
  SketchParams,
  SketchShading,
  SketchSource,
  SketchStroke,
  WeightMap,
} from './types';

/**
 * A contour must score at least this fraction of the best contour in the same
 * photograph to be drawn at all, whatever budget is left over.
 */
const RELATIVE_FLOOR = 0.36;

/** What counts as a short high-priority accent mark (an eye, a nostril, a lip). */
const ACCENT_FEATURE = 0.55;
const ACCENT_MAX_LENGTH = 0.5;

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
  score: number;
  structural: number;
  /** Fine-pass contours are always light, whatever they score. */
  forcedLight: boolean;
}

export function analyzeSketch(src: SketchSource, opts: SketchOptions): SketchDrawing {
  const { width: w, height: h } = src;
  const diag = Math.hypot(w, h);
  const style = opts.style ?? DEFAULT_SKETCH_STYLE;
  const detail = clamp01(opts.detail);
  const params = resolveParams(style, detail);

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
  const chromaRef = Math.max(1e-3, percentile(gChroma.mag, 0.985));

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
    chromaRef,
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
  const maps = buildAnalysisMaps(base, shape, gFine, gShape, w, h, diag);

  const magRef = Math.max(1e-3, percentile(gFine.mag, 0.985));
  const coarseRef = Math.max(1e-3, percentile(gShape.mag, 0.985));
  const lengthRef = diag * 0.3;

  // --- Stage 3: contour extraction ----------------------------------------
  const primary = extractContours(gFine, w, h, params, diag, params.contour.highPercentile);

  // --- Stage 3b: the fine pass (how "Detailed" adds information) -----------
  // A second, separate extraction on a barely-smoothed image, admitted only
  // where the subject is and only as *long coherent chains*. Hair strands and
  // wrinkles pass; fabric weave and pores, which are short isotropic
  // fragments, do not — something a lower threshold could never separate.
  let fineRaw: RawContour[] = [];
  let gExtra: Gradient | null = null;
  if (params.fine.budgetFrac > 0.01) {
    const fineBase = domainTransform(lum, w, h, diag * 0.003, 12);
    gExtra = multiChannelGradient([{ data: fineBase, weight: 1 }], w, h);
    fineRaw = extractContours(gExtra, w, h, params, diag, params.fine.highPercentile);
  }

  // Line crowding: a contour surrounded by many parallel neighbours is part of
  // a texture field (weave, foliage, gravel), while a feature line stands
  // alone. This is the measure that separates "an eyebrow" from "one of two
  // hundred grass blades" — both are strong, long and coherent.
  const crowding = buildCrowdingMap([...primary, ...fineRaw], w, h, diag);

  const candidates = primary.map((raw) =>
    measure(raw, gFine, gShape, maps, crowding, w, params, magRef, coarseRef, lengthRef, false),
  );

  let finePool: Candidate[] = [];
  if (gExtra && fineRaw.length) {
    const minLen = Math.max(params.priority.minLengthFrac, params.fine.minLengthFrac) * diag;
    finePool = fineRaw
      .map((raw) =>
        measure(raw, gExtra!, gShape, maps, crowding, w, params, magRef, coarseRef, lengthRef, true),
      )
      .filter((c) => c.length >= minLen && c.subject >= params.fine.minSubject);
  }


  // --- Stage 4: feature prioritisation ------------------------------------
  // The floor is relative to the best contour in *this* photograph: what
  // counts as a weak line on a crisp studio portrait is a strong one on a soft
  // overcast landscape, and an absolute number is wrong on both.
  let best = 0;
  for (const c of candidates) if (c.score > best) best = c.score;
  const floor = Math.max(params.priority.scoreFloor, best * RELATIVE_FLOOR);
  const kept = selectByBudget(candidates, params.priority.budgetFrac * diag, floor, params, diag);
  // Fine detail is judged on the same scale as the main drawing, discounted by
  // the style's tolerance for it — otherwise the best strand in a field of
  // strands always looks good relative to the other strands.
  const fineKept = selectByBudget(
    finePool,
    params.fine.budgetFrac * diag,
    floor * params.fine.floorRatio,
    params,
    diag,
    true,
  );

  // --- Stage 5: variable line weight --------------------------------------
  // Classes come from quantiles of the *structural* score, so every image gets
  // a real hierarchy instead of collapsing to one width when it happens to be
  // low-contrast overall.
  const structurals = kept.map((c) => c.structural).sort((a, b) => a - b);
  const heavyCut = quantile(structurals, params.hierarchy.heavyQuantile);
  const mediumCut = quantile(structurals, params.hierarchy.mediumQuantile);

  const weights: WeightMap<number> = { heavy: 0, medium: 0, light: 0 };
  const strokes: SketchStroke[] = [];
  const baseWidth = params.hierarchy.baseWidthFrac * diag;
  const epsilon = params.simplifyFrac * diag;

  for (const c of [...kept, ...fineKept]) {
    const weightClass: LineWeight = c.forcedLight
      ? 'light'
      : c.structural >= heavyCut
        ? 'heavy'
        : c.structural >= mediumCut
          ? 'medium'
          : 'light';
    const stroke = buildStroke(c, weightClass, baseWidth, epsilon, gFine, w, h, magRef, params);
    if (!stroke) continue;
    strokes.push(stroke);
    weights[weightClass]++;
  }

  // --- Stage 6: optional pencil shading -----------------------------------
  const shading =
    opts.shading && params.shading.amount > 0.01 ? buildShading(shape, w, h, diag, params) : null;

  return {
    width: w,
    height: h,
    strokes,
    shading,
    style,
    detail,
    paper: params.paper,
    ink: params.ink,
    opacity: params.hierarchy.opacity,
    stats: {
      traced: primary.length + fineRaw.length,
      kept: strokes.length,
      weights,
    },
  };
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
  forcedLight: boolean,
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
  let feature = 0;
  let samples = 0;
  for (let i = 0; i < n; i += step) {
    const o = (pts[i * 2 + 1] | 0) * w + (pts[i * 2] | 0);
    mag += grad.mag[o];
    coarse += gShape.mag[o];
    subject += maps.subject[o];
    clutter += maps.clutter[o];
    crowd += crowding[o];
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

  const wgt = params.priority.weights;
  const merit =
    wgt.contrast * contrast +
    wgt.persistence * persistence +
    wgt.length * lengthScore +
    wgt.subject * subjectScore +
    wgt.feature * feature;

  // Background / texture suppression. Two independent penalties, each relaxed
  // by the thing that distinguishes a real line from the texture it resembles:
  //   • clutter (fine detail with no large-scale structure) is relaxed by
  //     persistence — that is how a compositionally important background
  //     element, a horizon or a doorway or a tree trunk, survives while the
  //     foliage around it does not;
  //   • crowding (many parallel neighbours) is relaxed by length — a hundred
  //     hair strands and one shoulder line are equally "crowded", and only the
  //     shoulder is long. Squaring it means mild repetition costs almost
  //     nothing while a dense field is punished hard.
  // Both are then relaxed by the feature map, so an eye inside a busy region
  // is never erased.
  const clutterTerm =
    params.priority.clutterPenalty * clutterScore * (1 - persistence * 0.85);
  // Crowding is a tiebreaker, not a primary lever. It is normalised across the
  // whole frame, and in a portrait the densest place is the face itself — lean
  // on it hard and the eyes go down with the foliage. Scale-aware clutter does
  // the real background suppression; crowding only breaks ties inside it.
  //
  // The fine pass is judged with more tolerance for repetition still: drawing a
  // few members of a repeated set is exactly its job. Its small separate budget
  // is what keeps "a few strands" from becoming "the whole head of hair".
  const crowdPenalty =
    params.priority.crowdPenalty * (forcedLight ? params.fine.crowdTolerance : 1);
  const crowdTerm = crowdPenalty * crowdScore * crowdScore * (1 - lengthScore * 0.4);
  const suppression = (clutterTerm + crowdTerm) * (1 - feature * 0.8);

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
    score: clamp01(merit - suppression),
    structural: 0.5 * persistence + 0.35 * lengthScore + 0.15 * contrast,
    forcedLight,
  };
}

/**
 * Take contours best-first until the ink budget runs out.
 *
 * This is what makes the Detail slider mean "how much drawing", independently
 * of how contrasty the photograph happens to be — and it guarantees the result
 * is never an empty page nor a thicket.
 *
 * The budget is split in two, because spending it purely best-first is
 * length-greedy: a handful of excellent long contours exhaust it before a
 * single eye is reached. A painter does not work that way — the accents go in
 * regardless of how much the big shapes cost — so short high-feature marks get
 * their own reserved share, and whatever either side underspends flows to the
 * other.
 */
function selectByBudget(
  candidates: Candidate[],
  budget: number,
  floor: number,
  params: SketchParams,
  diag: number,
  skipLengthGate = false,
): Candidate[] {
  if (!candidates.length) return [];
  const minLen = params.priority.minLengthFrac * diag;
  const eligible = candidates.filter((c) => {
    if (c.score < floor) return false;
    if (skipLengthGate) return true;
    // Facial accents are short by nature; a strong feature score buys a
    // contour most of the way past the length gate.
    return c.length >= (c.feature > 0.6 ? minLen * 0.4 : minLen);
  });
  if (!eligible.length) return [];

  const isAccent = (c: Candidate) => c.feature >= ACCENT_FEATURE && c.lengthScore < ACCENT_MAX_LENGTH;
  const accents = eligible.filter(isAccent).sort((a, b) => b.score - a.score);
  const structure = eligible.filter((c) => !isAccent(c)).sort((a, b) => b.score - a.score);

  const accentBudget = budget * params.priority.accentShare;
  const taken = new Set<Candidate>();
  let spent = 0;
  const fill = (pool: Candidate[], allowance: number) => {
    let used = 0;
    for (const c of pool) {
      if (taken.size >= params.maxStrokes) break;
      if (used >= allowance) break;
      if (taken.has(c)) continue;
      taken.add(c);
      used += c.length;
      spent += c.length;
    }
  };
  fill(accents, accentBudget);
  fill(structure, budget - spent);
  // Any budget the structural pass left over goes back to the accents.
  fill(accents, budget - spent);

  return eligible.filter((c) => taken.has(c));
}

function quantile(sorted: number[], q: number): number {
  if (!sorted.length) return 0;
  const i = Math.min(sorted.length - 1, Math.max(0, Math.round(q * (sorted.length - 1))));
  return sorted[i];
}

function buildStroke(
  c: Candidate,
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

  return { points: pts, widths, weightClass, score: c.score, closed: c.raw.closed };
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
