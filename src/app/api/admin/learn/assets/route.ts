import { NextResponse } from 'next/server';
import { getDb } from '@/server/db/client';
import { learnAssetsDir } from '@/server/env';
import { MAX_ASSET_BYTES, MAX_THUMBNAIL_BYTES, storeAsset } from '@/server/learn/assets';
import { log } from '@/server/log';
import { BodyTooLarge, fromOwnOrigin, readBodyBytes } from '@/server/request';
import { currentAdmin } from '@/server/session';

// POST /api/admin/learn/assets (ADR-0023): a picture or a practice sheet
// uploaded from Admin → Learn's editor. Administrators only (with their
// second factor), from this site only. The browser has already re-saved the
// picture (which removes camera details and location) and made its
// thumbnail; the server checks both again by their bytes, with the licence,
// exactly as an import does (src/server/learn/assets.ts), and stores them
// under their SHA-256. Nothing is published: the editor puts the new
// picture's ID in the form, and Save publishes it. Files are never replaced:
// replacing a picture stores a new one, so earlier versions keep theirs.

export const dynamic = 'force-dynamic';

const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' } });

/** The two files and the form's text fields, with room for the multipart framing. */
const MAX_BODY = MAX_ASSET_BYTES + MAX_THUMBNAIL_BYTES + 64 * 1024;

const bytesOf = async (value: FormDataEntryValue | null) => (value && typeof value !== 'string' ? new Uint8Array(await value.arrayBuffer()) : null);

export async function POST(request: Request) {
  if (!fromOwnOrigin(request)) return json({ ok: false, message: 'forbidden' }, 403);
  const admin = await currentAdmin();
  if (!admin) return json({ ok: false, message: 'not_found' }, 404);
  const dir = learnAssetsDir();
  if (!dir) return json({ ok: false, message: 'Pictures cannot be stored here: the asset directory is not set up (LEARN_ASSETS_DIR).' }, 503);
  try {
    const type = request.headers.get('content-type') ?? '';
    if (!type.startsWith('multipart/form-data')) return json({ ok: false, message: 'That request was not valid.' }, 400);
    const body = await readBodyBytes(request, MAX_BODY);
    const form = await new Response(body, { headers: { 'content-type': type } }).formData();
    const role = form.get('role') === 'worksheet' ? 'worksheet' : 'reference';
    const file = await bytesOf(form.get('file'));
    const thumbnail = role === 'reference' ? await bytesOf(form.get('thumbnail')) : null;
    let licence: unknown = null;
    try {
      licence = JSON.parse(String(form.get('licence') ?? 'null'));
    } catch {
      licence = null;
    }
    if (!file) return json({ ok: false, message: 'No file was sent.' }, 400);
    const result = await storeAsset(getDb(), dir, { role, bytes: file, thumbnail, licence, actor: `admin:${admin.id.toHexString()}` });
    if (result.status === 'invalid') return json({ ok: false, message: 'The file was not stored.', issues: result.issues }, 422);
    const { asset } = result;
    return json({ ok: true, stored: result.status, assetId: asset._id, thumbnailAssetId: asset.thumbnailAssetId, width: asset.width, height: asset.height, contentType: asset.contentType, bytes: asset.bytes });
  } catch (error) {
    if (error instanceof BodyTooLarge) return json({ ok: false, message: `The file is too large: at most ${Math.round(MAX_ASSET_BYTES / 1024 / 1024)} MB.` }, 413);
    log.error('api.admin_learn_asset_failed', { error });
    return json({ ok: false, message: 'The file could not be stored. Nothing was changed; try again.' }, 500);
  }
}
