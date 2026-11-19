import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { ASSET_ID, itemAssetIds, itemsOf } from '@/lib/learn/model';
import { UnreadableConfigError } from '@/server/config/versions';
import { collections } from '@/server/db/collections';
import { learnAssetsDir } from '@/server/env';
import { log } from '@/server/log';
import { assetPath } from '@/server/learn/assets';
import { liveLearn } from '@/server/learn/live';
import { learnJson, learnRequest } from '@/server/learn/request';

// GET /api/learn/assets/<sha256> (ADR-0017): a Learn picture (a reference, or a
// lesson's demonstration, step or mistake picture, ADR-0019), its thumbnail or
// a static worksheet, only for an account allowed it at this moment — an admin, or an account that may open a published item using it
// (a thumbnail also while locked items show thumbnails in lists). Locked:
// 403, even for a URL that worked before access ended; anything else: 404.
// The ID is exactly 64 hex characters, so no path is built from the request.
// Files never change (named by their hash): `ETag` is the hash, and
// `private, no-cache` makes every use revalidate, so access is re-checked
// each time and no shared cache keeps a copy.

export const dynamic = 'force-dynamic';

const PRIVATE = { 'Cache-Control': 'private, no-cache', 'X-Content-Type-Options': 'nosniff', 'Cross-Origin-Resource-Policy': 'same-origin' };

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    if (!ASSET_ID.test(id)) return learnJson({ error: 'not_found' }, 404);
    const ready = await learnRequest();
    if (ready instanceof Response) return ready;
    const { db, entitlements } = ready;
    const asset = await collections(db).learnAssets.findOne({ _id: id });
    if (!asset) return learnJson({ error: 'not_found' }, 404);

    if (entitlements.access !== 'admin') {
      const { content, view } = await liveLearn(db, entitlements);
      const target = asset.role === 'thumbnail' ? asset.of : asset._id;
      const users = itemsOf(content).filter((item) => target !== null && itemAssetIds(item).includes(target));
      const visible = users.filter((item) => view.state(item.id).status !== 'hidden');
      if (visible.length === 0) return learnJson({ error: 'not_found' }, 404);
      const allowed = asset.role === 'thumbnail' ? visible.some((item) => view.thumbnail(item.id)) : visible.some((item) => view.canOpen(item.id));
      if (!allowed) return learnJson({ error: 'locked' }, 403);
    }

    const dir = learnAssetsDir();
    if (!dir) return learnJson({ error: 'unavailable' }, 503);
    const etag = `"${asset._id}"`;
    if (request.headers.get('if-none-match') === etag) return new Response(null, { status: 304, headers: { ...PRIVATE, ETag: etag } });
    const file = assetPath(dir, asset._id, asset.contentType);
    const info = await stat(file).catch(() => null);
    if (!info || info.size !== asset.bytes) {
      log.error('learn.asset_file_missing', { assetId: asset._id, found: info ? 'wrong size' : 'missing' });
      return learnJson({ error: 'unavailable' }, 503);
    }
    const body = Readable.toWeb(createReadStream(file)) as ReadableStream<Uint8Array>;
    return new Response(body, {
      status: 200,
      headers: {
        ...PRIVATE,
        ETag: etag,
        'Content-Type': asset.contentType,
        'Content-Length': String(asset.bytes),
        'Content-Disposition': asset.contentType === 'application/pdf' ? 'attachment' : 'inline',
      },
    });
  } catch (error) {
    if (error instanceof UnreadableConfigError) {
      log.error('learn.content_unreadable', { version: error.version, issues: error.issues.slice(0, 3) });
      return learnJson({ error: 'unavailable' }, 503);
    }
    log.error('api.learn_asset_failed', { error });
    return learnJson({ error: 'unavailable' }, 503);
  }
}
