import { NextResponse } from 'next/server';
import { pingDb } from '@/server/db/client';
import { log } from '@/server/log';

// Health check for systemd, deploy scripts and uptime monitors.
//   GET /api/health          → 200 while the process serves requests
//   GET /api/health?ready=1  → 200 only when the database answers too, else 503

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const headers = { 'Cache-Control': 'no-store' };
  if (!new URL(request.url).searchParams.has('ready')) return NextResponse.json({ status: 'ok' }, { headers });
  let database = false;
  try {
    database = await pingDb();
  } catch (error) {
    log.error('health.check_failed', { error });
  }
  return NextResponse.json(
    { status: database ? 'ok' : 'degraded', database: database ? 'ok' : 'unreachable' },
    { status: database ? 200 : 503, headers },
  );
}
