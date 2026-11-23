import 'server-only';
import type { Db, ObjectId } from 'mongodb';
import type { BillingSummary } from '@/lib/account';
import { isCurrency, type Currency } from '@/lib/locale';
import { collections } from '@/server/db/collections';
import { currentSubscription } from '@/server/entitlements';
import { paypalConfig } from '@/server/env';
import { latestRate, rateConfirmed, usdToIls } from './fx';
import { basePrice, PROVIDER } from './paypal/subscriptions';

const money = (value: unknown): Currency => (isCurrency(value) ? value : 'USD');

/**
 * Billing as the account page shows it: whether subscribing is possible, the
 * price in the account's currency (without asking the Bank of Israel: only a
 * rate already confirmed within the hour is used here), the subscription that
 * decides paid access, recent payments and the latest refund request.
 */
export async function billingSummary(db: Db, userId: ObjectId, currency: Currency, now = new Date()): Promise<BillingSummary> {
  const c = collections(db);
  let configured = false;
  try {
    configured = paypalConfig() !== null;
  } catch {
    configured = false;
  }
  const [base, subs, payments, refund] = await Promise.all([
    configured ? basePrice(db) : Promise.resolve(null),
    c.subscriptions.find({ userId, provider: PROVIDER }, { sort: { updatedAt: -1 }, limit: 20 }).toArray(),
    c.payments.find({ userId, provider: PROVIDER }, { sort: { occurredAt: -1 }, limit: 12 }).toArray(),
    c.refundRequests.findOne({ userId }, { sort: { requestedAt: -1 } }),
  ]);
  let offer: BillingSummary['offer'] = null;
  if (base) {
    if (currency === 'USD') offer = { amountMinor: base.amountMinor, currency };
    else {
      const rate = await latestRate(db);
      if (rateConfirmed(rate, now)) offer = { amountMinor: usdToIls(base.amountMinor, rate.rateMicros), currency };
    }
  }
  const sub = currentSubscription(subs, now);
  return {
    available: base !== null,
    offer,
    subscription:
      sub && sub.amountMinor != null
        ? {
            status: sub.status,
            amountMinor: sub.amountMinor,
            currency: money(sub.currency),
            paidThrough: sub.paidThrough?.toISOString() ?? sub.currentPeriodEnd?.toISOString() ?? null,
            nextBillingAt: sub.nextBillingAt?.toISOString() ?? null,
            renewing: sub.providerStatus === 'ACTIVE' || sub.providerStatus === 'SUSPENDED',
            sandbox: sub.environment === 'sandbox',
          }
        : null,
    payments: payments.map((p) => ({ kind: p.kind, status: p.status, amountMinor: p.amountMinor, currency: money(p.currency), at: p.occurredAt.toISOString() })),
    refundRequest: refund ? { status: refund.status, requestedAt: refund.requestedAt.toISOString() } : null,
  };
}
