import 'server-only';
import type { Db, ObjectId } from 'mongodb';
import { collections, type PaymentDoc, type PaymentEventDoc, type ReconciliationRunDoc, type SubscriptionDoc } from '@/server/db/collections';
import { billingMetrics, type BillingMetrics } from './metrics';

// What the admin billing page shows, read-only: the revenue figures, and the
// latest subscriptions, payments, provider events and reconciliation runs,
// each with the account it belongs to.

export interface BillingAccount {
  userId: string;
  email: string | null;
  testAccount: boolean;
}

export interface BillingOverview {
  metrics: BillingMetrics;
  subscriptions: (SubscriptionDoc & { account: BillingAccount })[];
  payments: (PaymentDoc & { account: BillingAccount })[];
  events: PaymentEventDoc[];
  runs: ReconciliationRunDoc[];
}

export async function billingOverview(db: Db, now = new Date(), limit = 20): Promise<BillingOverview> {
  const c = collections(db);
  const [metrics, subscriptions, payments, events, runs] = await Promise.all([
    billingMetrics(db, { now }),
    c.subscriptions.find({}, { sort: { updatedAt: -1 }, limit }).toArray(),
    c.payments.find({}, { sort: { occurredAt: -1 }, limit }).toArray(),
    c.paymentEvents.find({}, { sort: { receivedAt: -1 }, limit }).toArray(),
    c.reconciliationRuns.find({}, { sort: { startedAt: -1 }, limit: 10 }).toArray(),
  ]);
  const ids: ObjectId[] = [...subscriptions, ...payments].map((d) => d.userId);
  const people = ids.length ? await c.users.find({ _id: { $in: ids } }, { projection: { email: 1, testAccount: 1 } }).toArray() : [];
  const byId = new Map(people.map((u) => [u._id.toHexString(), u]));
  const account = (userId: ObjectId): BillingAccount => {
    const user = byId.get(userId.toHexString());
    return { userId: userId.toHexString(), email: user?.email ?? null, testAccount: Boolean(user?.testAccount) };
  };
  return {
    metrics,
    subscriptions: subscriptions.map((s) => ({ ...s, account: account(s.userId) })),
    payments: payments.map((p) => ({ ...p, account: account(p.userId) })),
    events,
    runs,
  };
}
