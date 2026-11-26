import type { Metadata } from 'next';
import { formatMoney } from '@/lib/money';
import { signInMethods } from '@/server/account-management';
import { mayChangeRoles } from '@/server/admin';
import { formatRate, latestRate, rateConfirmed, usdToIls } from '@/server/billing/fx';
import { PricingSchema, pricingSpec, type Pricing } from '@/server/config/pricing';
import { getDraft, getPublished, listVersions } from '@/server/config/versions';
import { getDb } from '@/server/db/client';
import { collections } from '@/server/db/collections';
import { paypalConfig } from '@/server/env';
import { requireAdmin } from '@/server/session';
import { AdminShell } from '../AdminShell';
import { DraftBar, VersionHistory } from '../ConfigControls';
import { dateTime, publishedByLabel } from '../format';
import { BASE_PRICE_ID, BasePriceEditor } from './BasePriceEditor';

// The monthly Pro price in USD (docs/billing/03-paypal.md), versioned like
// every setting. Customers paying in shekels are charged it converted at the
// Bank of Israel's latest representative rate on the day they subscribe, and
// every subscriber keeps the amount they agreed to: a new price applies only
// to new subscriptions.

export const metadata: Metadata = { title: 'Pricing · SketchyArtLab admin', robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';

const usdOf = (pricing: Pricing) => pricing.prices.find((p) => p.planId === 'pro' && p.interval === 'month' && p.currency === 'USD' && p.active) ?? null;
const label = (pricing: Pricing) => {
  const usd = usdOf(pricing);
  return usd ? `${formatMoney(usd.amountMinor, 'USD')} a month` : 'no price';
};

function changes(live: Pricing, next: Pricing): string[] {
  const before = label(live);
  const after = label(next);
  const out = before === after ? [] : [`Monthly Pro price: ${before} → ${after}`];
  const dropped = live.prices.filter((p) => p.id !== BASE_PRICE_ID && !next.prices.some((n) => n.id === p.id));
  if (dropped.length) out.push(`Removes ${dropped.length} older price ${dropped.length === 1 ? 'entry' : 'entries'} (yearly or per currency) that checkout does not use`);
  return out;
}

function paypalSettings() {
  try {
    return { settings: paypalConfig(), problem: null as string | null };
  } catch (error) {
    return { settings: null, problem: error instanceof Error ? error.message : 'unreadable' };
  }
}

export default async function AdminPricingPage() {
  const admin = await requireAdmin('/admin/pricing');
  const db = getDb();
  const now = new Date();
  const [published, draft, versions, methods, ownerOk, plans, rate, bySubscription] = await Promise.all([
    getPublished(db, pricingSpec),
    getDraft(db, pricingSpec),
    listVersions(db, 'pricing'),
    signInMethods(db, admin.id),
    mayChangeRoles(db, admin.id),
    collections(db).billingPlans.find({ provider: 'paypal' }).sort({ environment: 1, currency: 1 }).toArray(),
    latestRate(db),
    collections(db)
      .subscriptions.aggregate<{ _id: { currency: string; amountMinor: number; basePriceMinor: number | null }; renewing: number; stopped: number; other: number }>([
        { $match: { provider: 'paypal', amountMinor: { $type: 'number' } } },
        {
          $group: {
            _id: { currency: '$currency', amountMinor: '$amountMinor', basePriceMinor: '$basePriceMinor' },
            renewing: { $sum: { $cond: [{ $in: ['$providerStatus', ['ACTIVE', 'SUSPENDED']] }, 1, 0] } },
            stopped: { $sum: { $cond: [{ $and: [{ $eq: ['$status', 'canceled'] }, { $gt: ['$paidThrough', now] }] }, 1, 0] } },
            other: { $sum: 1 },
          },
        },
        { $sort: { '_id.currency': 1, '_id.amountMinor': 1 } },
      ])
      .toArray(),
  ]);
  const live: Pricing = published ? PricingSchema.parse(published.document) : pricingSpec.defaults();
  const parsedDraft = draft ? PricingSchema.safeParse(draft.document) : null;
  const working = parsedDraft?.success ? parsedDraft.data : live;
  const liveUsd = usdOf(live);
  const { settings, problem } = paypalSettings();
  const confirmed = rateConfirmed(rate, now);

  return (
    <AdminShell active="pricing">
      <h1 className="mt-6 text-2xl font-bold tracking-tight text-foreground">Pricing</h1>
      <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
        One monthly Pro price, in USD. Customers whose currency is ILS pay it converted at the Bank of Israel&apos;s latest representative rate on the day they
        subscribe. A new price applies to new subscriptions only: every subscriber keeps the amount they agreed to.
        {!ownerOk && ' Only the owner can change it.'}
      </p>
      <div className="mt-4">
        <DraftBar
          kind="pricing"
          draftVersion={draft?.version ?? null}
          publishedVersion={published?.version ?? null}
          changes={draft ? changes(live, working) : []}
          viewer={{ email: admin.user.email, hasPassword: methods.password !== null, returnTo: '/admin/pricing' }}
        />
      </div>
      <BasePriceEditor key={draft ? `draft-${draft.version}` : `live-${published?.version ?? 0}`} amountMinor={usdOf(working)?.amountMinor ?? null} editable={draft !== null && ownerOk} />

      <section aria-labelledby="paypal-status" className="mt-4 rounded-2xl border border-border bg-card p-4 md:p-5">
        <h2 id="paypal-status" className="text-base font-semibold text-foreground">
          PayPal and the shekel price
        </h2>
        <dl className="mt-3 grid gap-x-6 gap-y-1 text-sm sm:grid-cols-[max-content_1fr]">
          <dt className="text-muted-foreground">PayPal</dt>
          <dd className="text-foreground">{problem ? `Misconfigured: ${problem}` : settings ? (settings.environment === 'live' ? 'Live (real payments)' : 'Sandbox (test payments only)') : 'Not set up on this server'}</dd>
          <dt className="text-muted-foreground">Webhook</dt>
          <dd className="text-foreground">{settings ? (settings.webhookId ? `Registered (${settings.webhookId})` : 'Not registered yet') : '—'}</dd>
          <dt className="text-muted-foreground">Bank of Israel rate</dt>
          <dd className="text-foreground">
            {rate ? `${formatRate(rate.rateMicros)} (published ${rate.date})${confirmed ? '' : ' — not confirmed in the last hour: ILS checkout is paused'}` : 'Not read yet'}
            {rate?.checkedAt && <span className="text-muted-foreground"> · checked {dateTime(rate.checkedAt)}</span>}
          </dd>
          <dt className="text-muted-foreground">Today in ILS</dt>
          <dd className="text-foreground">{liveUsd && rate ? `${formatMoney(usdToIls(liveUsd.amountMinor, rate.rateMicros), 'ILS')} a month for new subscribers` : '—'}</dd>
        </dl>
        <h3 className="mt-4 text-sm font-semibold text-foreground">PayPal plans</h3>
        {plans.length === 0 ? (
          <p className="mt-1 text-sm text-muted-foreground">None yet: they are created on the first checkout, or with npm run db -- paypal-setup.</p>
        ) : (
          <ul className="mt-1 space-y-1 text-sm">
            {plans.map((p) => (
              <li key={p._id} className="break-all text-foreground">
                {p.environment} · {p.currency} · <code>{p.planId}</code> · {p.status} <span className="text-muted-foreground">· checked {dateTime(p.checkedAt)}</span>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-2 text-xs text-muted-foreground">
          One plan per currency; each subscription holds its own agreed price. Never edit these plans&apos; prices in PayPal&apos;s dashboard.
        </p>
        <h3 className="mt-4 text-sm font-semibold text-foreground">Subscriptions by agreed price</h3>
        {bySubscription.length === 0 ? (
          <p className="mt-1 text-sm text-muted-foreground">No subscriptions yet.</p>
        ) : (
          <ul className="mt-1 space-y-1 text-sm">
            {bySubscription.map((row) => (
              <li key={`${row._id.currency}-${row._id.amountMinor}-${row._id.basePriceMinor}`} className="text-foreground">
                {formatMoney(row._id.amountMinor, row._id.currency as 'USD')} a month
                {row._id.basePriceMinor !== null && row._id.currency !== 'USD' ? ` (from ${formatMoney(row._id.basePriceMinor, 'USD')})` : ''}: {row.renewing} renewing, {row.stopped} stopped with Pro left, {row.other} in all
              </li>
            ))}
          </ul>
        )}
      </section>

      <VersionHistory
        kind="pricing"
        versions={versions.map((v) => ({ version: v.version, status: v.status as 'published' | 'archived', publishedAt: v.publishedAt?.toISOString() ?? null, publishedBy: publishedByLabel(v.publishedBy, admin.id.toHexString()), note: v.note }))}
      />
    </AdminShell>
  );
}
