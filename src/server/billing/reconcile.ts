import 'server-only';
import type { Db } from 'mongodb';
import { recordAudit } from '@/server/audit';
import { collections, type ReconciliationRunDoc } from '@/server/db/collections';
import type { PaymentProvider } from './provider';

// ─── Reconciliation ───────────────────────────────────────────────────────────
// Webhooks can be missed or delayed, so subscriptions are periodically
// compared with what the provider itself reports, and ours are corrected to
// match (the provider is the source of truth for billing state). Each fix is
// audited, and each run is kept with what it checked, changed and could not
// find at the provider.

const FIELDS = ['status', 'currentPeriodEnd', 'cancelAtPeriodEnd', 'priceId'] as const;
const show = (value: unknown) => (value instanceof Date ? value.toISOString() : value === null || value === undefined ? null : String(value));

export async function reconcileSubscriptions(
  db: Db,
  provider: Pick<PaymentProvider, 'id' | 'fetchSubscription'>,
  actor: string,
  now = new Date(),
): Promise<ReconciliationRunDoc> {
  const { subscriptions, reconciliationRuns } = collections(db);
  const run: ReconciliationRunDoc = { provider: provider.id, startedAt: now, finishedAt: null, checked: 0, fixed: [], missing: [], actor };
  // Live subscriptions, and recently ended ones (a missed renewal or reactivation).
  const recent = new Date(now.getTime() - 90 * 86_400_000);
  const ours = await subscriptions
    .find({ provider: provider.id, providerSubscriptionId: { $type: 'string' }, $or: [{ status: { $in: ['trialing', 'active', 'past_due'] } }, { updatedAt: { $gte: recent } }] })
    .toArray();
  for (const sub of ours) {
    const theirs = await provider.fetchSubscription(sub.providerSubscriptionId!);
    run.checked += 1;
    if (!theirs) {
      // Unknown to the provider: left as it is for an admin to look into (it may be a provider-side problem).
      run.missing.push(sub.providerSubscriptionId!);
      continue;
    }
    const changes: Record<string, unknown> = {};
    for (const field of FIELDS) {
      const a = show(sub[field]);
      const b = show(theirs[field]);
      if (a !== b) {
        changes[field] = theirs[field] ?? null;
        run.fixed.push({ providerSubscriptionId: sub.providerSubscriptionId!, field, ours: a, theirs: b });
      }
    }
    if (Object.keys(changes).length === 0) continue;
    await subscriptions.updateOne({ _id: sub._id }, { $set: { ...changes, lastEventAt: now, updatedAt: now } });
    await recordAudit(db, {
      type: 'billing.reconciled',
      userId: sub.userId,
      actor,
      metadata: { provider: provider.id, fields: Object.keys(changes).join(','), status: String(changes.status ?? sub.status) },
    });
  }
  run.finishedAt = new Date();
  await reconciliationRuns.insertOne(run);
  return run;
}
