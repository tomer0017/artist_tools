import { NextResponse } from 'next/server';
import { getDb } from '@/server/db/client';
import { toObjectId } from '@/server/db/collections';
import { getEntitlements } from '@/server/entitlements';
import { log } from '@/server/log';
import { getSession } from '@/server/session';

// The signed-in user and what their account includes, for display. A read-only
// copy: the server re-checks entitlements wherever they protect something.

export const dynamic = 'force-dynamic';

const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } });

export async function GET() {
  try {
    const session = await getSession();
    if (!session) return json({ error: 'unauthorized' }, 401);
    const { id, name, email, image, role } = session.user;
    const entitlements = await getEntitlements(getDb(), toObjectId(id)!);
    return json({ user: { id, name, email, image: image ?? null, role }, entitlements });
  } catch (error) {
    log.error('api.me_failed', { error });
    return json({ error: 'unavailable' }, 503);
  }
}
