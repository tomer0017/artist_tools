import type { Metadata } from 'next';
import { TOOLS } from '@/components/shell/tools';
import { FEATURE_LABELS } from '@/lib/plans';
import { formatMoney } from '@/lib/money';
import { analyticsReport, type DailyPoint } from '@/server/analytics-report';
import { getDb } from '@/server/db/client';
import { requireAdmin } from '@/server/session';
import { AdminShell } from '../AdminShell';

// Product analytics (ADR-0011): registrations, active accounts, tools and
// features used, weekly retention, plans and (once billing is live) revenue.
// First-party data only, test accounts left out, no artwork anywhere.

export const metadata: Metadata = { title: 'Analytics · Studio Companion admin', robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';

const shortDay = (day: string) => new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(`${day}T00:00:00Z`));

function Tile({ label, value, detail }: { label: string; value: string | number; detail?: string }) {
  return (
    <div className="rounded-xl border border-border bg-card p-3">
      <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums text-foreground">{value}</p>
      {detail && <p className="mt-0.5 text-xs text-muted-foreground">{detail}</p>}
    </div>
  );
}

/** One series of daily counts as thin bars on a shared baseline, with a hover label per day and a table view. */
function DailyBars({ title, unit, points }: { title: string; unit: string; points: DailyPoint[] }) {
  const max = Math.max(1, ...points.map((p) => p.value));
  const total = points.reduce((sum, p) => sum + p.value, 0);
  return (
    <figure className="rounded-2xl border border-border bg-card p-4 md:p-5">
      <figcaption className="flex items-baseline justify-between gap-3">
        <span className="text-base font-semibold text-foreground">{title}</span>
        <span className="text-xs text-muted-foreground">
          {total} in 30 days · peak {max === 1 && total === 0 ? 0 : max}
        </span>
      </figcaption>
      <div className="relative mt-4 h-32" aria-hidden="true">
        <div className="absolute inset-x-0 bottom-0 border-t border-border" />
        <div className="absolute inset-0 flex items-end gap-[2px]">
          {points.map((p) => (
            <div key={p.day} title={`${shortDay(p.day)}: ${p.value} ${unit}`} className="flex h-full min-w-0 flex-1 items-end">
              <div className="w-full rounded-t-[4px] bg-primary" style={{ height: p.value === 0 ? 0 : `${Math.max(3, (p.value / max) * 100)}%` }} />
            </div>
          ))}
        </div>
      </div>
      <div className="mt-1 flex justify-between text-[11px] text-muted-foreground" aria-hidden="true">
        <span>{shortDay(points[0].day)}</span>
        <span>{shortDay(points[points.length - 1].day)}</span>
      </div>
      <details className="mt-2 text-xs">
        <summary className="cursor-pointer text-muted-foreground">Show as a table</summary>
        <table className="mt-2 w-full text-left">
          <caption className="sr-only">{title}, per day (UTC)</caption>
          <thead className="text-muted-foreground">
            <tr>
              <th className="py-1 font-medium">Day</th>
              <th className="py-1 text-right font-medium">{unit}</th>
            </tr>
          </thead>
          <tbody>
            {points.map((p) => (
              <tr key={p.day} className="border-t border-border">
                <td className="py-1">{shortDay(p.day)}</td>
                <td className="py-1 text-right tabular-nums">{p.value}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  );
}

export default async function AdminAnalyticsPage() {
  await requireAdmin('/admin/analytics');
  const r = await analyticsReport(getDb());
  const maxToolUsers = Math.max(1, ...r.tools.map((t) => t.users));
  return (
    <AdminShell active="analytics">
      <h1 className="mt-6 text-2xl font-bold tracking-tight text-foreground">Analytics</h1>
      <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
        From Studio Companion&apos;s own records only; {r.accounts.testExcluded} test {r.accounts.testExcluded === 1 ? 'account is' : 'accounts are'} left
        out. Days are UTC. Tool use is counted once per account, tool and day; artwork is never recorded.
      </p>

      <section aria-label="Headline figures" className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Tile label="Accounts" value={r.accounts.total} detail={`${r.accounts.verified} with a verified email`} />
        <Tile label="New in 7 days" value={r.accounts.last7} detail={`${r.accounts.last30} in 30 days`} />
        <Tile label="Active today" value={r.active.today} detail={`${r.active.last7} in 7 days · ${r.active.last30} in 30`} />
        <Tile label="On Pro" value={r.plans.proAssigned + r.plans.proGiven} detail={`${r.plans.proAssigned} assigned · ${r.plans.proGiven} given · ${r.plans.paying} paying`} />
      </section>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <DailyBars title="New accounts" unit="new accounts" points={r.registrations} />
        <DailyBars title="Active accounts" unit="active accounts" points={r.active.daily} />
      </div>

      <section aria-labelledby="tools-heading" className="mt-4 rounded-2xl border border-border bg-card p-4 md:p-5">
        <h2 id="tools-heading" className="text-base font-semibold text-foreground">Tools used, last 30 days</h2>
        <p className="text-xs text-muted-foreground">Accounts that opened each tool; account-days in brackets.</p>
        <ul className="mt-3 space-y-2">
          {r.tools.map((t) => (
            <li key={t.tool} className="grid grid-cols-[8rem_1fr_auto] items-center gap-3 text-sm" title={`${TOOLS[t.tool].title}: ${t.users} accounts, ${t.opens} account-days`}>
              <span className="truncate text-foreground">{TOOLS[t.tool].title}</span>
              <span className="h-3 rounded-r-[4px] bg-primary" style={{ width: `${(t.users / maxToolUsers) * 100}%`, minWidth: t.users ? 4 : 0 }} aria-hidden="true" />
              <span className="tabular-nums text-muted-foreground">
                {t.users} ({t.opens})
              </span>
            </li>
          ))}
        </ul>
      </section>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <section aria-labelledby="features-heading" className="rounded-2xl border border-border bg-card p-4 md:p-5">
          <h2 id="features-heading" className="text-base font-semibold text-foreground">Counted features this month</h2>
          {r.features.length === 0 ? (
            <p className="mt-2 text-sm text-muted-foreground">None used yet this month.</p>
          ) : (
            <table className="mt-2 w-full text-left text-sm">
              <thead className="text-xs text-muted-foreground">
                <tr>
                  <th className="py-1 font-medium">Feature</th>
                  <th className="py-1 text-right font-medium">Uses</th>
                  <th className="py-1 text-right font-medium">Accounts</th>
                </tr>
              </thead>
              <tbody>
                {r.features.map((f) => (
                  <tr key={f.feature} className="border-t border-border">
                    <td className="py-1.5">{FEATURE_LABELS[f.feature]}</td>
                    <td className="py-1.5 text-right tabular-nums">{f.uses}</td>
                    <td className="py-1.5 text-right tabular-nums">{f.users}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        <section aria-labelledby="billing-heading" className="rounded-2xl border border-border bg-card p-4 md:p-5">
          <h2 id="billing-heading" className="text-base font-semibold text-foreground">Revenue</h2>
          <p className="text-xs text-muted-foreground">Billing is not live yet, so these are zero until a payment provider is connected.</p>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <Tile label="MRR" value={formatMoney(r.billing.mrrMinor, 'USD')} />
            <Tile label="ARR" value={formatMoney(r.billing.arrMinor, 'USD')} />
            <Tile label="Cancellations (30 d)" value={r.billing.cancellations30} />
            <Tile label="Refunds / failed (30 d)" value={`${r.billing.refunds30} / ${r.billing.failedPayments30}`} />
          </div>
        </section>
      </div>

      <section aria-labelledby="retention-heading" className="mt-4 overflow-x-auto rounded-2xl border border-border bg-card p-4 md:p-5">
        <h2 id="retention-heading" className="text-base font-semibold text-foreground">Returning accounts by sign-up week</h2>
        <p className="text-xs text-muted-foreground">Of the accounts created each week (Monday, UTC), the share active again 1–4 weeks later.</p>
        <table className="mt-3 w-full min-w-[28rem] text-left text-sm">
          <thead className="text-xs text-muted-foreground">
            <tr>
              <th className="py-1 font-medium">Week of</th>
              <th className="py-1 text-right font-medium">Accounts</th>
              {[1, 2, 3, 4].map((k) => (
                <th key={k} className="py-1 text-center font-medium">
                  Week {k}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {r.retention.map((row) => (
              <tr key={row.week} className="border-t border-border">
                <td className="py-1.5">{shortDay(row.week)}</td>
                <td className="py-1.5 text-right tabular-nums">{row.size}</td>
                {row.weeks.map((pct, k) => (
                  <td key={k} className="p-1 text-center">
                    {pct === null ? (
                      <span className="text-muted-foreground">·</span>
                    ) : (
                      <span
                        className={`block rounded px-1 py-0.5 tabular-nums ${pct >= 60 ? 'text-primary-foreground' : 'text-foreground'}`}
                        style={{ backgroundColor: `hsl(var(--primary) / ${0.12 + (pct / 100) * 0.78})` }}
                      >
                        {pct}%
                      </span>
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </AdminShell>
  );
}
