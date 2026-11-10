import type { Metadata } from 'next';
import { listAuditEvents } from '@/server/admin';
import { getDb } from '@/server/db/client';
import { requireAdmin } from '@/server/session';
import { AdminShell } from '../AdminShell';
import { EventList } from '../EventList';

// The audit log: registrations, sign-ins, role and plan changes, newest first.

export const metadata: Metadata = { title: 'Activity · Studio Companion admin', robots: { index: false, follow: false } };

// Depends on who is signed in: always rendered per request, never cached.
export const dynamic = 'force-dynamic';

export default async function AdminActivityPage() {
  const admin = await requireAdmin('/admin/activity');
  const events = await listAuditEvents(getDb(), { limit: 100 });
  return (
    <AdminShell active="activity">
      <h1 className="mt-6 text-2xl font-bold tracking-tight text-foreground">Activity</h1>
      <p className="mt-1 text-sm text-muted-foreground">The latest 100 account events. Times are in UTC.</p>
      <section className="mt-4 rounded-2xl border border-border bg-card px-4 md:px-5">
        <EventList events={events} viewerId={admin.id.toHexString()} showSubject />
      </section>
    </AdminShell>
  );
}
