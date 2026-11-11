import { NextResponse } from 'next/server';
import { z } from 'zod';
import { TOOL_IDS } from '@/lib/account';
import { recordToolOpen } from '@/server/analytics';
import { getDb } from '@/server/db/client';
import { log } from '@/server/log';
import { BodyTooLarge, fromOwnOrigin, readJsonBody } from '@/server/request';
import { getSession } from '@/server/session';

// POST /api/events { name: 'tool_open', tool }: product events from the
// studio, allow-listed and without personal data or artwork (ADR-0011). Only
// signed-in accounts; each tool counts once per account per UTC day.

export const dynamic = 'force-dynamic';

const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
const Body = z.object({ name: z.literal('tool_open'), tool: z.enum(TOOL_IDS) }).strict();

export async function POST(request: Request) {
  if (!fromOwnOrigin(request)) return json({ error: 'forbidden' }, 403);
  try {
    const session = await getSession();
    if (!session) return json({ error: 'unauthorized' }, 401);
    const body = Body.safeParse(await readJsonBody(request, 1024));
    if (!body.success) return json({ error: 'invalid_request' }, 400);
    await recordToolOpen(getDb(), session.user.id, body.data.tool);
    return json({ ok: true });
  } catch (error) {
    if (error instanceof BodyTooLarge) return json({ error: 'too_large' }, 413);
    log.error('api.events_failed', { error });
    return json({ error: 'unavailable' }, 503);
  }
}
