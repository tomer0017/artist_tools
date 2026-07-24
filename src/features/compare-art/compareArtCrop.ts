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

// ─── Crop preset registry (single source of truth) ──────────────────────────
// Adding a painter format is a one-line entry here — the crop UI, aspect
// constraint, persistence and rendering all read from this list, so nothing
// else needs to change. `aspect` is width/height; `'original'` means the
// image's own ratio; `null` means a free/unconstrained frame. `shape: 'circle'`
// masks to an ellipse. This is deliberately extensible for future formats
// (A2/A1, square/round canvas, 50×70, 60×90, 70×100 cm, …).
export interface CropPresetDef {
  id: CropPreset;
  label: string;
  aspect: number | 'original' | null;
  shape?: 'circle';
}

// ISO A-series share one ratio (1 : √2). Painters usually work portrait, so the
// paper presets constrain to portrait; a landscape reference still pans/zooms
// freely inside the frame.
const A_SERIES_PORTRAIT = 1 / Math.SQRT2; // ≈ 0.7071 (w/h)

export const CROP_PRESETS: CropPresetDef[] = [
  { id: 'free', label: 'Free', aspect: null },
  { id: 'square', label: 'Square', aspect: 1 },
  { id: 'circle', label: 'Circle', aspect: 1, shape: 'circle' },
  { id: '4:3', label: '4:3', aspect: 4 / 3 },
  { id: '3:4', label: '3:4', aspect: 3 / 4 },
  { id: '16:9', label: '16:9', aspect: 16 / 9 },
  { id: 'original', label: 'Original', aspect: 'original' },
  // Painter paper formats (portrait, ISO A ratio).
  { id: 'a5', label: 'A5', aspect: A_SERIES_PORTRAIT },
  { id: 'a4', label: 'A4', aspect: A_SERIES_PORTRAIT },
  { id: 'a3', label: 'A3', aspect: A_SERIES_PORTRAIT },
];

const PRESET_BY_ID = new Map(CROP_PRESETS.map((p) => [p.id, p]));

/** Aspect ratio (w/h) for a preset, or null for a free/custom crop. */
export function presetAspect(preset: CropPreset, imgW: number, imgH: number): number | null {
  const def = PRESET_BY_ID.get(preset);
  if (!def) return null;
  if (def.aspect === 'original') return imgW && imgH ? imgW / imgH : 1;
  return def.aspect;
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
