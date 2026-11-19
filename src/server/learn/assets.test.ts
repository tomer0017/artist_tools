// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Db } from 'mongodb';
import { MONGO_STARTUP_TIMEOUT, startTestMongo, type TestMongo } from '@/test/mongo';
import { makePng } from '@/test/png';
import { FIXTURE_LICENCE } from '@/test/learn-fixture';
import { collections } from '@/server/db/collections';
import { migrate } from '@/server/db/migrate';
import { assetPath, checkAssetBytes, checkAssetFile, licenceIssues, scanAsset, sha256, sniffType, storeAsset } from './assets';

// Learn assets are checked by their bytes (ADR-0017): the type from the first
// bytes, the size and dimensions, and no embedded metadata; stored once under
// their SHA-256, written atomically, never changed.

const bytes = (...parts: (number[] | string)[]) => new Uint8Array(parts.flatMap((p) => (typeof p === 'string' ? [...p].map((c) => c.charCodeAt(0)) : p)));
const u16 = (n: number) => [(n >> 8) & 0xff, n & 0xff];
const segment = (marker: number, payload: (number[] | string)[]) => {
  const body = bytes(...payload);
  return [0xff, marker, ...u16(body.length + 2), ...body];
};
/** A JPEG's structure up to the image data: SOI, the given segments, a frame header, SOS. */
const jpeg = (width: number, height: number, segments: number[][] = []) =>
  new Uint8Array([0xff, 0xd8, ...segment(0xe0, ['JFIF', [0, 1, 1, 0, 0, 1, 0, 1, 0, 0]]), ...segments.flat(), ...segment(0xc0, [[8, ...u16(height), ...u16(width), 1, 1, 0x11, 0]]), 0xff, 0xda, 0, 8, 1, 1, 0, 0, 0x3f, 0, 0x12, 0x34, 0xff, 0xd9]);
const le32 = (n: number) => [n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >> 24) & 0xff];
const webpLossless = (width: number, height: number, extra: number[] = []) => {
  const bits = (width - 1) | ((height - 1) << 14);
  const vp8l = [...bytes('VP8L'), ...le32(5), 0x2f, ...le32(bits), 0];
  const body = [...bytes('WEBP'), ...vp8l, ...extra];
  return new Uint8Array([...bytes('RIFF'), ...le32(body.length), ...body]);
};

describe('checking a file by its bytes', () => {
  it('knows JPEG, PNG, WebP and PDF from their first bytes, and nothing else', () => {
    expect(sniffType(jpeg(10, 10))).toBe('image/jpeg');
    expect(sniffType(makePng(2, 2, () => [0, 0, 0]))).toBe('image/png');
    expect(sniffType(webpLossless(4, 3))).toBe('image/webp');
    expect(sniffType(bytes('%PDF-1.7\n'))).toBe('application/pdf');
    expect(sniffType(bytes('<svg xmlns="http://www.w3.org/2000/svg"/>'))).toBeNull();
    expect(sniffType(bytes('GIF89a'))).toBeNull();
  });

  it('reads dimensions without decoding, and finds embedded metadata', () => {
    expect(scanAsset(jpeg(640, 480), 'image/jpeg')).toMatchObject({ width: 640, height: 480, metadata: [], broken: null });
    expect(scanAsset(jpeg(640, 480, [segment(0xe1, ['Exif', [0, 0, 1, 2, 3]]), segment(0xfe, ['taken at home'])]), 'image/jpeg').metadata).toEqual(['EXIF', 'a comment']);
    expect(scanAsset(jpeg(64, 64, [segment(0xe1, ['http://ns.adobe.com/xap/1.0/', [0]]), segment(0xed, ['Photoshop 3.0'])]), 'image/jpeg').metadata).toEqual(['XMP', 'IPTC']);
    expect(scanAsset(jpeg(64, 64, [segment(0xe2, ['ICC_PROFILE', [0]])]), 'image/jpeg').metadata).toEqual([]);
    expect(scanAsset(makePng(30, 20, () => [1, 2, 3]), 'image/png')).toMatchObject({ width: 30, height: 20, metadata: [] });
    expect(scanAsset(makePng(3, 2, () => [1, 2, 3], [{ type: 'tEXt', data: bytes('Comment\0hello') }]), 'image/png').metadata).toEqual(['tEXt']);
    expect(scanAsset(webpLossless(321, 123), 'image/webp')).toMatchObject({ width: 321, height: 123, metadata: [] });
    expect(scanAsset(webpLossless(8, 8, [...bytes('EXIF'), ...le32(2), 1, 2]), 'image/webp').metadata).toEqual(['EXIF']);
    expect(scanAsset(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00]), 'image/jpeg').broken).not.toBeNull();
  });

  it('limits size, dimensions and roles', () => {
    expect('ok' in checkAssetBytes(makePng(3200, 4, () => [0, 0, 0]), 'reference')).toBe(true);
    expect(checkAssetBytes(makePng(3201, 4, () => [0, 0, 0]), 'reference')).toEqual({ issues: ['is 3201 × 4 px; at most 3200 px on the long side'] });
    expect(checkAssetBytes(makePng(401, 4, () => [0, 0, 0]), 'thumbnail')).toEqual({ issues: ['is 401 × 4 px; at most 400 px on the long side'] });
    expect(checkAssetBytes(bytes('%PDF-1.7\n'), 'reference')).toEqual({ issues: ['an image must be a JPEG, PNG or WebP'] });
    expect(checkAssetBytes(makePng(4, 4, () => [0, 0, 0]), 'worksheet')).toEqual({ issues: ['a static worksheet must be a PDF'] });
    expect(checkAssetBytes(jpeg(10, 10, [segment(0xe1, ['Exif', [0, 0]])]), 'reference')).toEqual({ issues: ['has embedded metadata (EXIF): re-encode it first, which removes camera details and location'] });
  });

  it('builds a file path only from a SHA-256', () => {
    const id = 'a'.repeat(64);
    expect(assetPath('/srv/assets', id, 'image/png')).toBe(`/srv/assets/${id}.png`);
    for (const bad of ['../../etc/passwd', 'A'.repeat(64), `${'a'.repeat(63)}/`, '', `${'a'.repeat(64)}.png`]) expect(() => assetPath('/srv/assets', bad, 'image/png')).toThrow();
  });

  it('needs a complete licence', () => {
    expect(licenceIssues(FIXTURE_LICENCE)).toEqual([]);
    expect(licenceIssues({ ...FIXTURE_LICENCE, kind: 'cc0' })).toEqual(['licence.licenceUrl: is required for this licence']);
    expect(licenceIssues({ ...FIXTURE_LICENCE, source: 'http://example.test/x' })).toEqual(['licence.source: must be an https address']);
    // Licence links are shown to admins: never a script or data URL.
    expect(licenceIssues({ ...FIXTURE_LICENCE, kind: 'cc0', licenceUrl: 'javascript:alert(1)' })).toEqual(['licence.licenceUrl: must be an https address']);
    expect(licenceIssues({ ...FIXTURE_LICENCE, source: 'javascript:alert(1)' })).toEqual(['licence.source: must be an https address']);
    expect(licenceIssues({ ...FIXTURE_LICENCE, rights: '' }).length).toBe(1);
    expect(licenceIssues(null).length).toBeGreaterThan(0);
  });
});

describe('storing an asset', () => {
  let mongo: TestMongo;
  let db: Db;
  let dir: string;

  beforeAll(async () => {
    mongo = await startTestMongo();
    db = mongo.client.db(`assets_${Math.random().toString(36).slice(2, 10)}`);
    await migrate(db);
    dir = mkdtempSync(path.join(tmpdir(), 'learn-assets-'));
  }, MONGO_STARTUP_TIMEOUT);

  afterAll(async () => {
    rmSync(dir, { recursive: true, force: true });
    await mongo?.stop();
  });

  it('writes both files under their hash, records them once, and audits the addition', async () => {
    const image = makePng(120, 80, (x, y) => [x, y, 100]);
    const thumbnail = makePng(60, 40, () => [10, 20, 30]);
    const first = await storeAsset(db, dir, { role: 'reference', bytes: image, thumbnail, licence: FIXTURE_LICENCE, actor: 'cli' });
    expect(first.status).toBe('stored');
    if (first.status === 'invalid') return;
    expect(first.asset).toMatchObject({ _id: sha256(image), role: 'reference', contentType: 'image/png', width: 120, height: 80, bytes: image.length, thumbnailAssetId: sha256(thumbnail), licence: FIXTURE_LICENCE });
    expect(first.thumbnail).toMatchObject({ _id: sha256(thumbnail), role: 'thumbnail', of: sha256(image), licence: null });
    expect(readdirSync(dir).sort()).toEqual([`${sha256(image)}.png`, `${sha256(thumbnail)}.png`].sort());
    expect(statSync(path.join(dir, `${sha256(image)}.png`)).mode & 0o777).toBe(0o640);
    expect(await checkAssetFile(dir, first.asset)).toBe('ok');
    expect(await collections(db).auditEvents.countDocuments({ type: 'admin.learn_asset_added' })).toBe(1);

    // The same bytes again: nothing changes, not even with another licence.
    const again = await storeAsset(db, dir, { role: 'reference', bytes: image, thumbnail, licence: { ...FIXTURE_LICENCE, author: 'Someone else' }, actor: 'cli' });
    expect(again).toMatchObject({ status: 'exists', asset: { licence: FIXTURE_LICENCE } });
    expect(await collections(db).auditEvents.countDocuments({ type: 'admin.learn_asset_added' })).toBe(1);

    // A file that went missing or changed is reported.
    writeFileSync(path.join(dir, `${sha256(image)}.png`), makePng(120, 80, () => [0, 0, 0]));
    expect(await checkAssetFile(dir, first.asset)).toBe('changed');
    rmSync(path.join(dir, `${sha256(image)}.png`));
    expect(await checkAssetFile(dir, first.asset)).toBe('missing');
  });

  it('refuses a reference without its thumbnail or licence, and leaves nothing behind', async () => {
    const image = makePng(10, 10, () => [200, 0, 0]);
    expect(await storeAsset(db, dir, { role: 'reference', bytes: image, thumbnail: null, licence: FIXTURE_LICENCE, actor: 'cli' })).toEqual({ status: 'invalid', issues: ['a reference image needs its thumbnail'] });
    const refused = await storeAsset(db, dir, { role: 'reference', bytes: image, thumbnail: makePng(5, 5, () => [0, 0, 0]), licence: { kind: 'cc0' }, actor: 'cli' });
    expect(refused.status).toBe('invalid');
    expect(await collections(db).learnAssets.findOne({ _id: sha256(image) })).toBeNull();
    expect(readdirSync(dir).some((name) => name.startsWith(sha256(image)) || name.endsWith('.tmp'))).toBe(false);
  });
});
