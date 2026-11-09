import type { Metadata } from 'next';
import Link from 'next/link';
import { BrandMark } from '@/components/shell/BrandMark';
import { listUsers } from '@/server/admin';
import { getDb } from '@/server/db/client';
import { requireAdmin } from '@/server/session';

// Minimal application administration: who uses Studio Companion. Server
// rendered for admins only (everyone else gets a 404); there is no API that
// exposes this list.

export const metadata: Metadata = { title: 'Users · Studio Companion admin', robots: { index: false, follow: false } };

// Depends on who is signed in: always rendered per request, never cached.
export const dynamic = 'force-dynamic';

const date = (value: Date | null) =>
  value ? new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' }).format(value) + ' UTC' : '—';

export default async function AdminUsersPage({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  await requireAdmin('/admin');
  const { page } = await searchParams;
  const { rows, total, page: current, pages } = await listUsers(getDb(), Number(page) || 1);

  return (
    <main className="min-h-[100dvh] bg-background px-4 py-6 md:px-8">
      <div className="mx-auto max-w-6xl">
        <header className="flex items-center justify-between gap-4">
          <Link href="/app" aria-label="Back to the studio" className="rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <BrandMark compact />
          </Link>
          <span className="rounded-full border border-border px-3 py-1 text-xs text-muted-foreground">Admin</span>
        </header>

        <h1 className="mt-8 text-2xl font-bold tracking-tight text-foreground">Users</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {total} registered · page {current} of {pages}
        </p>

        <div className="mt-6 overflow-x-auto rounded-xl border border-border">
          <table className="w-full min-w-[760px] text-left text-sm">
            <thead className="bg-card text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-4 py-3 font-medium">User</th>
                <th className="px-4 py-3 font-medium">Registered</th>
                <th className="px-4 py-3 font-medium">Last login</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Plan</th>
                <th className="px-4 py-3 font-medium">Subscription</th>
                <th className="px-4 py-3 text-right font-medium">Uses this month</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map((u) => (
                <tr key={u.id}>
                  <td className="px-4 py-3">
                    <div className="font-medium text-foreground">
                      {u.name}
                      {u.role === 'admin' && <span className="ml-2 rounded bg-primary/15 px-1.5 py-0.5 text-[11px] text-primary">admin</span>}
                    </div>
                    <div className="text-xs text-muted-foreground">{u.email}</div>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">{date(u.createdAt)}</td>
                  <td className="px-4 py-3 text-muted-foreground">{date(u.lastLoginAt)}</td>
                  <td className="px-4 py-3">{u.status}</td>
                  <td className="px-4 py-3">{u.planId ?? 'free'}</td>
                  <td className="px-4 py-3 text-muted-foreground">{u.subscriptionStatus ?? '—'}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{u.usageThisMonth}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {pages > 1 && (
          <nav aria-label="Pages" className="mt-4 flex gap-2 text-sm">
            {current > 1 && <Link className="rounded-lg border border-border px-3 py-1.5 hover:bg-secondary" href={`/admin?page=${current - 1}`}>Previous</Link>}
            {current < pages && <Link className="rounded-lg border border-border px-3 py-1.5 hover:bg-secondary" href={`/admin?page=${current + 1}`}>Next</Link>}
          </nav>
        )}
      </div>
    </main>
  );
}
