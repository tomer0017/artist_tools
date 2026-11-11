import type { Metadata } from 'next';
import { getDb } from '@/server/db/client';
import { KEEP_DAYS, listErrors } from '@/server/error-reports';
import { requireAdmin } from '@/server/session';
import { AdminShell } from '../AdminShell';
import { dateTime } from '../format';

// Errors seen in browsers and on the server, grouped (src/server/error-reports.ts,
// docs/ops/monitoring.md). About the code, not people: no accounts, IP
// addresses, query strings or request bodies. Groups not seen for 30 days
// disappear on their own.

export const metadata: Metadata = { title: 'Errors · Studio Companion admin', robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';

export default async function AdminErrorsPage() {
  await requireAdmin('/admin/errors');
  const errors = await listErrors(getDb());

  return (
    <AdminShell active="errors">
      <h1 className="mt-6 text-2xl font-bold tracking-tight text-foreground">Errors</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Errors from browsers and from the server, grouped. Nothing personal is kept: no accounts, IP addresses, query strings or request bodies; email
        addresses and tokens are removed. A group not seen for {KEEP_DAYS} days disappears.
      </p>
      {errors.length === 0 ? (
        <p className="mt-6 text-sm text-muted-foreground">No errors recorded.</p>
      ) : (
        <ul aria-label="Errors" className="mt-4 space-y-3">
          {errors.map((e) => (
            <li key={e._id}>
              <details className="rounded-2xl border border-border bg-card p-4">
                <summary className="cursor-pointer list-none">
                  <p className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                    <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${e.source === 'server' ? 'bg-destructive/15 text-destructive' : 'bg-primary/15 text-primary'}`}>
                      {e.source === 'server' ? 'Server' : 'Browser'}
                    </span>
                    <span className="break-all text-sm font-semibold text-foreground">{e.message}</span>
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {e.count} {e.count === 1 ? 'time' : 'times'} · last {dateTime(e.lastSeen)} · first {dateTime(e.firstSeen)}
                  </p>
                </summary>
                <dl className="mt-3 grid gap-1 text-xs text-muted-foreground">
                  <div>
                    <dt className="inline font-medium text-foreground">Pages: </dt>
                    <dd className="inline break-all">{e.paths.join(', ') || '—'}</dd>
                  </div>
                  <div>
                    <dt className="inline font-medium text-foreground">Releases: </dt>
                    <dd className="inline">{e.releases.join(', ') || '—'}</dd>
                  </div>
                  {e.browsers.length > 0 && (
                    <div>
                      <dt className="inline font-medium text-foreground">Browsers: </dt>
                      <dd className="inline">{e.browsers.join(', ')}</dd>
                    </div>
                  )}
                </dl>
                {e.stack && <pre tabIndex={0} aria-label="Stack" className="mt-3 max-h-64 overflow-auto whitespace-pre-wrap break-all rounded-lg bg-secondary/40 p-3 text-[11px] leading-relaxed text-foreground">{e.stack}</pre>}
              </details>
            </li>
          ))}
        </ul>
      )}
    </AdminShell>
  );
}
