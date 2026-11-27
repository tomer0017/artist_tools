// Images for Art on Your Wall: the original file is stored as chosen; the tool
// works from a copy of at most WORK_MAX px (safe for phones' canvas limits).

import { ctxOf, makeCanvas } from './render/util';

export const WORK_MAX = 4096;

/** The bytes of a data URL, exactly (no fetch: the page's CSP limits connections). */
export function dataUrlBytes(dataUrl: string): { bytes: ArrayBuffer; type: string } {
  const comma = dataUrl.indexOf(',');
  const header = dataUrl.slice(0, comma);
  const type = /data:([^;,]+)/.exec(header)?.[1] ?? 'application/octet-stream';
  const body = dataUrl.slice(comma + 1);
  const text = header.includes(';base64') ? atob(body) : decodeURIComponent(body);
  const bytes = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) bytes[i] = text.charCodeAt(i) & 0xff;
  return { bytes: bytes.buffer, type };
}

/** Decode a Blob into an image (EXIF orientation applied, as the browser shows it). */
export function loadBlobImage(blob: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('image could not be decoded'));
    };
    img.src = url;
  });
}

/** A copy to work from, at most `max` px on its longest side. */
export function workingCopy(img: HTMLImageElement, max = WORK_MAX): HTMLCanvasElement {
  const w = img.naturalWidth || img.width;
  const h = img.naturalHeight || img.height;
  const scale = Math.min(1, max / Math.max(w, h));
  const canvas = makeCanvas(w * scale, h * scale);
  const ctx = ctxOf(canvas);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas;
}

/** A small JPEG data URL of anything drawable. */
export function thumbOf(source: CanvasImageSource & { width: number; height: number }, max = 240, quality = 0.78): string {
  const scale = Math.min(1, max / Math.max(source.width, source.height));
  const canvas = makeCanvas(source.width * scale, source.height * scale);
  const ctx = ctxOf(canvas);
  ctx.fillStyle = '#18181b';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', quality);
}

export function canvasToBlob(canvas: HTMLCanvasElement, mime: 'image/jpeg' | 'image/png', quality = 0.92): Promise<Blob> {
  return new Promise((resolve, reject) => canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('the image could not be encoded'))), mime, quality));
}
