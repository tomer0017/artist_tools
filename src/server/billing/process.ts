import 'server-only';
import type { Db, ObjectId } from 'mongodb';
import { recordAudit } from '@/server/audit';
import { trackEvent } from '@/server/analytics';
import { collections, isDuplicateKeyError, toObjectId } from '@/server/db/collections';
import { log } from '@/server/log';
import type { VerifiedPaymentEvent } from './provider';

export type ProcessResult = 'processed' | 'duplicate' | 'ignored' | 'stale';

/**
 * Apply a verified payment event exactly once (docs/adr/0008). The unique
 * (provider, eventId) record is claimed first, so a provider's retries and
 * duplicate deliveries are recognised and skipped. Subscription state is then
 * written by the server only, never older over newer: an event that happened
 * before the last one applied to that subscription leaves it alone ('stale'),
 * decided by the database in the same write, so concurrent deliveries cannot
 * interleave. Money movements (charges, refunds, chargebacks) are recorded
 * once each by the provider's payment id. A checkout the event completes must
 * belong to the same account. Every change is audited.
 */
export async function processPaymentEvent(db: Db, event: VerifiedPaymentEvent): Promise<ProcessResult> {
  const { paymentEvents, subscriptions, payments, billingCustomers, checkoutSessions } = collections(db);
  try {
    await paymentEvents.insertOne({
      provider: event.provider,
      eventId: event.eventId,
      type: event.type,
      status: 'processing',
      receivedAt: new Date(),
      processedAt: null,
      error: null,
    });
  } catch (error) {
    if (isDuplicateKeyError(error)) return 'duplicate';
    throw error;
  }

  const finish = (status: 'processed' | 'ignored' | 'failed', error: string | null = null) =>
    paymentEvents.updateOne({ provider: event.provider, eventId: event.eventId }, { $set: { status, processedAt: new Date(), error } });

  try {
    const sub = event.subscription;
    const pay = event.payment;
    const subUser = toObjectId(sub?.userId ?? null);
    const payUser = toObjectId(pay?.userId ?? null);
    if ((!sub || !subUser) && (!pay || !payUser)) {
      await finish('ignored');
      return 'ignored';
    }
    const now = new Date();
    const occurredAt = event.occurredAt ?? now;
    let result: ProcessResult = 'processed';

    if (event.checkoutSessionId) {
      const owner = subUser ?? payUser;
      const session = await checkoutSessions.findOne({ _id: event.checkoutSessionId }, { projection: { userId: 1 } });
      if (session && !session.userId.equals(owner)) {
        // Never expected: the provider echoes back what this server attached. Grant nothing; an admin can reconcile.
        log.error('billing.checkout_owner_mismatch', { provider: event.provider, eventId: event.eventId });
        await finish('ignored', 'checkout session belongs to another account');
        return 'ignored';
      }
      if (session) await checkoutSessions.updateOne({ _id: session._id, status: 'open' }, { $set: { status: 'completed', completedAt: now } });
    }

    if (sub && subUser) {
      // Matches only when nothing newer was applied. When the subscription
      // exists but is newer, the upsert's insert hits the unique index; when
      // two first events race to create it, the loser retries as an update.
      const filter = {
        provider: event.provider,
        providerSubscriptionId: sub.providerSubscriptionId,
        $or: [{ lastEventAt: null }, { lastEventAt: { $lte: occurredAt } }],
      };
      const update = {
        $set: {
          userId: subUser,
          planId: sub.planId,
          providerCustomerId: sub.providerCustomerId,
          status: sub.status,
          currentPeriodStart: sub.currentPeriodStart,
          currentPeriodEnd: sub.currentPeriodEnd,
          cancelAtPeriodEnd: sub.cancelAtPeriodEnd,
          canceledAt: sub.canceledAt,
          priceId: sub.priceId ?? null,
          interval: sub.interval ?? null,
          currency: sub.currency ?? null,
          amountMinor: sub.amountMinor ?? null,
          trialEndsAt: sub.trialEndsAt ?? null,
          couponCode: sub.couponCode ?? null,
          endedAt: sub.endedAt ?? null,
          lastEventAt: occurredAt,
          updatedAt: now,
        },
        $setOnInsert: { provider: event.provider, providerSubscriptionId: sub.providerSubscriptionId, createdAt: now },
      };
      const written =
        (await subscriptions.updateOne(filter, update, { upsert: true }).catch((error) => {
          if (isDuplicateKeyError(error)) return null;
          throw error;
        })) ?? (await subscriptions.updateOne(filter, update));
      const created = written.upsertedCount === 1;
      if (!created && written.matchedCount === 0) {
        result = 'stale';
      } else {
        await billingCustomers
          .updateOne(
            { provider: event.provider, userId: subUser },
            { $set: { providerCustomerId: sub.providerCustomerId }, $setOnInsert: { createdAt: now } },
            { upsert: true },
          )
          .catch((error) => {
            if (!isDuplicateKeyError(error)) throw error;
          });
        await recordAudit(db, {
          type: 'subscription.changed',
          userId: subUser,
          actor: `webhook:${event.provider}`,
          metadata: { eventType: event.type, planId: sub.planId, status: sub.status },
        });
        if (sub.status === 'active' || sub.status === 'trialing') {
          await trackEvent(db, { name: 'subscription_converted', userId: subUser, dedupeKey: `subscription_converted:${subUser.toHexString()}` });
        }
        if (sub.couponCode && created) await recordRedemption(db, sub.couponCode, subUser, sub.providerSubscriptionId, occurredAt);
      }
    }

    if (pay && payUser) {
      try {
        await payments.insertOne({
          provider: event.provider,
          providerPaymentId: pay.providerPaymentId,
          userId: payUser,
          providerSubscriptionId: pay.providerSubscriptionId,
          kind: pay.kind,
          status: pay.status,
          amountMinor: pay.amountMinor,
          currency: pay.currency,
          occurredAt: pay.occurredAt,
          receiptUrl: pay.receiptUrl,
          createdAt: now,
        });
        await recordAudit(db, {
          type: 'billing.payment',
          userId: payUser,
          actor: `webhook:${event.provider}`,
          metadata: { kind: pay.kind, status: pay.status, amountMinor: pay.amountMinor, currency: pay.currency },
        });
      } catch (error) {
        // The same payment reported by a second event (e.g. invoice and charge notifications).
        if (!isDuplicateKeyError(error)) throw error;
      }
    }

    await finish('processed', result === 'stale' ? 'older than the subscription state already applied' : null);
    return result;
  } catch (error) {
    log.error('billing.event_failed', { provider: event.provider, eventId: event.eventId, error });
    await finish('failed', error instanceof Error ? error.message : 'unknown error');
    throw error;
  }
}

/** A coupon used by a new subscription, recorded once (limits are counted from these records). */
async function recordRedemption(db: Db, code: string, userId: ObjectId, subscriptionId: string, at: Date) {
  const { coupons, couponRedemptions } = collections(db);
  const coupon = await coupons.findOne({ code: code.trim().toUpperCase() }, { projection: { _id: 1 } });
  if (!coupon) return;
  await couponRedemptions.updateOne(
    { couponId: coupon._id!, userId, subscriptionId },
    { $setOnInsert: { couponId: coupon._id!, userId, subscriptionId, at } },
    { upsert: true },
  );
}
