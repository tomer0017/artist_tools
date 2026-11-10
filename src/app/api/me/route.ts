import { NextResponse } from 'next/server';
import { getAccountSummary } from '@/server/account';
import { getDb } from '@/server/db/client';
import { toObjectId } from '@/server/db/collections';
import { log } from '@/server/log';
import { getSession } from '@/server/session';

// The signed-in user and what their account includes, for display. Read from
// the database on every request, so plan and role changes show at once. A
// read-only copy: the server re-checks entitlements wherever they protect
// something.

export const dynamic = 'force-dynamic';

const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } });

export async function GET() {
  try {
    const session = await getSession();
    if (!session) return json({ error: 'unauthorized' }, 401);
    const summary = await getAccountSummary(getDb(), toObjectId(session.user.id)!);
    if (!summary) return json({ error: 'unauthorized' }, 401);
    return json({ user: summary.account, entitlements: summary.entitlements });
  } catch (error) {
    log.error('api.me_failed', { error });
    return json({ error: 'unavailable' }, 503);
  }
}
