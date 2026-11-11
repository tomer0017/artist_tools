import { NextResponse } from 'next/server';
import { z } from 'zod';
import { parseUserAgent } from '@/lib/user-agent';
import { getDb } from '@/server/db/client';
import { recordError } from '@/server/error-reports';
import { log } from '@/server/log';
import { BodyTooLarge, fromOwnOrigin, readJsonBody } from '@/server/request';
import { consumeThrottle } from '@/server/security/throttle';

// POST /api/client-errors: an error a page hit in the browser
// (src/components/common/ErrorReporter.tsx), for the admin's Errors page.
// Pages of this site only; no sign-in needed (errors on public pages count
// too). Rate-limited per IP: the throttle keeps only a hash, which expires.
// Nothing personal is stored (src/server/error-reports.ts).

export const dynamic = 'force-dynamic';

const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } });

const Body = z
  .object({
    message: z.string().max(2000),
    stack: z.string().max(8000).nullable().optional(),
    path: z.string().max(500),
    release: z.string().max(40).nullable().optional(),
  })
  .strict();

const PER_IP = { limit: 30, windowSeconds: 10 * 60 };

export async function POST(request: Request) {
  if (!fromOwnOrigin(request)) return json({ error: 'forbidden' }, 403);
  try {
    const body = Body.safeParse(await readJsonBody(request, 10 * 1024));
    if (!body.success) return json({ error: 'invalid_request' }, 400);
    const db = getDb();
    const ip = request.headers.get('x-real-ip') ?? 'unknown';
    if (!(await consumeThrottle(db, 'client-error', ip, PER_IP)).allowed) return json({ error: 'rate_limited' }, 429);
    const { browser, system } = parseUserAgent(request.headers.get('user-agent'));
    await recordError(db, {
      source: 'client',
      message: body.data.message,
      stack: body.data.stack ?? null,
      path: body.data.path,
      release: body.data.release ?? null,
      browser: browser && system ? `${browser} on ${system}` : (browser ?? system),
    });
    return json({ ok: true });
  } catch (error) {
    if (error instanceof BodyTooLarge) return json({ error: 'too_large' }, 413);
    log.error('api.client_errors_failed', { error });
    return json({ error: 'unavailable' }, 503);
  }
}
