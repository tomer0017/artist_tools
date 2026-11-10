import { NextResponse } from 'next/server';
import { recordAudit } from '@/server/audit';
import { exportAccountData } from '@/server/account-management';
import { getDb } from '@/server/db/client';
import { toObjectId } from '@/server/db/collections';
import { log } from '@/server/log';
import { fromOwnOrigin } from '@/server/request';
import { consumeThrottle } from '@/server/security/throttle';
import { getSession } from '@/server/session';

// POST /api/me/export: a JSON file of everything kept about the signed-in
// person (src/server/account-management.ts). Their own data only, from the
// verified session; at most 5 exports an hour; each one audited.

export const dynamic = 'force-dynamic';

const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } });

export async function POST(request: Request) {
  if (!fromOwnOrigin(request)) return json({ error: 'forbidden' }, 403);
  try {
    const session = await getSession();
    const userId = session ? toObjectId(session.user.id) : null;
    if (!userId) return json({ error: 'unauthorized' }, 401);
    const db = getDb();
    if (!(await consumeThrottle(db, 'export', userId.toHexString(), { limit: 5, windowSeconds: 60 * 60 })).allowed) {
      return json({ error: 'too_many_requests' }, 429);
    }
    const data = await exportAccountData(db, userId);
    if (!data) return json({ error: 'unauthorized' }, 401);
    await recordAudit(db, { type: 'account.data_exported', userId, actor: `user:${userId}`, metadata: {} });
    const day = new Date().toISOString().slice(0, 10);
    return new NextResponse(JSON.stringify(data, null, 2), {
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Disposition': `attachment; filename="studio-companion-account-${day}.json"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (error) {
    log.error('api.export_failed', { error });
    return json({ error: 'unavailable' }, 503);
  }
}
