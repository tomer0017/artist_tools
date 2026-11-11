import type { Metadata } from 'next';
import Link from 'next/link';
import { PlugZap } from 'lucide-react';
import { formatMoney } from '@/lib/money';
import { PLAN_NAMES, isPlanId } from '@/lib/plans';
import { billingOverview, type BillingAccount } from '@/server/billing/overview';
import { getDb } from '@/server/db/client';
import { requireAdmin } from '@/server/session';
import { AdminShell } from '../AdminShell';
import { Tile, moneyList } from '../figures';
import { dateOnly, dateTime } from '../format';

// Billing, read-only (docs/billing/02-architecture.md): revenue figures and
// the latest subscriptions, payments, provider events and reconciliation
// runs, exactly as verified provider events recorded them. Nothing on this
// page changes billing, and no payment provider is connected yet.

export const metadata: Metadata = { title: 'Billing · Studio Companion admin', robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';

const money = (amountMinor: number | null | undefined, currency: string | null | undefined) =>
  typeof amountMinor === 'number' && currency ? formatMoney(amountMinor, currency as 'USD') : '—';

function Account({ account }: { account: BillingAccount }) {
  return (
    <span className="min-w-0 break-all">
      <Link href={`/admin/users/${account.userId}`} className="font-medium text-foreground underline-offset-2 hover:underline">
        {account.email ?? 'Deleted account'}
      </Link>
      {account.testAccount && <span className="ms-2 rounded-full border border-border px-2 py-0.5 text-[11px] text-muted-foreground">test</span>}
    </span>
  );
}

function Section({ id, title, empty, count, children }: { id: string; title: string; empty: string; count: number; children: React.ReactNode }) {
  return (
    <section aria-labelledby={id} className="mt-6 rounded-2xl border border-border bg-card p-4 md:p-5">
      <h2 id={id} className="text-base font-semibold text-foreground">
        {title}
      </h2>
      {count === 0 ? <p className="mt-2 text-sm text-muted-foreground">{empty}</p> : children}
    </section>
  );
}

export default async function AdminBillingPage() {
  const admin = await requireAdmin('/admin/billing');
  const { metrics: m, subscriptions, payments, events, runs } = await billingOverview(getDb());
  const viewer = `admin:${admin.id.toHexString()}`;

  return (
    <AdminShell active="billing">
      <h1 className="mt-6 text-2xl font-bold tracking-tight text-foreground">Billing</h1>
      <div className="mt-3 flex items-start gap-3 rounded-xl border border-primary/30 bg-primary/5 p-4 text-sm text-foreground">
        <PlugZap className="mt-0.5 h-5 w-5 shrink-0 text-primary" aria-hidden="true" />
        <p>
          <strong>No payment provider is connected yet</strong>, so nobody can pay and nothing here changes anyone&apos;s plan. Once a provider is chosen
          and connected, this page shows what its verified notifications recorded: subscriptions, payments and refunds. Amounts stay in the currency
          they were paid in.
        </p>
      </div>

      <section aria-label="Headline figures" className="mt-4 grid grid-cols-2 gap-2 md:grid-cols-4">
        <Tile label="MRR" value={moneyList(m.mrrMinor)} detail="Monthly recurring revenue" />
        <Tile label="ARR" value={moneyList(m.arrMinor)} />
        <Tile label="Active" value={m.subscriptions.active} detail={`${m.subscriptions.trialing} on trial · ${m.subscriptions.pastDue} past due`} />
        <Tile label="Cancelling" value={m.subscriptions.cancelingAtPeriodEnd} detail="At the end of the period" />
        <Tile label="Ended (30 d)" value={m.last30Days.ended} detail={m.last30Days.churnRate === null ? undefined : `churn ${(m.last30Days.churnRate * 100).toFixed(1)}%`} />
        <Tile label="Refunds (30 d)" value={m.last30Days.refunds.count} detail={m.last30Days.refunds.count ? moneyList(m.last30Days.refunds.amountMinor) : undefined} />
        <Tile label="Failed payments (30 d)" value={m.last30Days.failedPayments} />
        <Tile label="Disputes (30 d)" value={m.last30Days.chargebacks} />
      </section>
      <p className="mt-2 text-xs text-muted-foreground">Test accounts are left out of these figures; they are marked in the lists below.</p>

      <Section id="subscriptions-heading" title="Subscriptions" empty="No subscriptions yet." count={subscriptions.length}>
        <ul aria-labelledby="subscriptions-heading" className="mt-3 divide-y divide-border">
          {subscriptions.map((s) => (
            <li key={s._id!.toHexString()} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-2.5 text-sm">
              <Account account={s.account} />
              <span className="text-muted-foreground">
                {isPlanId(s.planId) ? PLAN_NAMES[s.planId] : s.planId}
                {s.interval ? ` · ${s.interval === 'year' ? 'yearly' : 'monthly'}` : ''} · {money(s.amountMinor, s.currency)}
              </span>
              <span className="w-full text-xs text-muted-foreground">
                <span className="font-medium text-foreground">{s.status.replace('_', ' ')}</span>
                {s.cancelAtPeriodEnd ? ` · ends ${dateOnly(s.currentPeriodEnd)}` : s.currentPeriodEnd ? ` · renews ${dateOnly(s.currentPeriodEnd)}` : ''}
                {` · ${s.provider} ${s.providerSubscriptionId ?? ''} · updated ${dateTime(s.updatedAt)}`}
              </span>
            </li>
          ))}
        </ul>
      </Section>

      <Section id="payments-heading" title="Payments and refunds" empty="No payments yet." count={payments.length}>
        <ul aria-labelledby="payments-heading" className="mt-3 divide-y divide-border">
          {payments.map((p) => (
            <li key={p._id!.toHexString()} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-2.5 text-sm">
              <Account account={p.account} />
              <span className="tabular-nums text-foreground">
                {p.kind === 'refund' ? 'Refund' : p.kind === 'chargeback' ? 'Dispute' : 'Charge'} {money(p.amountMinor, p.currency)}
                {p.status === 'failed' && <span className="ms-1 font-semibold text-destructive">failed</span>}
              </span>
              <span className="w-full text-xs text-muted-foreground">
                {dateTime(p.occurredAt)} · {p.provider} {p.providerPaymentId}
                {p.receiptUrl?.startsWith('https://') && (
                  <>
                    {' · '}
                    <a href={p.receiptUrl} rel="noreferrer" target="_blank" className="underline underline-offset-2 hover:text-foreground">
                      receipt
                    </a>
                  </>
                )}
              </span>
            </li>
          ))}
        </ul>
      </Section>

      <Section id="events-heading" title="Notifications from the provider" empty="None received yet." count={events.length}>
        <ul aria-labelledby="events-heading" className="mt-3 divide-y divide-border">
          {events.map((e) => (
            <li key={e._id!.toHexString()} className="py-2.5 text-sm">
              <p className="flex flex-wrap justify-between gap-x-4">
                <span className="break-all font-medium text-foreground">{e.type}</span>
                <span className={e.status === 'failed' ? 'font-semibold text-destructive' : 'text-muted-foreground'}>{e.status}</span>
              </p>
              <p className="break-all text-xs text-muted-foreground">
                {dateTime(e.receivedAt)} · {e.provider} {e.eventId}
                {e.error ? ` · ${e.error}` : ''}
              </p>
            </li>
          ))}
        </ul>
      </Section>

      <Section id="reconciliation-heading" title="Checks against the provider" empty="No checks have run yet." count={runs.length}>
        <ul aria-labelledby="reconciliation-heading" className="mt-3 divide-y divide-border">
          {runs.map((run) => (
            <li key={run._id!.toHexString()} className="py-2.5 text-sm">
              <p className="text-foreground">
                {run.checked} checked · {run.fixed.length} corrected · {run.missing.length} not found at the provider
              </p>
              <p className="text-xs text-muted-foreground">
                {dateTime(run.startedAt)} · {run.provider} · {run.actor === viewer ? 'by you' : run.actor.startsWith('admin:') ? 'by an admin' : 'scheduled'}
              </p>
            </li>
          ))}
        </ul>
      </Section>
    </AdminShell>
  );
}
