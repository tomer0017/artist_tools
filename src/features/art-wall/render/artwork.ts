// The artwork as framed: the original image, rotated and cropped. The
// original file is never changed; this is redrawn from it whenever the crop
// changes, at most `maxPx` on its longest side.

import type { CropSpec } from '../types';
import { ctxOf, makeCanvas } from './util';

/** The rotated image's bounding box, px. */
export function rotatedSize(w: number, h: number, degrees: number): { w: number; h: number } {
  const a = (degrees * Math.PI) / 180;
  const c = Math.abs(Math.cos(a));
  const s = Math.abs(Math.sin(a));
  return { w: w * c + h * s, h: w * s + h * c };
}

/** The crop box in the rotated image, px. */
export function cropPixels(w: number, h: number, crop: CropSpec): { x: number; y: number; w: number; h: number } {
  const r = rotatedSize(w, h, crop.rotation);
  return { x: crop.x * r.w, y: crop.y * r.h, w: Math.max(1, crop.w * r.w), h: Math.max(1, crop.h * r.h) };
}

/** Width ÷ height of the cropped artwork. */
export function cropRatio(w: number, h: number, crop: CropSpec): number {
  const box = cropPixels(w, h, crop);
  return box.w / box.h;
}

export function cropArtwork(image: CanvasImageSource & { width: number; height: number }, crop: CropSpec, maxPx = 2800): HTMLCanvasElement {
  const box = cropPixels(image.width, image.height, crop);
  const scale = Math.min(1, maxPx / Math.max(box.w, box.h));
  const out = makeCanvas(box.w * scale, box.h * scale);
  const ctx = ctxOf(out);
  // White behind any corner a rotation leaves empty (paper, not a hole).
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, out.width, out.height);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  const r = rotatedSize(image.width, image.height, crop.rotation);
  ctx.scale(scale, scale);
  ctx.translate(-box.x, -box.y);
  ctx.translate(r.w / 2, r.h / 2);
  ctx.rotate((crop.rotation * Math.PI) / 180);
  ctx.drawImage(image, -image.width / 2, -image.height / 2);
  return out;
}

/** A crop box that keeps a ratio (in the rotated image's pixels), as large as fits, centred on the old one. */
export function fitCrop(w: number, h: number, crop: CropSpec, ratio: number | null): CropSpec {
  if (!ratio) return crop;
  const r = rotatedSize(w, h, crop.rotation);
  const cx = (crop.x + crop.w / 2) * r.w;
  const cy = (crop.y + crop.h / 2) * r.h;
  let bw = r.w;
  let bh = bw / ratio;
  if (bh > r.h) {
    bh = r.h;
    bw = bh * ratio;
  }
  // Keep the old size where possible (a smaller box stays smaller).
  const old = Math.sqrt(crop.w * r.w * crop.h * r.h);
  const want = Math.min(1, old / Math.sqrt(bw * bh));
  if (want < 0.999) {
    bw *= want;
    bh *= want;
  }
  const x = Math.min(Math.max(0, cx - bw / 2), r.w - bw);
  const y = Math.min(Math.max(0, cy - bh / 2), r.h - bh);
  return { ...crop, x: x / r.w, y: y / r.h, w: bw / r.w, h: bh / r.h };
}
