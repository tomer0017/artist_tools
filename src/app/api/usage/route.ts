import { NextResponse } from 'next/server';
import { z } from 'zod';
import { FEATURES } from '@/lib/plans';
import { getDb } from '@/server/db/client';
import { toObjectId } from '@/server/db/collections';
import { authorizeFeatureUse } from '@/server/entitlements';
import { log } from '@/server/log';
import { fromOwnOrigin } from '@/server/request';
import { getSession } from '@/server/session';

// The studio asks here right before it uses a counted or plan-limited feature
// (e.g. a Large GIF). The server decides from the database whether this
// account may, and counts the use; the browser only follows the answer.

export const dynamic = 'force-dynamic';

const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } });

const Body = z.object({ features: z.array(z.enum(FEATURES)).min(1).max(FEATURES.length) });

export async function POST(request: Request) {
  if (!fromOwnOrigin(request)) return json({ error: 'forbidden' }, 403);
  try {
    const session = await getSession();
    const userId = session ? toObjectId(session.user.id) : null;
    if (!userId) return json({ error: 'unauthorized' }, 401);
    const body = Body.safeParse(await request.json().catch(() => null));
    if (!body.success) return json({ error: 'invalid_request' }, 400);

    const result = await authorizeFeatureUse(getDb(), userId, body.data.features);
    if (result.status === 'denied') return json({ error: 'not_included', features: result.missing }, 403);
    return json({ ok: true });
  } catch (error) {
    log.error('api.usage_failed', { error });
    return json({ error: 'unavailable' }, 503);
  }
}
