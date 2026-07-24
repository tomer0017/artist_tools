// Compare Art — shared types, defaults and constants.
//
// This workspace is fully isolated from the global project store. All of its
// state lives under a single session object persisted to its own localStorage
// key. Geometry is stored resolution-independently (see compareArtGeometry.ts)
// so what the painter aligns on screen is pixel-identical in every export.

/** Which of the two images a control targets. Never generic "image 1/2". */
export type LayerKind = 'artwork' | 'reference' | 'grid';

/** The five comparison modes offered to the painter. */
export type CompareMode = 'overlay' | 'blink' | 'split' | 'difference';

/** Within Difference mode, what the map emphasises. */
export type DifferenceMetric = 'value' | 'color';

/** Difference sensitivity presets. */
export type Sensitivity = 'subtle' | 'balanced' | 'strong';

/** Nudge granularity for precision alignment. */
export type NudgeStep = 'fine' | 'normal';

export type BlinkSpeed = 'slow' | 'normal' | 'fast';
export type SplitOrientation = 'horizontal' | 'vertical';

/** GIF animation styles. */
export type GifAnimation = 'opacity-pulse' | 'blink' | 'compare-diff';
export type GifSpeed = 'slow' | 'normal' | 'fast';
export type GifSize = 'small' | 'standard' | 'high';

/** Aspect/shape presets offered on the pre-comparison crop screen. */
// Crop presets are data-driven (see CROP_PRESETS in compareArtCrop.ts) so new
// painter formats can be added without touching crop logic. The union is the
// set of known ids; the 'a5'/'a4'/'a3' painter paper formats are additive.
export type CropPreset =
  | 'free' | 'square' | 'circle' | '4:3' | '3:4' | '16:9' | 'original'
  | 'a5' | 'a4' | 'a3';

/**
 * A non-destructive, re-editable crop applied to a *source* image BEFORE it
 * enters the comparison. The rect is normalised to the original image (0..1).
 * `shape: 'circle'` masks the output to a circle (transparent corners), which
 * the difference engine treats as no-data automatically.
 */
export interface ImageCrop {
  rect: { x: number; y: number; w: number; h: number };
  shape: 'rect' | 'circle';
  preset: CropPreset;
}

export const FULL_IMAGE_CROP: ImageCrop = {
  rect: { x: 0, y: 0, w: 1, h: 1 },
  shape: 'rect',
  preset: 'free',
};

/** Longest-side cap for a cropped source image handed to the engine. */
export const CROP_OUTPUT_MAX_DIM = 2000;

/**
 * A 2D affine transform for an image, stored resolution-independently.
 * - tx, ty: translation of the image centre away from the scene centre,
 *   expressed in units of scene WIDTH (isotropic — same unit for x and y so
 *   the geometry survives non-square scenes and any render resolution).
 * - scale: multiplier applied on top of the image's contain-fit base scale.
 * - rotation: radians, clockwise.
 * - flipH: mirror horizontally.
 */
export interface Transform {
  tx: number;
  ty: number;
  scale: number;
  rotation: number;
  flipH: boolean;
}

export const IDENTITY_TRANSFORM: Transform = {
  tx: 0,
  ty: 0,
  scale: 1,
  rotation: 0,
  flipH: false,
};

/** Non-destructive crop, normalised to the scene (0..1). */
export interface CropRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export const FULL_CROP: CropRect = { x: 0, y: 0, w: 1, h: 1 };

export interface GridConfig {
  enabled: boolean;
  rows: number;
  columns: number;
  opacity: number;
  lineColor: string;
  lineWidth: number;
  emphasizeCenter: boolean;
  square: boolean;
  includeInExport: boolean;
}

export const DEFAULT_GRID: GridConfig = {
  enabled: false,
  rows: 3,
  columns: 3,
  opacity: 0.5,
  lineColor: '#ffffff',
  lineWidth: 1,
  emphasizeCenter: true,
  square: false,
  includeInExport: true,
};

export interface DifferenceConfig {
  metric: DifferenceMetric;
  sensitivity: Sensitivity;
  monochrome: boolean;
}

export const DEFAULT_DIFFERENCE: DifferenceConfig = {
  metric: 'value',
  sensitivity: 'balanced',
  monochrome: false,
};

export interface GifConfig {
  animation: GifAnimation;
  speed: GifSpeed;
  size: GifSize;
  includeGrid: boolean;
  loop: boolean;
}

export const DEFAULT_GIF: GifConfig = {
  animation: 'opacity-pulse',
  speed: 'normal',
  size: 'standard',
  includeGrid: true,
  loop: true,
};

/** Metadata about a loaded image (kept alongside its data URL). */
export interface ImageMeta {
  width: number;
  height: number;
  name?: string;
}

/**
 * The complete, serialisable Compare Art session. Image payloads are optional
 * on restore — if localStorage could not hold them the settings still load and
 * the UI asks the painter to re-select the missing image.
 */
export interface CompareSession {
  version: number;
  /** The cropped images the comparison engine actually consumes. */
  artwork: string | null;
  reference: string | null;
  artworkMeta: ImageMeta | null;
  referenceMeta: ImageMeta | null;
  /** Uncropped originals + crop params, kept so the crop is re-editable. */
  artworkOriginal: string | null;
  referenceOriginal: string | null;
  artworkCrop: ImageCrop | null;
  referenceCrop: ImageCrop | null;
  artworkTransform: Transform;
  referenceTransform: Transform;
  artworkLocked: boolean;
  referenceHidden: boolean;
  crop: CropRect;
  opacity: number;
  mode: CompareMode;
  grayscale: boolean;
  blinkSpeed: BlinkSpeed;
  splitOrientation: SplitOrientation;
  splitPosition: number; // 0..1
  /** Split mode only: swap which image appears on each side (artwork ↔ reference). */
  splitSwapped: boolean;
  grid: GridConfig;
  difference: DifferenceConfig;
  gif: GifConfig;
  savedAt: number;
}

export const SESSION_VERSION = 1;

export function defaultSession(): CompareSession {
  return {
    version: SESSION_VERSION,
    artwork: null,
    reference: null,
    artworkMeta: null,
    referenceMeta: null,
    artworkOriginal: null,
    referenceOriginal: null,
    artworkCrop: null,
    referenceCrop: null,
    artworkTransform: { ...IDENTITY_TRANSFORM },
    referenceTransform: { ...IDENTITY_TRANSFORM },
    artworkLocked: true,
    referenceHidden: false,
    crop: { ...FULL_CROP },
    opacity: 0.5,
    mode: 'overlay',
    grayscale: false,
    blinkSpeed: 'normal',
    splitOrientation: 'horizontal',
    splitPosition: 0.5,
    splitSwapped: false,
    grid: { ...DEFAULT_GRID },
    difference: { ...DEFAULT_DIFFERENCE },
    gif: { ...DEFAULT_GIF },
    savedAt: 0,
  };
}

// ── Tuning constants ────────────────────────────────────────────────────────

/** Longest-side cap for the interactive working image (perf). */
export const WORKING_MAX_DIM = 1600;
/** Longest-side cap for the scene used by still/GIF export. */
export const EXPORT_MAX_DIM = 2000;
/** Longest-side cap for the difference analysis buffers (perf). */
export const ANALYSIS_MAX_DIM = 480;

/** Precision nudge increments, expressed in scene-normalised units. */
export const NUDGE: Record<NudgeStep, { move: number; scale: number; rotate: number }> = {
  // move: fraction of scene width · scale: multiplier delta · rotate: radians
  fine: { move: 0.001, scale: 0.0025, rotate: (0.1 * Math.PI) / 180 },
  normal: { move: 0.01, scale: 0.015, rotate: (0.5 * Math.PI) / 180 },
};

export const BLINK_INTERVAL_MS: Record<BlinkSpeed, number> = {
  slow: 1200,
  normal: 650,
  fast: 300,
};

/** Per-frame delay (ms) for exported GIFs, by speed preset. */
export const GIF_FRAME_DELAY_MS: Record<GifSpeed, number> = {
  slow: 180,
  normal: 110,
  fast: 60,
};

export const GIF_SIZE_MAX_DIM: Record<GifSize, number> = {
  small: 360,
  standard: 560,
  high: 800,
};

/**
 * Difference sensitivity → analysis parameters.
 * threshold: perceptual delta below which a pixel is treated as "close match".
 * gain: multiplies the visualised intensity above threshold.
 */
export const SENSITIVITY_PARAMS: Record<Sensitivity, { threshold: number; gain: number }> = {
  subtle: { threshold: 0.09, gain: 2.2 },
  balanced: { threshold: 0.05, gain: 3.0 },
  strong: { threshold: 0.025, gain: 4.0 },
};

// Palette-consistent difference colours (brand amber primary, blue secondary).
export const DIFF_COLORS = {
  lighter: [245, 158, 11] as [number, number, number], // artwork too light → amber
  darker: [59, 130, 246] as [number, number, number], // artwork too dark → blue
  warm: [239, 68, 68] as [number, number, number], // artwork too warm → red
  cool: [56, 189, 248] as [number, number, number], // artwork too cool → cyan
  neutral: [148, 163, 184] as [number, number, number],
};
