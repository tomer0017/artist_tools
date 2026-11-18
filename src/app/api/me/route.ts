import { NextResponse } from 'next/server';
import { getAccountSummary } from '@/server/account';
import { recordActiveDay } from '@/server/analytics';
import { emailPasswordAvailable, usernamePasswordAvailable } from '@/server/auth';
import { getDb } from '@/server/db/client';
import { toObjectId } from '@/server/db/collections';
import { log } from '@/server/log';
import { getSession } from '@/server/session';

// The signed-in user and what their account includes. Read from the database
// on every request, so plan and role changes, and a newly published plan
// catalog, show at once: the studio asks again when it comes back into view
// and every minute while it is in view (`?check=1`: nothing is recorded for
// those). A read-only copy: the server re-checks entitlements wherever they
// protect something (src/app/api/usage/route.ts).

export const dynamic = 'force-dynamic';

const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } });

export async function GET(request: Request) {
  try {
    const session = await getSession();
    if (!session) return json({ error: 'unauthorized' }, 401);
    const summary = await getAccountSummary(getDb(), toObjectId(session.user.id)!, { emailPasswordEnabled: emailPasswordAvailable(), usernamePasswordEnabled: usernamePasswordAvailable() });
    if (!summary) return json({ error: 'unauthorized' }, 401);
    if (new URL(request.url).searchParams.get('check') !== '1') {
      await recordActiveDay(getDb(), session.user.id).catch((error) => log.warn('analytics.active_day_failed', { error }));
    }
    return json({ user: summary.account, entitlements: summary.entitlements });
  } catch (error) {
    log.error('api.me_failed', { error });
    return json({ error: 'unavailable' }, 503);
  }
}
