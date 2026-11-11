import { NextResponse } from 'next/server';
import { recordAudit } from '@/server/audit';
import { listAuditEvents } from '@/server/admin';
import { getDb } from '@/server/db/client';
import { log } from '@/server/log';
import { currentAdmin } from '@/server/session';
import { auditQueryFrom } from '../query';

// GET /admin/activity/export?…filters: the matching audit events (up to 5,000)
// as CSV, for admins only (404 for everyone else, like the pages). Exporting is
// itself audited. Contains account emails, so it is personal data: keep it
// only as long as needed.

export const dynamic = 'force-dynamic';

const cell = (value: unknown) => {
  const text = value === null || value === undefined ? '' : String(value);
  // Quote everything; neutralise spreadsheet formulas.
  const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return `"${safe.replace(/"/g, '""')}"`;
};

export async function GET(request: Request) {
  const admin = await currentAdmin();
  if (!admin) return new NextResponse('Not found', { status: 404 });
  try {
    const params = Object.fromEntries(new URL(request.url).searchParams);
    const { query } = await auditQueryFrom(params);
    const db = getDb();
    const events = await listAuditEvents(db, { ...query, limit: 5000 });
    await recordAudit(db, { type: 'admin.audit_exported', userId: null, actor: `admin:${admin.id.toHexString()}`, metadata: { rows: events.length } });
    const lines = [
      ['time_utc', 'event', 'account_id', 'account_email', 'by', 'by_email', 'details'].map(cell).join(','),
      ...events.map((e) =>
        [e.at.toISOString(), e.type, e.subject?.id ?? '', e.subject?.email ?? '', e.actor.kind, e.actor.email ?? '', JSON.stringify(e.metadata)].map(cell).join(','),
      ),
    ];
    return new NextResponse(`${lines.join('\r\n')}\r\n`, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="studio-companion-activity-${new Date().toISOString().slice(0, 10)}.csv"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (error) {
    log.error('admin.audit_export_failed', { error });
    return new NextResponse('Unavailable', { status: 503 });
  }
}
