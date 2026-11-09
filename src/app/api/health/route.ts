import { NextResponse } from 'next/server';
import { pingDb } from '@/server/db/client';
import { authConfig, dbConfig } from '@/server/env';
import { log } from '@/server/log';

// Health check for systemd, deploy scripts and uptime monitors.
//   GET /api/health          → 200 while the process serves requests
//   GET /api/health?ready=1  → 200 only when the configuration is complete and
//                              the database answers, else 503 (a release with
//                              a broken env file is rolled back, not served)

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const headers = { 'Cache-Control': 'no-store' };
  if (!new URL(request.url).searchParams.has('ready')) return NextResponse.json({ status: 'ok' }, { headers });
  let config = false;
  try {
    dbConfig();
    authConfig();
    config = true;
  } catch (error) {
    log.error('health.config_invalid', { error });
  }
  let database = false;
  if (config) {
    try {
      database = await pingDb();
    } catch (error) {
      log.error('health.check_failed', { error });
    }
  }
  const ready = config && database;
  return NextResponse.json(
    { status: ready ? 'ok' : 'degraded', config: config ? 'ok' : 'invalid', database: database ? 'ok' : 'unreachable' },
    { status: ready ? 200 : 503, headers },
  );
}
