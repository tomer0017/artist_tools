/**
 * The two sketch styles and how their three controls map onto the engine.
 *
 *   Clean Outline  thin dark contours on white, plus lighter lines for soft
 *                  shadow boundaries. Vector (SVG) export.
 *   Pencil Study   graphite tones with soft transitions, never black, and the
 *                  same contours in grey on top.
 *
 * Every control is 0–100 with 50 as the default, and 50 reproduces exactly the
 * parameters approved in the visual review (lab/sketch, 2026-11-16). Spatial
 * values are multiples of u = sqrt(width × height) / 1000, so the same
 * settings draw the same picture at any working size.
 */

export type SketchStyle = 'outline' | 'pencil';

export interface SketchControls {
  /** 0–100: finer ← 50 → bolder lines. */
  lineWeight: number;
  /** 0–100: only the main contours ← 50 → every faint edge. */
  detail: number;
  /** 0–100: lighter ← 50 → deeper graphite (Pencil Study only). */
  shading: number;
}

export const DEFAULT_CONTROLS: SketchControls = { lineWeight: 50, detail: 50, shading: 50 };

/** Clamp to 0–100 and fill gaps, so a damaged or older saved project still draws. */
export function normalizeControls(value: Partial<SketchControls> | null | undefined): SketchControls {
  const pick = (v: unknown, fallback: number) =>
    typeof v === 'number' && Number.isFinite(v) ? Math.min(100, Math.max(0, Math.round(v))) : fallback;
  return {
    lineWeight: pick(value?.lineWeight, DEFAULT_CONTROLS.lineWeight),
    detail: pick(value?.detail, DEFAULT_CONTROLS.detail),
    shading: pick(value?.shading, DEFAULT_CONTROLS.shading),
  };
}

/* ------------------------------------------------------ approved values -- */

/** Shared contour extraction (both styles use the same DoG response). */
export const CONTOUR = {
  /** Logarithmic shadow lift before line extraction. */
  shadowBoost: 6,
  /** Edge-preserving pre-smoothing reach (×u px) and edge size (L* 0..1). */
  smoothS: 4,
  smoothR: 0.12,
  /** Structure-tensor integration scale (×u px). */
  sigmaC: 2.5,
  /** Line scale (×u px, never below 0.8 px). */
  sigmaE: 1.0,
  /** Smoothing along the flow (×u px). */
  sigmaM: 3.0,
} as const;

export const OUTLINE = {
  e0: 0.003,
  e1: 0.014,
  weak: 0.06,
  strong: 0.5,
  /** Smallest stroke kept (×u² px). */
  minArea: 12,
  /** Darkness of a full-strength line. */
  strength: 0.92,
  soft: {
    sigma: 4.5, // ×u px
    low: 0.035, // lightness step 0..1
    high: 0.07,
    minLength: 40, // ×u px
    width: 1.3, // ×u px
    weight: 0.55, // ink of a soft line relative to a contour
    suppress: 3, // ×u px: no soft line this close to a contour
  },
} as const;

export const PENCIL = {
  toneS: 10,
  toneR: 0.15,
  toneLift: 2,
  /** Large dark areas are lifted toward the mean by this share of their shortfall, measured at `adaptSigma` (×u px). */
  adapt: 0.45,
  adaptSigma: 60,
  /** Darkest graphite (0..1 darkness); never black. */
  shading: 0.62,
  /** Lights below this darkness stay clean paper. */
  paper: 0.1,
  gamma: 1.05,
  /** Pencil grain amplitude (fraction of local darkness), its share where the tone is flat, and stroke length (×u px). */
  grain: 0.24,
  flatGrain: 0.3,
  strokeLength: 6,
  /** Contour layer: the same response, a little sparser, drawn in grey. */
  e0: 0.004,
  e1: 0.02,
  weak: 0.06,
  strong: 0.5,
  minArea: 12,
  lineStrength: 0.78,
  /** Scale of the "how much form is here" measure (×u px). */
  formSigma: 8,
} as const;

/* ------------------------------------------------------------ mapping -- */

export interface DetailMapping {
  /** Multiplier for the line threshold (e0, e1): below 1 draws fainter edges too. */
  edge: number;
  /**
   * Multiplier for how strong a stroke's strongest point must be for the
   * stroke to be kept (1 = the approved rule). Raising it drops weak strokes
   * whole, without making the remaining lines thinner.
   */
  keep: number;
  /** Multiplier for the smallest stroke kept. */
  area: number;
  /** Multiplier for the soft-boundary thresholds and shortest soft line. */
  soft: number;
}

/**
 * Detail → which lines are drawn. Above 50, fainter edges join in (and
 * smaller strokes survive). Below 50, the line threshold stays put and weaker
 * strokes are dropped whole, so what remains is the main contours at their
 * usual weight rather than a fading drawing.
 */
export function detailMapping(detail: number): DetailMapping {
  if (detail >= 50) {
    const a = (detail - 50) / 50;
    return { edge: Math.pow(2, -a), keep: 1, area: Math.pow(4, -a), soft: Math.pow(2, -a) };
  }
  const a = (50 - detail) / 50;
  return { edge: 1, keep: 1 + 2.5 * a, area: Math.pow(4, a), soft: Math.pow(2.5, a) };
}

export interface LineWeight {
  /** 0..~0.7: how far each contour narrows toward its centre (0 = unchanged). */
  narrow: number;
  /** Extra brush radius for bolder contours (×u px, 0 = unchanged). */
  thicken: number;
  /** Multiplier for the soft-boundary line width. */
  softWidth: number;
}

export function lineWeight(value: number): LineWeight {
  if (value < 50) {
    const a = (50 - value) / 50;
    return { narrow: 0.7 * a, thicken: 0, softWidth: 1 - 0.35 * a };
  }
  if (value > 50) {
    const a = (value - 50) / 50;
    return { narrow: 0, thicken: 2 * a, softWidth: 1 + 1.2 * a };
  }
  return { narrow: 0, thicken: 0, softWidth: 1 };
}

export interface PencilShading {
  /** Darkest graphite (0..1 darkness). */
  max: number;
  /** How much the mid-tones deepen (0 = the approved curve). */
  deepen: number;
}

/**
 * Shading → graphite density. Below 50 the whole tone lightens, down to a
 * light wash. Above 50 the darkest graphite only goes from 38 % to 30 % grey
 * (never a black mass) and the mid-tones deepen instead, which is what
 * "more shading" looks like in a pencil study. 50 is exactly the approved
 * tone.
 */
export function pencilShading(value: number): PencilShading {
  if (value <= 50) return { max: 0.25 + ((0.62 - 0.25) * value) / 50, deepen: 0 };
  const a = (value - 50) / 50;
  return { max: 0.62 + 0.08 * a, deepen: 0.8 * a };
}
