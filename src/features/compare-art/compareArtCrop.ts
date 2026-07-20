// Compare Art — crop rendering (produces the cropped image the engine consumes).
//
// The crop screen manipulates a normalised rect over the ORIGINAL image; this
// module turns that rect (plus an optional circular mask) into a concrete
// cropped bitmap. Because the result is stored as `session.artwork` /
// `session.reference`, the whole comparison pipeline (overlay, blink, split,
// difference, grid, GIF export) automatically operates on the crop with no
// renderer changes — a circular crop's transparent corners are treated as
// no-data by the difference engine.

import { CROP_OUTPUT_MAX_DIM, CropPreset, ImageCrop } from './compareArtTypes';

/** Aspect ratio (w/h) for a preset, or null for a free/custom crop. */
export function presetAspect(preset: CropPreset, imgW: number, imgH: number): number | null {
  switch (preset) {
    case 'square':
    case 'circle':
      return 1;
    case '4:3':
      return 4 / 3;
    case '3:4':
      return 3 / 4;
    case '16:9':
      return 16 / 9;
    case 'original':
      return imgW && imgH ? imgW / imgH : 1;
    case 'free':
    default:
      return null;
  }
}

function clamp01(v: number) {
  return Math.max(0, Math.min(1, v));
}

/** Sanitise a normalised crop rect so it stays inside the image. */
export function sanitizeImageCrop(crop: ImageCrop): ImageCrop {
  const x = clamp01(crop.rect.x);
  const y = clamp01(crop.rect.y);
  const w = Math.min(Math.max(crop.rect.w, 0.02), 1 - x);
  const h = Math.min(Math.max(crop.rect.h, 0.02), 1 - y);
  return { ...crop, rect: { x, y, w, h } };
}

export interface CroppedResult {
  dataUrl: string;
  width: number;
  height: number;
}

/**
 * Render the crop region of `img` to a size-capped canvas and return a data URL.
 * Circular crops are exported as PNG (transparent corners); rectangular crops as
 * high-quality JPEG (smaller). Never throws — returns the source-sized fallback
 * on failure.
 */
export function renderCrop(
  img: CanvasImageSource,
  naturalW: number,
  naturalH: number,
  crop: ImageCrop,
): CroppedResult {
  const c = sanitizeImageCrop(crop);
  const sx = c.rect.x * naturalW;
  const sy = c.rect.y * naturalH;
  const sw = Math.max(1, c.rect.w * naturalW);
  const sh = Math.max(1, c.rect.h * naturalH);

  const longest = Math.max(sw, sh);
  const k = longest > CROP_OUTPUT_MAX_DIM ? CROP_OUTPUT_MAX_DIM / longest : 1;
  const outW = Math.max(1, Math.round(sw * k));
  const outH = Math.max(1, Math.round(sh * k));

  const canvas = document.createElement('canvas');
  canvas.width = outW;
  canvas.height = outH;
  const ctx = canvas.getContext('2d');
  if (!ctx) return { dataUrl: '', width: outW, height: outH };
  ctx.imageSmoothingQuality = 'high';

  if (c.shape === 'circle') {
    ctx.save();
    ctx.beginPath();
    ctx.ellipse(outW / 2, outH / 2, outW / 2, outH / 2, 0, 0, Math.PI * 2);
    ctx.clip();
    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, outW, outH);
    ctx.restore();
    return { dataUrl: canvas.toDataURL('image/png'), width: outW, height: outH };
  }

  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, outW, outH);
  return { dataUrl: canvas.toDataURL('image/jpeg', 0.92), width: outW, height: outH };
}

/** Decode a data URL into an HTMLImageElement (EXIF handled by the browser). */
export function decodeImageElement(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const el = new Image();
    el.onload = () => resolve(el);
    el.onerror = () => reject(new Error('Failed to decode image for cropping'));
    el.src = dataUrl;
  });
}
