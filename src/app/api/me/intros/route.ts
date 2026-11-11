import { NextResponse } from 'next/server';
import { z } from 'zod';
import { TOOL_IDS } from '@/lib/account';
import { markIntroSeen, resetIntros } from '@/server/account';
import { getDb } from '@/server/db/client';
import { toObjectId } from '@/server/db/collections';
import { log } from '@/server/log';
import { BodyTooLarge, fromOwnOrigin, readJsonBody } from '@/server/request';
import { getSession } from '@/server/session';

// Which tools' first-visit introductions the signed-in person has dismissed,
// kept on their account so they are not shown again on another device.
// POST { tool } remembers one; DELETE shows them all again.

export const dynamic = 'force-dynamic';

const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
const Body = z.object({ tool: z.enum(TOOL_IDS) });

async function caller(request: Request) {
  if (!fromOwnOrigin(request)) return { error: json({ error: 'forbidden' }, 403) };
  const session = await getSession();
  const userId = session ? toObjectId(session.user.id) : null;
  return userId ? { userId } : { error: json({ error: 'unauthorized' }, 401) };
}

export async function POST(request: Request) {
  try {
    const who = await caller(request);
    if ('error' in who) return who.error;
    const body = Body.safeParse(await readJsonBody(request, 1024));
    if (!body.success) return json({ error: 'invalid_request' }, 400);
    await markIntroSeen(getDb(), who.userId, body.data.tool);
    return json({ ok: true });
  } catch (error) {
    if (error instanceof BodyTooLarge) return json({ error: 'too_large' }, 413);
    log.error('api.intros_failed', { error });
    return json({ error: 'unavailable' }, 503);
  }
}

export async function DELETE(request: Request) {
  try {
    const who = await caller(request);
    if ('error' in who) return who.error;
    await resetIntros(getDb(), who.userId);
    return json({ ok: true });
  } catch (error) {
    log.error('api.intros_failed', { error });
    return json({ error: 'unavailable' }, 503);
  }
}
