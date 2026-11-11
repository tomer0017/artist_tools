import type { Metadata } from 'next';
import Link from 'next/link';
import { Download } from 'lucide-react';
import { listAuditEvents } from '@/server/admin';
import { getDb } from '@/server/db/client';
import { requireAdmin } from '@/server/session';
import { AdminShell } from '../AdminShell';
import { EventList } from '../EventList';
import { EVENT_GROUPS } from '../format';
import { ACTORS, auditQueryFrom } from './query';

// The audit log: registrations, sign-ins, security changes and admin changes,
// newest first, filtered by kind of event, who did it, account and dates.

export const metadata: Metadata = { title: 'Activity · Studio Companion admin', robots: { index: false, follow: false } };

// Depends on who is signed in: always rendered per request, never cached.
export const dynamic = 'force-dynamic';

export default async function AdminActivityPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const admin = await requireAdmin('/admin/activity');
  const { query, active } = await auditQueryFrom(await searchParams);
  const events = await listAuditEvents(getDb(), { ...query, limit: 200 });
  const filtered = Object.keys(active).length > 0;
  const exportHref = `/admin/activity/export?${new URLSearchParams(active)}`;
  return (
    <AdminShell active="activity">
      <div className="mt-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">Activity</h1>
          <p className="mt-1 text-sm text-muted-foreground">The latest 200 matching account events. Times are in UTC.</p>
        </div>
        <a href={exportHref} className="inline-flex h-10 items-center gap-2 rounded-lg border border-border bg-card px-3 text-sm font-medium text-foreground hover:bg-secondary">
          <Download className="h-4 w-4" aria-hidden="true" /> Export CSV
        </a>
      </div>

      <form method="get" action="/admin/activity" aria-label="Filter activity" className="mt-4 grid grid-cols-2 gap-3 rounded-xl border border-border bg-card p-3 sm:grid-cols-5">
        <label className="text-xs font-medium text-muted-foreground">
          Kind
          <select name="kind" defaultValue={active.kind ?? ''} className="mt-1 block h-10 w-full rounded-lg border border-border bg-background px-2 text-base text-foreground md:text-sm">
            <option value="">All</option>
            {EVENT_GROUPS.map((g) => (
              <option key={g.id} value={g.id}>
                {g.label}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs font-medium text-muted-foreground">
          By
          <select name="by" defaultValue={active.by ?? ''} className="mt-1 block h-10 w-full rounded-lg border border-border bg-background px-2 text-base text-foreground md:text-sm">
            <option value="">Anyone</option>
            {ACTORS.map(([id, label]) => (
              <option key={id} value={id}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className="col-span-2 text-xs font-medium text-muted-foreground sm:col-span-1">
          Account email
          <input name="email" type="email" inputMode="email" defaultValue={active.email} autoComplete="off" className="mt-1 block h-10 w-full rounded-lg border border-border bg-background px-2 text-base text-foreground md:text-sm" />
        </label>
        <label className="text-xs font-medium text-muted-foreground">
          From
          <input type="date" name="from" defaultValue={active.from} className="mt-1 block h-10 w-full rounded-lg border border-border bg-background px-2 text-base text-foreground md:text-sm" />
        </label>
        <label className="text-xs font-medium text-muted-foreground">
          Until
          <input type="date" name="to" defaultValue={active.to} className="mt-1 block h-10 w-full rounded-lg border border-border bg-background px-2 text-base text-foreground md:text-sm" />
        </label>
        <div className="col-span-2 flex gap-2 sm:col-span-5">
          <button type="submit" className="h-10 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground">Apply</button>
          {filtered && (
            <Link href="/admin/activity" className="flex h-10 items-center rounded-lg border border-border px-4 text-sm text-foreground hover:bg-secondary">
              Clear
            </Link>
          )}
        </div>
      </form>

      <section aria-label="Events" className="mt-4 rounded-2xl border border-border bg-card px-4 md:px-5">
        <EventList events={events} viewerId={admin.id.toHexString()} showSubject />
      </section>
    </AdminShell>
  );
}
