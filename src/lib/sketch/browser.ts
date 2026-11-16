/**
 * The page-side helpers of the sketch engine: starting the worker, reading a
 * photo's pixels at a working size, and turning results into PNG files.
 */

import { isIOS, isTouchDevice } from '@/lib/saveMedia';
import type { WorkerLike } from './client';
import { DESKTOP_LIMITS, MOBILE_LIMITS, type SketchLimits, type Size } from './sizing';
import type { PathLayer } from './vector';

export function spawnSketchWorker(): WorkerLike {
  // This exact form (a literal URL relative to import.meta.url) is what the
  // bundler recognises and builds into a separate worker script.
  const worker = new Worker(new URL('./sketch.worker.ts', import.meta.url), { type: 'module' });
  return worker as unknown as WorkerLike;
}

/** Phones and tablets get the smaller limits (and the compact engine). */
export function isConstrainedDevice(): boolean {
  if (typeof navigator === 'undefined') return false;
  const memory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
  return isIOS() || /Android/i.test(navigator.userAgent) || (typeof memory === 'number' && memory <= 4) || isTouchDevice();
}

export function sketchLimits(): SketchLimits {
  return isConstrainedDevice() ? MOBILE_LIMITS : DESKTOP_LIMITS;
}

export async function decodeImage(src: string): Promise<HTMLImageElement> {
  const img = new Image();
  img.decoding = 'async';
  const loaded = new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error('The photo could not be read'));
  });
  img.src = src;
  try {
    await img.decode();
  } catch {
    await loaded;
  }
  if (!img.naturalWidth || !img.naturalHeight) throw new Error('The photo could not be read');
  return img;
}

function canvas(width: number, height: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = width;
  c.height = height;
  return c;
}

/** Shrink a canvas to nothing, so its backing memory is released now rather than whenever. */
function free(c: HTMLCanvasElement | null): void {
  if (!c) return;
  c.width = 0;
  c.height = 0;
}

/**
 * The photo's RGBA pixels at `size`. Large reductions are done in halving
 * steps (each averages 2×2 pixels), because one big bilinear step skips
 * pixels and turns hair and fabric into moiré before the engine sees them.
 */
export function readPixels(img: HTMLImageElement, size: Size): Uint8ClampedArray {
  let source: CanvasImageSource = img;
  let srcW = img.naturalWidth;
  let srcH = img.naturalHeight;
  let step: HTMLCanvasElement | null = null;
  while (srcW / size.width > 2 && srcH / size.height > 2) {
    const w = Math.max(size.width, Math.round(srcW / 2));
    const h = Math.max(size.height, Math.round(srcH / 2));
    const next = canvas(w, h);
    const ctx = next.getContext('2d');
    if (!ctx) break;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(source, 0, 0, w, h);
    free(step);
    step = next;
    source = next;
    srcW = w;
    srcH = h;
  }
  const out = canvas(size.width, size.height);
  const ctx = out.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('No 2D canvas');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, 0, 0, size.width, size.height);
  const pixels = ctx.getImageData(0, 0, size.width, size.height).data;
  free(step);
  free(out);
  return pixels;
}

function toPng(c: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    c.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('The image could not be encoded'))), 'image/png');
  });
}

/** PNG of RGBA pixels (for a worker that could not encode one itself). */
export async function encodePng(pixels: Uint8ClampedArray, width: number, height: number): Promise<Blob> {
  const c = canvas(width, height);
  try {
    const ctx = c.getContext('2d');
    if (!ctx) throw new Error('No 2D canvas');
    ctx.putImageData(new ImageData(pixels as Uint8ClampedArray<ArrayBuffer>, width, height), 0, 0);
    return await toPng(c);
  } finally {
    free(c);
  }
}

/**
 * Clean Outline as a PNG of `out` size, drawn from its vector paths, so a
 * large file is as sharp as the SVG rather than an enlarged screen image.
 */
export async function pathsToPng(layers: PathLayer[], working: Size, out: Size): Promise<Blob> {
  const c = canvas(out.width, out.height);
  try {
    const ctx = c.getContext('2d');
    if (!ctx) throw new Error('No 2D canvas');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, out.width, out.height);
    ctx.setTransform(out.width / working.width, 0, 0, out.height / working.height, 0, 0);
    for (const layer of layers) {
      if (!layer.loops) continue;
      ctx.fillStyle = layer.fill;
      ctx.fill(new Path2D(layer.d), 'evenodd');
    }
    return await toPng(c);
  } finally {
    free(c);
  }
}
