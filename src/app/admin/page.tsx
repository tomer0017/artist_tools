import type { Metadata } from 'next';
import Link from 'next/link';
import { ChevronRight, Search } from 'lucide-react';
import { AccountAvatar } from '@/components/shell/account';
import { PLAN_NAMES, isPlanId } from '@/lib/plans';
import { listAuditEvents, listUsers, userStats, type AdminUserRow, type UserListQuery } from '@/server/admin';
import { registrationMode } from '@/server/auth';
import { getDb } from '@/server/db/client';
import { requireAdmin } from '@/server/session';
import { AdminShell } from './AdminShell';
import { EventList } from './EventList';
import { dateOnly, dateTime } from './format';

// Application administration: who uses Studio Companion, on which plan, and
// what happened to their accounts. Server rendered for admins only (everyone
// else gets a 404); there is no API that exposes these lists.

export const metadata: Metadata = { title: 'Users · Studio Companion admin', robots: { index: false, follow: false } };

// Depends on who is signed in: always rendered per request, never cached.
export const dynamic = 'force-dynamic';

const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value) ?? '';

/** A YYYY-MM-DD date from the filter form as the start of that UTC day; undefined if absent or malformed. */
const day = (value: string, offsetDays = 0) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? undefined : new Date(date.getTime() + offsetDays * 86_400_000);
};

const FILTERS = ['role', 'plan', 'status', 'verified', 'method', 'test', 'from', 'to'] as const;

/** The list query from the URL; anything unexpected is ignored. */
function queryFrom(params: Record<string, string | string[] | undefined>): { query: UserListQuery; active: Record<string, string> } {
  const v = (name: string) => first(params[name]);
  const query: UserListQuery = { page: Number(v('page')) || 1, search: v('q') };
  const active: Record<string, string> = {};
  if (v('role') === 'admin' || v('role') === 'user') query.role = v('role') as 'admin' | 'user';
  if (isPlanId(v('plan'))) query.plan = v('plan') as UserListQuery['plan'];
  if (v('status') === 'active' || v('status') === 'suspended') query.status = v('status') as 'active' | 'suspended';
  if (v('verified') === 'yes' || v('verified') === 'no') query.verified = v('verified') === 'yes';
  if (v('method') === 'google' || v('method') === 'password') query.method = v('method') as 'google' | 'password';
  if (v('test') === 'yes' || v('test') === 'no') query.test = v('test') === 'yes';
  query.createdFrom = day(v('from'));
  query.createdBefore = day(v('to'), 1);
  for (const name of FILTERS) if (v(name)) active[name] = v(name);
  return { query, active };
}

export default async function AdminUsersPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const admin = await requireAdmin('/admin');
  const params = await searchParams;
  const db = getDb();
  const { query, active } = queryFrom(params);
  const [list, stats, recent] = await Promise.all([listUsers(db, query), userStats(db), listAuditEvents(db, { limit: 8 })]);
  const { rows, total, page, pages, search } = list;
  const filtered = Object.keys(active).length > 0;
  const pageLink = (n: number) => `/admin?${new URLSearchParams({ ...(search ? { q: search } : {}), ...active, page: String(n) })}`;
  const invite = registrationMode() === 'invite';

  return (
    <AdminShell active="users">
      <div className="mt-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">Users</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Registration is {invite ? 'invite-only' : 'open'}. Plans and promotional access can be changed here; billing is not live.
          </p>
        </div>
        <dl className="grid grid-cols-3 gap-2 text-center sm:grid-cols-6">
          <Stat label="Accounts" value={stats.total} />
          <Stat label="Admins" value={stats.admins} />
          <Stat label="Pro" value={stats.pro} />
          <Stat label="Pro given" value={stats.granted} />
          <Stat label="Suspended" value={stats.suspended} />
          <Stat label="Test" value={stats.test} />
        </dl>
      </div>

      <form role="search" method="get" action="/admin" className="mt-5 flex gap-2">
        <label htmlFor="admin-search" className="sr-only">Search by email</label>
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <input
            id="admin-search"
            name="q"
            type="search"
            inputMode="email"
            autoComplete="off"
            defaultValue={search}
            placeholder="Search by email"
            className="h-11 w-full rounded-xl border border-border bg-card pl-9 pr-3 text-base text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:text-sm"
          />
        </div>
        <button type="submit" className="h-11 rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground">Search</button>
        {Object.entries(active).map(([name, value]) => (
          <input key={name} type="hidden" name={name} value={value} />
        ))}
      </form>

      <details className="mt-3 rounded-xl border border-border bg-card p-3" open={filtered}>
        <summary className="cursor-pointer text-sm font-medium text-foreground">Filters{filtered ? ` (${Object.keys(active).length})` : ''}</summary>
        <form method="get" action="/admin" aria-label="Filter accounts" className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {search && <input type="hidden" name="q" value={search} />}
          <Choice name="role" label="Role" value={active.role} options={[['admin', 'Admins'], ['user', 'Members']]} />
          <Choice name="plan" label="Assigned plan" value={active.plan} options={[['free', 'Free'], ['pro', 'Pro']]} />
          <Choice name="status" label="Status" value={active.status} options={[['active', 'Active'], ['suspended', 'Suspended']]} />
          <Choice name="verified" label="Email" value={active.verified} options={[['yes', 'Verified'], ['no', 'Not verified']]} />
          <Choice name="method" label="Signs in with" value={active.method} options={[['google', 'Google'], ['password', 'Password']]} />
          <Choice name="test" label="Test accounts" value={active.test} options={[['no', 'Hide'], ['yes', 'Only']]} />
          <label className="text-xs font-medium text-muted-foreground">
            Registered from
            <input type="date" name="from" defaultValue={active.from} className="mt-1 block h-10 w-full rounded-lg border border-border bg-background px-2 text-base text-foreground md:text-sm" />
          </label>
          <label className="text-xs font-medium text-muted-foreground">
            Registered until
            <input type="date" name="to" defaultValue={active.to} className="mt-1 block h-10 w-full rounded-lg border border-border bg-background px-2 text-base text-foreground md:text-sm" />
          </label>
          <div className="col-span-2 flex gap-2 sm:col-span-4">
            <button type="submit" className="h-10 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground">Apply filters</button>
            {filtered && (
              <Link href={search ? `/admin?q=${encodeURIComponent(search)}` : '/admin'} className="flex h-10 items-center rounded-lg border border-border px-4 text-sm text-foreground hover:bg-secondary">
                Clear
              </Link>
            )}
          </div>
        </form>
      </details>

      <p className="mt-4 text-sm text-muted-foreground" aria-live="polite">
        {search || filtered ? `${total} matching${search ? ` “${search}”` : ''}${filtered ? ' the filters' : ''}` : `${total} registered`} · page {page} of {pages}
        {(search || filtered) && (
          <>
            {' · '}
            <Link href="/admin" className="text-primary underline-offset-2 hover:underline">Show all</Link>
          </>
        )}
      </p>

      {rows.length === 0 ? (
        <p className="mt-4 rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">No accounts match that search.</p>
      ) : (
        <>
          {/* Phones: one card per account. */}
          <ul className="mt-3 space-y-2 md:hidden" aria-label="Accounts">
            {rows.map((u) => (
              <li key={u.id}>
                <Link href={`/admin/users/${u.id}`} className="flex items-center gap-3 rounded-xl border border-border bg-card p-3 active:bg-secondary/40">
                  <AccountAvatar account={{ name: u.name, email: u.email, image: u.image }} size={40} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-foreground">{u.name}</p>
                    <p className="truncate text-xs text-muted-foreground">{u.email}</p>
                    <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                      <Badges user={u} />
                      <span className="text-[11px] text-muted-foreground">Last login {dateOnly(u.lastLoginAt)}</span>
                    </div>
                  </div>
                  <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden="true" />
                </Link>
              </li>
            ))}
          </ul>

          {/* Tablets and desktops: a table. */}
          <div className="mt-3 hidden overflow-x-auto rounded-xl border border-border md:block">
            <table className="w-full min-w-[860px] text-left text-sm">
              <thead className="bg-card text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-4 py-3 font-medium">User</th>
                  <th className="px-4 py-3 font-medium">Signs in with</th>
                  <th className="px-4 py-3 font-medium">Registered</th>
                  <th className="px-4 py-3 font-medium">Last login</th>
                  <th className="px-4 py-3 font-medium">Role</th>
                  <th className="px-4 py-3 font-medium">Plan</th>
                  <th className="px-4 py-3 font-medium">Subscription</th>
                  <th className="px-4 py-3 text-right font-medium">Sign-ins</th>
                  <th className="px-4 py-3 text-right font-medium">GIFs this month</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {rows.map((u) => (
                  <tr key={u.id} className="hover:bg-secondary/30">
                    <td className="px-4 py-3">
                      <Link href={`/admin/users/${u.id}`} className="flex items-center gap-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                        <AccountAvatar account={{ name: u.name, email: u.email, image: u.image }} size={32} />
                        <span className="min-w-0">
                          <span className="block font-medium text-foreground">{u.name}</span>
                          <span className="block text-xs text-muted-foreground">{u.email}</span>
                        </span>
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">{[u.google.linked ? `Google · ${u.google.idHint}` : null, u.password ? 'Password' : null].filter(Boolean).join(' + ') || '—'}</td>
                    <td className="px-4 py-3 text-muted-foreground">{dateOnly(u.createdAt)}</td>
                    <td className="px-4 py-3 text-muted-foreground">{dateTime(u.lastLoginAt)}</td>
                    <td className="px-4 py-3">{u.role === 'admin' ? 'Admin' : 'User'}{u.status !== 'active' && <span className="ml-1 text-destructive">({u.status})</span>}</td>
                    <td className="px-4 py-3">
                      {PLAN_NAMES[u.effectivePlan]}
                      {u.grant && <span className="ml-1 text-xs text-primary">(given)</span>}
                      {u.testAccount && <span className="ml-1 text-xs text-muted-foreground">· test</span>}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">{u.subscriptionStatus ?? 'none'}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{u.logins}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{u.gifsThisMonth}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {pages > 1 && (
        <nav aria-label="Pages" className="mt-4 flex gap-2 text-sm">
          {page > 1 && <Link className="rounded-lg border border-border px-3 py-1.5 hover:bg-secondary" href={pageLink(page - 1)}>Previous</Link>}
          {page < pages && <Link className="rounded-lg border border-border px-3 py-1.5 hover:bg-secondary" href={pageLink(page + 1)}>Next</Link>}
        </nav>
      )}

      <section aria-labelledby="recent-activity" className="mt-8 rounded-2xl border border-border bg-card p-4 md:p-5">
        <div className="flex items-baseline justify-between gap-3">
          <h2 id="recent-activity" className="text-base font-semibold text-foreground">Recent activity</h2>
          <Link href="/admin/activity" className="text-sm text-primary underline-offset-2 hover:underline">All activity</Link>
        </div>
        <EventList events={recent} viewerId={admin.id.toHexString()} showSubject />
      </section>
    </AdminShell>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="min-w-[4.5rem] rounded-xl border border-border bg-card px-3 py-2">
      <dt className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="text-lg font-semibold tabular-nums text-foreground">{value}</dd>
    </div>
  );
}

function Badges({ user }: { user: AdminUserRow }) {
  return (
    <>
      {user.role === 'admin' && <span className="rounded-full border border-primary/40 bg-primary/10 px-2 py-0.5 text-[11px] font-semibold text-primary">Admin</span>}
      <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${user.effectivePlan === 'pro' ? 'bg-primary text-primary-foreground' : 'border border-border text-foreground'}`}>
        {PLAN_NAMES[user.effectivePlan]}
        {user.grant ? ' (given)' : ''}
      </span>
      {user.status !== 'active' && <span className="rounded-full border border-destructive/50 px-2 py-0.5 text-[11px] text-destructive">{user.status}</span>}
      {user.testAccount && <span className="rounded-full border border-border px-2 py-0.5 text-[11px] text-muted-foreground">test</span>}
    </>
  );
}

function Choice({ name, label, value, options }: { name: string; label: string; value: string | undefined; options: [string, string][] }) {
  return (
    <label className="text-xs font-medium text-muted-foreground">
      {label}
      <select name={name} defaultValue={value ?? ''} className="mt-1 block h-10 w-full rounded-lg border border-border bg-background px-2 text-base text-foreground md:text-sm">
        <option value="">Any</option>
        {options.map(([v, text]) => (
          <option key={v} value={v}>
            {text}
          </option>
        ))}
      </select>
    </label>
  );
}
