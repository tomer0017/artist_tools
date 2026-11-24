import { NextResponse } from 'next/server';
import { UnreadableConfigError, getPublished } from '@/server/config/versions';
import { companionSpec, publishedCompanion } from '@/server/companion/config';
import { companionViewFor } from '@/server/companion/live';
import { getDb } from '@/server/db/client';
import { toObjectId } from '@/server/db/collections';
import { getEntitlements } from '@/server/entitlements';
import { log } from '@/server/log';
import { getSession } from '@/server/session';

// GET /api/companion (ADR-0024): Sketchy for the signed-in account — his
// settings, each of his capabilities as open, locked or hidden for this
// account (decided from its fresh entitlements), and only the tips it may
// see. Asked once when the studio starts him, and again only when the
// account summary's companion key changes (an admin saved, the plan changed).

export const dynamic = 'force-dynamic';

const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' } });

export async function GET() {
  try {
    const session = await getSession();
    const userId = session ? toObjectId(session.user.id) : null;
    if (!userId) return json({ error: 'unauthorized' }, 401);
    const db = getDb();
    const entitlements = await getEntitlements(db, userId);
    if (!entitlements.accountActive) return json({ error: 'unauthorized' }, 401);
    const [config, published] = await Promise.all([publishedCompanion(db), getPublished(db, companionSpec)]);
    return json(companionViewFor(config, published?.version ?? null, entitlements));
  } catch (error) {
    if (error instanceof UnreadableConfigError) {
      log.error('companion.config_unreadable', { version: error.version, issues: error.issues.slice(0, 3) });
      return json({ error: 'unavailable' }, 503);
    }
    log.error('api.companion_failed', { error });
    return json({ error: 'unavailable' }, 503);
  }
}
