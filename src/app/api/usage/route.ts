import { NextResponse } from 'next/server';
import { z } from 'zod';
import { TOOL_FEATURE_IDS, USE_FEATURE_IDS } from '@/lib/plans';
import { ITEM_ID } from '@/lib/learn/model';
import { getDb } from '@/server/db/client';
import { toObjectId } from '@/server/db/collections';
import { authorizeToolUse } from '@/server/entitlements';
import { log } from '@/server/log';
import { BodyTooLarge, fromOwnOrigin, readJsonBody } from '@/server/request';
import { getSession } from '@/server/session';

// The studio asks here right before every save or export (and before saving
// a project file): `tool` is the tool it comes from, which must be included in
// the account's plan (checked, not counted); `features` are what is exported
// (an image, a GIF, a large GIF…), each authorized and counted; `learnItem`,
// for an export made from a Learn item's reference, must be an item the
// account may open (ADR-0017). The server decides from the database alone;
// the browser only follows the answer, and treats no answer as a refusal.

export const dynamic = 'force-dynamic';

const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } });

const Body = z
  .object({
    tool: z.enum(TOOL_FEATURE_IDS).optional(),
    features: z.array(z.enum(USE_FEATURE_IDS)).max(USE_FEATURE_IDS.length).default([]),
    learnItem: z.string().regex(ITEM_ID).optional(),
  })
  .refine((body) => body.tool !== undefined || body.features.length > 0, 'nothing to authorize');

export async function POST(request: Request) {
  if (!fromOwnOrigin(request)) return json({ error: 'forbidden' }, 403);
  try {
    const session = await getSession();
    const userId = session ? toObjectId(session.user.id) : null;
    if (!userId) return json({ error: 'unauthorized' }, 401);
    const body = Body.safeParse(await readJsonBody(request, 4 * 1024));
    if (!body.success) return json({ error: 'invalid_request' }, 400);

    const result = await authorizeToolUse(getDb(), userId, { tool: body.data.tool ?? null, features: body.data.features, learnItem: body.data.learnItem ?? null });
    if (result.status === 'denied') {
      return result.reason === 'limit_reached'
        ? json({ error: 'limit_reached', features: result.missing }, 429)
        : json({ error: 'not_included', features: result.missing, ...(result.learnItem ? { learnItem: result.learnItem } : {}) }, 403);
    }
    return json({ ok: true });
  } catch (error) {
    if (error instanceof BodyTooLarge) return json({ error: 'too_large' }, 413);
    log.error('api.usage_failed', { error });
    return json({ error: 'unavailable' }, 503);
  }
}
