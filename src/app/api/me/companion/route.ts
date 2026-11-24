import { NextResponse } from 'next/server';
import { z } from 'zod';
import { AUDIENCES } from '@/lib/companion/model';
import { setCompanionPrefs } from '@/server/account';
import { getDb } from '@/server/db/client';
import { toObjectId } from '@/server/db/collections';
import { log } from '@/server/log';
import { BodyTooLarge, fromOwnOrigin, readJsonBody } from '@/server/request';
import { getSession } from '@/server/session';

// POST /api/me/companion { hidden?, audience? } (ADR-0024): the signed-in
// person's own choices about Sketchy, kept on their account so every device
// follows them: hide him (or show him again), and say whether they mostly
// come as an artist, a student or a teacher (or not say).

export const dynamic = 'force-dynamic';

const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
const Body = z
  .object({ hidden: z.boolean().optional(), audience: z.enum(AUDIENCES).nullable().optional() })
  .strict()
  .refine((b) => b.hidden !== undefined || b.audience !== undefined, 'nothing to change');

export async function POST(request: Request) {
  try {
    if (!fromOwnOrigin(request)) return json({ error: 'forbidden' }, 403);
    const session = await getSession();
    const userId = session ? toObjectId(session.user.id) : null;
    if (!userId) return json({ error: 'unauthorized' }, 401);
    const body = Body.safeParse(await readJsonBody(request, 1024));
    if (!body.success) return json({ error: 'invalid_request' }, 400);
    await setCompanionPrefs(getDb(), userId, body.data);
    return json({ ok: true });
  } catch (error) {
    if (error instanceof BodyTooLarge) return json({ error: 'too_large' }, 413);
    log.error('api.companion_prefs_failed', { error });
    return json({ error: 'unavailable' }, 503);
  }
}
