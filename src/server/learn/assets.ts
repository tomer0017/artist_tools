import 'server-only';
import { createHash, randomBytes } from 'node:crypto';
import { open, readFile, rename, stat, unlink } from 'node:fs/promises';
import path from 'node:path';
import type { Db } from 'mongodb';
import { z } from 'zod';
import { ASSET_ID } from '@/lib/learn/model';
import { recordAudit } from '@/server/audit';
import { collections, isDuplicateKeyError, type AssetLicence, type LearnAssetDoc, type LearnAssetType } from '@/server/db/collections';

// ─── Learn assets: reference images, thumbnails, static worksheets ────────────
// Files in the asset directory (LEARN_ASSETS_DIR), named `<sha256>.<ext>`:
// outside every release and outside `public/`, so a deployment or a rollback
// never touches them and only the authorized route serves them
// (src/app/api/learn/assets/[id]/route.ts). Their metadata, licence included,
// is in `learn_assets`. Files are immutable: a changed image is a new file,
// and old ones stay, so every earlier content version keeps working.
//
// What is stored is checked by its bytes, not by what anyone says it is: the
// type from its first bytes, its size and dimensions, and no embedded
// metadata (camera details, location, comments), which the uploader's
// re-encoding removes. No image is decoded here, so the server needs no
// image library.

export const MAX_ASSET_BYTES = 10 * 1024 * 1024;
/** 3,200 px on the long side covers A4 at 300 dpi inside the margins. */
export const MAX_REFERENCE_SIDE = 3200;
export const MAX_THUMBNAIL_SIDE = 400;
export const MAX_THUMBNAIL_BYTES = 256 * 1024;

export const EXTENSIONS: Record<LearnAssetType, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'application/pdf': 'pdf' };

const ascii = (bytes: Uint8Array, start: number, length: number) => String.fromCharCode(...bytes.subarray(start, start + length));

/** The type from the file's first bytes, or null. */
export function sniffType(bytes: Uint8Array): LearnAssetType | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes.length >= 8 && [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((b, i) => bytes[i] === b)) return 'image/png';
  if (bytes.length >= 12 && ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 4) === 'WEBP') return 'image/webp';
  if (bytes.length >= 5 && ascii(bytes, 0, 5) === '%PDF-') return 'application/pdf';
  return null;
}

const u16be = (b: Uint8Array, i: number) => (b[i] << 8) | b[i + 1];
const u32be = (b: Uint8Array, i: number) => ((b[i] << 24) >>> 0) + (b[i + 1] << 16) + (b[i + 2] << 8) + b[i + 3];
const u24le = (b: Uint8Array, i: number) => b[i] | (b[i + 1] << 8) | (b[i + 2] << 16);

interface Scan {
  width: number | null;
  height: number | null;
  /** Embedded metadata found, by name. */
  metadata: string[];
  /** Why the file cannot be read as its type, if it cannot. */
  broken: string | null;
}

/** JPEG: dimensions from the frame header; any segment but JFIF, ICC and Adobe before the image data counts as metadata. */
function scanJpeg(b: Uint8Array): Scan {
  const scan: Scan = { width: null, height: null, metadata: [], broken: null };
  let i = 2;
  while (i + 4 <= b.length) {
    if (b[i] !== 0xff) return { ...scan, broken: 'a JPEG segment is malformed' };
    const marker = b[i + 1];
    if (marker === 0xff) {
      i += 1;
      continue;
    }
    if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
      i += 2;
      continue;
    }
    if (marker === 0xd9 || marker === 0xda) break; // end of image, or the image data starts
    const length = u16be(b, i + 2);
    if (length < 2 || i + 2 + length > b.length) return { ...scan, broken: 'a JPEG segment runs past the end of the file' };
    const isFrame = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isFrame && length >= 7) {
      scan.height = u16be(b, i + 5);
      scan.width = u16be(b, i + 7);
    } else if (marker >= 0xe0 && marker <= 0xef) {
      const id = ascii(b, i + 4, Math.min(12, length - 2));
      const allowed = (marker === 0xe0 && (id.startsWith('JFIF') || id.startsWith('JFXX'))) || (marker === 0xe2 && id.startsWith('ICC_PROFILE')) || (marker === 0xee && id.startsWith('Adobe'));
      if (!allowed) scan.metadata.push(marker === 0xe1 ? (id.startsWith('Exif') ? 'EXIF' : 'XMP') : marker === 0xed ? 'IPTC' : `APP${marker - 0xe0}`);
    } else if (marker === 0xfe) {
      scan.metadata.push('a comment');
    }
    i += 2 + length;
  }
  if (scan.width === null) return { ...scan, broken: 'the JPEG has no frame header' };
  return scan;
}

/** PNG: dimensions from IHDR; text, EXIF and time chunks count as metadata. */
function scanPng(b: Uint8Array): Scan {
  const scan: Scan = { width: null, height: null, metadata: [], broken: null };
  let i = 8;
  while (i + 12 <= b.length) {
    const length = u32be(b, i);
    const type = ascii(b, i + 4, 4);
    if (i + 12 + length > b.length) return { ...scan, broken: 'a PNG chunk runs past the end of the file' };
    if (type === 'IHDR') {
      scan.width = u32be(b, i + 8);
      scan.height = u32be(b, i + 12);
    } else if (['eXIf', 'tEXt', 'zTXt', 'iTXt', 'tIME'].includes(type)) {
      scan.metadata.push(type);
    }
    if (type === 'IEND') break;
    i += 12 + length;
  }
  if (scan.width === null) return { ...scan, broken: 'the PNG has no header chunk' };
  return scan;
}

/** WebP: dimensions from the VP8, VP8L or VP8X chunk; EXIF and XMP chunks count as metadata. */
function scanWebp(b: Uint8Array): Scan {
  const scan: Scan = { width: null, height: null, metadata: [], broken: null };
  let i = 12;
  while (i + 8 <= b.length) {
    const type = ascii(b, i, 4);
    const length = b[i + 4] | (b[i + 5] << 8) | (b[i + 6] << 16) | (b[i + 7] << 24);
    const data = i + 8;
    if (length < 0 || data + length > b.length) return { ...scan, broken: 'a WebP chunk runs past the end of the file' };
    if (type === 'VP8X' && length >= 10) {
      scan.width = u24le(b, data + 4) + 1;
      scan.height = u24le(b, data + 7) + 1;
    } else if (type === 'VP8 ' && length >= 10 && scan.width === null) {
      if (b[data + 3] !== 0x9d || b[data + 4] !== 0x01 || b[data + 5] !== 0x2a) return { ...scan, broken: 'the WebP frame is malformed' };
      scan.width = (b[data + 6] | (b[data + 7] << 8)) & 0x3fff;
      scan.height = (b[data + 8] | (b[data + 9] << 8)) & 0x3fff;
    } else if (type === 'VP8L' && length >= 5 && scan.width === null) {
      if (b[data] !== 0x2f) return { ...scan, broken: 'the WebP frame is malformed' };
      const bits = b[data + 1] | (b[data + 2] << 8) | (b[data + 3] << 16) | (b[data + 4] << 24);
      scan.width = (bits & 0x3fff) + 1;
      scan.height = ((bits >>> 14) & 0x3fff) + 1;
    } else if (type === 'EXIF' || type === 'XMP ') {
      scan.metadata.push(type.trim());
    }
    i = data + length + (length % 2);
  }
  if (scan.width === null) return { ...scan, broken: 'the WebP has no image frame' };
  return scan;
}

export function scanAsset(bytes: Uint8Array, type: LearnAssetType): Scan {
  if (type === 'image/jpeg') return scanJpeg(bytes);
  if (type === 'image/png') return scanPng(bytes);
  if (type === 'image/webp') return scanWebp(bytes);
  return { width: null, height: null, metadata: [], broken: null };
}

export const LicenceSchema = z
  .object({
    kind: z.enum(['own', 'commissioned', 'cc0', 'public-domain', 'licensed']),
    // The page of the original. Own and commissioned work (a diagram drawn for
    // Studio Companion, ADR-0019) may have none; every other kind needs it.
    source: z.string().url().max(500).refine((url) => url.startsWith('https://'), 'must be an https address').nullable(),
    author: z.string().trim().min(1).max(200),
    title: z.string().trim().min(1).max(300),
    // Shown as links in Admin → Learn: only https, never another scheme (javascript:, data:).
    licenceUrl: z.string().url().max(500).refine((url) => url.startsWith('https://'), 'must be an https address').nullable(),
    rights: z.string().trim().min(10, 'must say what the source states about the rights, and where').max(2000),
    attribution: z.string().trim().max(500).nullable(),
    checkedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'must be a date, YYYY-MM-DD'),
    modelRelease: z.enum(['yes', 'not-needed']),
    notes: z.string().max(2000).nullable(),
  })
  .strict()
  .superRefine((licence, ctx) => {
    if ((licence.kind === 'cc0' || licence.kind === 'licensed') && !licence.licenceUrl) ctx.addIssue({ code: 'custom', path: ['licenceUrl'], message: 'is required for this licence' });
    if (licence.kind !== 'own' && licence.kind !== 'commissioned' && !licence.source) ctx.addIssue({ code: 'custom', path: ['source'], message: 'is required for this licence' });
  });

/** What is missing from an asset's licence before an item using it can be published (empty: complete). */
export function licenceIssues(licence: unknown): string[] {
  const parsed = LicenceSchema.safeParse(licence);
  return parsed.success ? [] : parsed.error.issues.map((i) => `licence.${i.path.join('.')}: ${i.message}`);
}

/** The file of an asset in `dir`. The ID must be a SHA-256 in hex: no path is ever built from anything else. */
export function assetPath(dir: string, id: string, type: LearnAssetType): string {
  if (!ASSET_ID.test(id)) throw new Error('not an asset id');
  return path.join(dir, `${id}.${EXTENSIONS[type]}`);
}

export const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

/** Whether an asset's file is there with exactly its bytes. */
export async function checkAssetFile(dir: string, doc: Pick<LearnAssetDoc, '_id' | 'contentType' | 'bytes'>): Promise<'ok' | 'missing' | 'changed'> {
  const file = assetPath(dir, doc._id, doc.contentType);
  try {
    const info = await stat(file);
    if (info.size !== doc.bytes) return 'changed';
    return sha256(await readFile(file)) === doc._id ? 'ok' : 'changed';
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return 'missing';
    throw error;
  }
}

/** Whether an asset's file is there with its recorded size (a quick check for files already verified by their bytes). */
export async function checkAssetSize(dir: string, doc: Pick<LearnAssetDoc, '_id' | 'contentType' | 'bytes'>): Promise<'ok' | 'missing' | 'changed'> {
  try {
    return (await stat(assetPath(dir, doc._id, doc.contentType))).size === doc.bytes ? 'ok' : 'changed';
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return 'missing';
    throw error;
  }
}

/** Write a file so that a partial one never exists under its name: a temporary file, flushed, then renamed. */
async function writeOnce(dir: string, id: string, type: LearnAssetType, bytes: Uint8Array): Promise<void> {
  const target = assetPath(dir, id, type);
  try {
    if ((await checkAssetFile(dir, { _id: id, contentType: type, bytes: bytes.length })) === 'ok') return;
  } catch {
    // Not readable: written again below.
  }
  const temporary = path.join(dir, `.${id}.${randomBytes(6).toString('hex')}.tmp`);
  const handle = await open(temporary, 'wx', 0o640);
  try {
    await handle.writeFile(bytes);
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    await rename(temporary, target);
  } catch (error) {
    await unlink(temporary).catch(() => undefined);
    throw error;
  }
}

interface Checked {
  id: string;
  type: LearnAssetType;
  bytes: Uint8Array;
  width: number | null;
  height: number | null;
}

/** Check one file for its role; the reasons it cannot be stored, or what it is. */
export function checkAssetBytes(bytes: Uint8Array, role: LearnAssetDoc['role']): { ok: Checked } | { issues: string[] } {
  const type = sniffType(bytes);
  if (!type) return { issues: ['is not a JPEG, PNG, WebP or PDF file'] };
  const issues: string[] = [];
  if (role === 'worksheet' ? type !== 'application/pdf' : type === 'application/pdf') issues.push(role === 'worksheet' ? 'a static worksheet must be a PDF' : 'an image must be a JPEG, PNG or WebP');
  const limit = role === 'thumbnail' ? MAX_THUMBNAIL_BYTES : MAX_ASSET_BYTES;
  if (bytes.length > limit) issues.push(`is ${bytes.length} bytes; at most ${limit}`);
  const scan = scanAsset(bytes, type);
  if (scan.broken) issues.push(scan.broken);
  if (scan.metadata.length > 0) issues.push(`has embedded metadata (${scan.metadata.join(', ')}): re-encode it first, which removes camera details and location`);
  const side = role === 'thumbnail' ? MAX_THUMBNAIL_SIDE : MAX_REFERENCE_SIDE;
  if (scan.width !== null && scan.height !== null) {
    if (scan.width < 1 || scan.height < 1) issues.push('has no pixels');
    if (Math.max(scan.width, scan.height) > side) issues.push(`is ${scan.width} × ${scan.height} px; at most ${side} px on the long side`);
  }
  if (issues.length > 0) return { issues };
  return { ok: { id: sha256(bytes), type, bytes, width: scan.width, height: scan.height } };
}

export type StoreResult = { status: 'stored' | 'exists'; asset: LearnAssetDoc; thumbnail: LearnAssetDoc | null } | { status: 'invalid'; issues: string[] };

/**
 * Store a reference image (with its thumbnail) or a static worksheet: both
 * files checked by their bytes, the licence complete, the files written
 * atomically, then the metadata recorded and the addition audited. An asset
 * that already exists (the same bytes) is kept exactly as it was: files and
 * their metadata are never changed.
 */
export async function storeAsset(
  db: Db,
  dir: string,
  input: { role: 'reference' | 'worksheet'; bytes: Uint8Array; thumbnail: Uint8Array | null; licence: unknown; actor: string },
  now = new Date(),
): Promise<StoreResult> {
  const issues: string[] = [];
  const main = checkAssetBytes(input.bytes, input.role);
  if ('issues' in main) issues.push(...main.issues.map((i) => `the file ${i}`));
  const thumb = input.thumbnail ? checkAssetBytes(input.thumbnail, 'thumbnail') : null;
  if (input.role === 'reference' && !input.thumbnail) issues.push('a reference image needs its thumbnail');
  if (thumb && 'issues' in thumb) issues.push(...thumb.issues.map((i) => `the thumbnail ${i}`));
  if (thumb && 'ok' in thumb && thumb.ok.type === 'application/pdf') issues.push('the thumbnail must be an image');
  issues.push(...licenceIssues(input.licence));
  if (issues.length > 0 || !('ok' in main)) return { status: 'invalid', issues };

  const { learnAssets } = collections(db);
  const existing = await learnAssets.findOne({ _id: main.ok.id });
  if (existing) {
    return { status: 'exists', asset: existing, thumbnail: existing.thumbnailAssetId ? await learnAssets.findOne({ _id: existing.thumbnailAssetId }) : null };
  }
  const licence = LicenceSchema.parse(input.licence) as AssetLicence;
  const thumbOk = thumb && 'ok' in thumb ? thumb.ok : null;
  if (thumbOk) await writeOnce(dir, thumbOk.id, thumbOk.type, thumbOk.bytes);
  await writeOnce(dir, main.ok.id, main.ok.type, main.ok.bytes);

  let thumbnailDoc: LearnAssetDoc | null = null;
  if (thumbOk) {
    thumbnailDoc = { _id: thumbOk.id, role: 'thumbnail', contentType: thumbOk.type, bytes: thumbOk.bytes.length, width: thumbOk.width, height: thumbOk.height, of: main.ok.id, thumbnailAssetId: null, licence: null, uploadedBy: input.actor, uploadedAt: now };
    try {
      await learnAssets.insertOne(thumbnailDoc);
    } catch (error) {
      if (!isDuplicateKeyError(error)) throw error;
      thumbnailDoc = await learnAssets.findOne({ _id: thumbOk.id });
    }
  }
  const asset: LearnAssetDoc = {
    _id: main.ok.id,
    role: input.role,
    contentType: main.ok.type,
    bytes: main.ok.bytes.length,
    width: main.ok.width,
    height: main.ok.height,
    of: null,
    thumbnailAssetId: thumbnailDoc?._id ?? null,
    licence,
    uploadedBy: input.actor,
    uploadedAt: now,
  };
  try {
    await learnAssets.insertOne(asset);
  } catch (error) {
    if (!isDuplicateKeyError(error)) throw error;
    const raced = (await learnAssets.findOne({ _id: main.ok.id }))!;
    return { status: 'exists', asset: raced, thumbnail: thumbnailDoc };
  }
  await recordAudit(db, { type: 'admin.learn_asset_added', userId: null, actor: input.actor, metadata: { assetId: asset._id, role: asset.role, bytes: asset.bytes, licence: licence.kind } });
  return { status: 'stored', asset, thumbnail: thumbnailDoc };
}
