// ─── Pictures for Learn, prepared in the admin's browser (ADR-0023) ──────────
// A picture is re-saved here before it is uploaded: drawn onto a canvas at
// most 3,200 px on its long side (A4 at 300 dpi) and encoded again, which
// leaves camera details, location and comments behind, then given a 400 px
// thumbnail. Some encoders still write a small metadata block of their own,
// so it is taken out of the bytes before upload. The server checks every file
// again by its bytes (src/server/learn/assets.ts): nothing here is trusted.

export const MAX_SIDE = 3200;
export const THUMB_SIDE = 400;
const MAX_BYTES = 10 * 1024 * 1024;
const MAX_THUMB_BYTES = 256 * 1024;

export interface PreparedImage {
  main: Blob;
  thumbnail: Blob;
  width: number;
  height: number;
  /** A local preview until the upload's thumbnail is served. */
  previewUrl: string;
}

export class ImageError extends Error {}

function load(file: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new ImageError('This picture cannot be read here. iPhone photos (HEIC) open in Safari; on a Mac, export them as JPEG first.'));
    };
    img.src = url;
  });
}

function draw(img: HTMLImageElement, side: number, opaque: boolean): HTMLCanvasElement {
  const scale = Math.min(1, side / Math.max(img.naturalWidth, img.naturalHeight));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
  const context = canvas.getContext('2d')!;
  if (opaque) {
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, canvas.width, canvas.height);
  }
  context.imageSmoothingQuality = 'high';
  context.drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas;
}

const encode = (canvas: HTMLCanvasElement, type: 'image/jpeg' | 'image/png', quality?: number) =>
  new Promise<Blob>((resolve, reject) => canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new ImageError('The picture could not be saved again.'))), type, quality));

/** A JPEG's bytes without metadata segments (EXIF, XMP, IPTC, comments); JFIF, ICC and Adobe are kept, like the server allows. */
export function stripJpeg(bytes: Uint8Array): Uint8Array {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return bytes;
  const parts: Uint8Array[] = [bytes.subarray(0, 2)];
  let i = 2;
  while (i + 4 <= bytes.length && bytes[i] === 0xff) {
    const marker = bytes[i + 1];
    if (marker === 0xda || marker === 0xd9) break;
    const length = (bytes[i + 2] << 8) | bytes[i + 3];
    const end = i + 2 + length;
    if (end > bytes.length) return bytes;
    const id = String.fromCharCode(...bytes.subarray(i + 4, Math.min(end, i + 16)));
    const keep = !(marker >= 0xe0 && marker <= 0xef) && marker !== 0xfe ? true : (marker === 0xe0 && (id.startsWith('JFIF') || id.startsWith('JFXX'))) || (marker === 0xe2 && id.startsWith('ICC_PROFILE')) || (marker === 0xee && id.startsWith('Adobe'));
    if (keep) parts.push(bytes.subarray(i, end));
    i = end;
  }
  parts.push(bytes.subarray(i));
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

/** A PNG's bytes without its text, EXIF and time chunks. */
export function stripPng(bytes: Uint8Array): Uint8Array {
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (!signature.every((b, i) => bytes[i] === b)) return bytes;
  const parts: Uint8Array[] = [bytes.subarray(0, 8)];
  let i = 8;
  while (i + 12 <= bytes.length) {
    const length = ((bytes[i] << 24) >>> 0) + (bytes[i + 1] << 16) + (bytes[i + 2] << 8) + bytes[i + 3];
    const type = String.fromCharCode(...bytes.subarray(i + 4, i + 8));
    const end = i + 12 + length;
    if (end > bytes.length) return bytes;
    if (!['tEXt', 'zTXt', 'iTXt', 'eXIf', 'tIME'].includes(type)) parts.push(bytes.subarray(i, end));
    i = end;
    if (type === 'IEND') break;
  }
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

async function clean(blob: Blob): Promise<Blob> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const stripped = blob.type === 'image/png' ? stripPng(bytes) : stripJpeg(bytes);
  return new Blob([stripped as BlobPart], { type: blob.type });
}

/** Re-save a picture for upload, with its thumbnail. PNGs (diagrams) stay PNG unless too large; photos become JPEG. */
export async function prepareImage(file: File): Promise<PreparedImage> {
  if (!file.type.startsWith('image/') && !/\.(jpe?g|png|webp|heic|heif)$/i.test(file.name)) throw new ImageError('Choose a picture (JPEG, PNG or WebP).');
  const img = await load(file);
  try {
    const png = file.type === 'image/png';
    const canvas = draw(img, MAX_SIDE, !png);
    let main = await clean(await encode(canvas, png ? 'image/png' : 'image/jpeg', png ? undefined : 0.9));
    if (main.size > MAX_BYTES) main = await clean(await encode(draw(img, MAX_SIDE, true), 'image/jpeg', 0.85));
    if (main.size > MAX_BYTES) main = await clean(await encode(draw(img, 2400, true), 'image/jpeg', 0.8));
    if (main.size > MAX_BYTES) throw new ImageError('The picture is too large even after saving it again. Try a smaller one.');
    let thumbnail = await clean(await encode(draw(img, THUMB_SIDE, true), 'image/jpeg', 0.85));
    if (thumbnail.size > MAX_THUMB_BYTES) thumbnail = await clean(await encode(draw(img, THUMB_SIDE, true), 'image/jpeg', 0.6));
    return { main, thumbnail, width: canvas.width, height: canvas.height, previewUrl: URL.createObjectURL(thumbnail) };
  } finally {
    URL.revokeObjectURL(img.src);
  }
}

export type LicenceKind = 'own' | 'commissioned' | 'cc0' | 'public-domain' | 'licensed';

export interface LicenceForm {
  kind: LicenceKind;
  source: string;
  author: string;
  title: string;
  licenceUrl: string;
  rights: string;
  attribution: string;
}

export const OWN_RIGHTS = 'Own work, made for Studio Companion; all rights reserved.';

export const defaultLicence = (title: string): LicenceForm => ({ kind: 'own', source: '', author: 'Studio Companion', title, licenceUrl: '', rights: OWN_RIGHTS, attribution: '' });

/** The licence as the server records it (src/server/learn/assets.ts). */
export function licenceRecord(form: LicenceForm) {
  const blank = (value: string) => (value.trim() ? value.trim() : null);
  return {
    kind: form.kind,
    source: blank(form.source),
    author: form.author.trim() || 'Studio Companion',
    title: form.title.trim().slice(0, 300) || 'Untitled',
    licenceUrl: blank(form.licenceUrl),
    rights: form.rights.trim() || OWN_RIGHTS,
    attribution: blank(form.attribution),
    checkedAt: new Date().toISOString().slice(0, 10),
    modelRelease: 'not-needed',
    notes: null,
  };
}

export interface Uploaded {
  assetId: string;
  thumbnailAssetId: string | null;
  width: number | null;
  height: number | null;
  contentType: string;
}

export class UploadError extends Error {
  constructor(
    message: string,
    readonly issues: string[] = [],
  ) {
    super(message);
  }
}

/** Store a prepared picture (or a PDF sheet) on the server: nothing is published until the form is saved. */
export async function uploadAsset(input: { role: 'reference' | 'worksheet'; main: Blob; thumbnail: Blob | null; licence: LicenceForm; name: string }): Promise<Uploaded> {
  const form = new FormData();
  form.set('role', input.role);
  form.set('file', input.main, input.name);
  if (input.thumbnail) form.set('thumbnail', input.thumbnail, `${input.name}.thumb.jpg`);
  form.set('licence', JSON.stringify(licenceRecord(input.licence)));
  let response: Response;
  try {
    response = await fetch('/api/admin/learn/assets', { method: 'POST', body: form, credentials: 'same-origin' });
  } catch {
    throw new UploadError('The upload did not reach the server. Check the connection and try again.');
  }
  const body = (await response.json().catch(() => null)) as ({ ok: boolean; message?: string; issues?: string[] } & Partial<Uploaded>) | null;
  if (!response.ok || !body?.ok) throw new UploadError(body?.message ?? `The upload failed (${response.status}).`, body?.issues ?? []);
  return { assetId: body.assetId!, thumbnailAssetId: body.thumbnailAssetId ?? null, width: body.width ?? null, height: body.height ?? null, contentType: body.contentType ?? 'image/jpeg' };
}
