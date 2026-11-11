import 'server-only';
import type { Db, ObjectId } from 'mongodb';
import { collections } from '@/server/db/collections';

// ─── Revenue figures from subscriptions and payments ──────────────────────────
// Computed only from what verified provider events wrote (never from the
// browser). Amounts stay in their own currency — no exchange-rate conversion
// (docs/adr/0007) — so MRR and ARR are reported per currency. Trials are not
// revenue yet; past-due subscriptions still count until they end. Test
// accounts are left out unless asked for.

const DAY = 86_400_000;

export interface BillingMetrics {
  /** Monthly recurring revenue per currency, in minor units. */
  mrrMinor: Record<string, number>;
  arrMinor: Record<string, number>;
  subscriptions: { active: number; trialing: number; pastDue: number; cancelingAtPeriodEnd: number };
  last30Days: {
    ended: number;
    /** Share of subscriptions that ended, of those live at any point in the window (0–1). */
    churnRate: number | null;
    refunds: { count: number; amountMinor: Record<string, number> };
    failedPayments: number;
    chargebacks: number;
  };
}

export async function billingMetrics(db: Db, options: { now?: Date; includeTestAccounts?: boolean } = {}): Promise<BillingMetrics> {
  const now = options.now ?? new Date();
  const since = new Date(now.getTime() - 30 * DAY);
  const c = collections(db);
  const testIds = options.includeTestAccounts ? [] : ((await c.users.distinct('_id', { testAccount: true })) as ObjectId[]);
  const real = { $nin: testIds };

  const live = await c.subscriptions
    .find({ userId: real, status: { $in: ['active', 'trialing', 'past_due'] } }, { projection: { status: 1, amountMinor: 1, currency: 1, interval: 1, cancelAtPeriodEnd: 1 } })
    .toArray();
  const mrrMinor: Record<string, number> = {};
  for (const s of live) {
    if (s.status === 'trialing' || !s.currency || typeof s.amountMinor !== 'number') continue;
    const monthly = s.interval === 'year' ? Math.round(s.amountMinor / 12) : s.amountMinor;
    mrrMinor[s.currency] = (mrrMinor[s.currency] ?? 0) + monthly;
  }
  const arrMinor = Object.fromEntries(Object.entries(mrrMinor).map(([currency, amount]) => [currency, amount * 12]));

  const ended = await c.subscriptions.countDocuments({
    userId: real,
    $or: [{ endedAt: { $gte: since, $lte: now } }, { status: { $in: ['canceled', 'expired'] }, endedAt: null, updatedAt: { $gte: since } }],
  });
  const exposed = live.length + ended;

  const recentPayments = await c.payments
    .find({ userId: real, occurredAt: { $gte: since, $lte: now } }, { projection: { kind: 1, status: 1, amountMinor: 1, currency: 1 } })
    .toArray();
  const refunds = recentPayments.filter((p) => p.kind === 'refund' && p.status === 'succeeded');
  const refundAmounts: Record<string, number> = {};
  for (const r of refunds) refundAmounts[r.currency] = (refundAmounts[r.currency] ?? 0) + r.amountMinor;

  return {
    mrrMinor,
    arrMinor,
    subscriptions: {
      active: live.filter((s) => s.status === 'active').length,
      trialing: live.filter((s) => s.status === 'trialing').length,
      pastDue: live.filter((s) => s.status === 'past_due').length,
      cancelingAtPeriodEnd: live.filter((s) => s.cancelAtPeriodEnd).length,
    },
    last30Days: {
      ended,
      churnRate: exposed === 0 ? null : ended / exposed,
      refunds: { count: refunds.length, amountMinor: refundAmounts },
      failedPayments: recentPayments.filter((p) => p.kind === 'charge' && p.status === 'failed').length,
      chargebacks: recentPayments.filter((p) => p.kind === 'chargeback').length,
    },
  };
}
