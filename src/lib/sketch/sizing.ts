/**
 * How big the sketch engine is allowed to work, on screen and when saving.
 *
 * The engine holds a fixed number of full-size planes, so its memory is set
 * by the pixel count: about 48 bytes per pixel between renders and up to ~70
 * at the peak of a first render (measured, see pipeline.test.ts). The limits
 * below keep that well inside what a phone gives a web page, and they are
 * never exceeded silently: the sizes actually used are reported with every
 * result, and the save sheet says what was saved.
 */

export interface SketchLimits {
  /** On-screen drawing: pixel count and longest side. The approved review ran at 1.57 MP. */
  previewPixels: number;
  previewSide: number;
  /** Saved Pencil Study, recomputed at this size (never above the photo's own). */
  pencilExportPixels: number;
  /** Saved Clean Outline PNG, drawn from the vector paths: longest side. */
  outlineExportSide: number;
}

export const DESKTOP_LIMITS: SketchLimits = {
  previewPixels: 1_600_000,
  previewSide: 1600,
  pencilExportPixels: 4_200_000,
  outlineExportSide: 3200,
};

/** Phones and tablets: the same on-screen drawing, smaller saved files. */
export const MOBILE_LIMITS: SketchLimits = {
  previewPixels: 1_600_000,
  previewSide: 1600,
  pencilExportPixels: 2_500_000,
  outlineExportSide: 2400,
};

/** iOS refuses canvases above 16.7 million pixels; stay clear of it everywhere. */
export const MAX_CANVAS_PIXELS = 16_000_000;

export interface Size {
  width: number;
  height: number;
}

/** Fit `width × height` inside a pixel count and a longest side, keeping the aspect ratio. Never enlarges. */
export function fitSize(width: number, height: number, maxPixels: number, maxSide = Infinity): Size {
  if (!(width > 0 && height > 0)) return { width: 1, height: 1 };
  const byPixels = Math.sqrt(maxPixels / (width * height));
  const bySide = maxSide / Math.max(width, height);
  const scale = Math.min(1, byPixels, bySide);
  let w = Math.max(1, Math.floor(width * scale));
  let h = Math.max(1, Math.floor(height * scale));
  // Rounding must never take us over the limits.
  while (w * h > maxPixels && (w > 1 || h > 1)) {
    if (w >= h) w--;
    else h--;
  }
  return { width: w, height: h };
}

/** The on-screen working size for a photo. */
export function previewSize(photo: Size, limits: SketchLimits): Size {
  return fitSize(photo.width, photo.height, Math.min(limits.previewPixels, MAX_CANVAS_PIXELS), limits.previewSide);
}

/** Size of a saved Pencil Study: as large as the photo allows, within the limit. */
export function pencilExportSize(photo: Size, limits: SketchLimits): Size {
  return fitSize(photo.width, photo.height, Math.min(limits.pencilExportPixels, MAX_CANVAS_PIXELS));
}

/**
 * Size of a saved Clean Outline PNG. The vector paths scale cleanly, so it is
 * as large as the photo (or the working drawing, if larger), within the
 * limit.
 */
export function outlineExportSize(photo: Size, working: Size, limits: SketchLimits): Size {
  const side = Math.min(limits.outlineExportSide, Math.max(photo.width, photo.height, working.width, working.height));
  const scale = side / Math.max(working.width, working.height);
  const target = { width: Math.round(working.width * scale), height: Math.round(working.height * scale) };
  return fitSize(target.width, target.height, MAX_CANVAS_PIXELS, side);
}
