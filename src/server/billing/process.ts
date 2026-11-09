import 'server-only';
import type { Db } from 'mongodb';
import { collections, isDuplicateKeyError, toObjectId } from '@/server/db/collections';
import { recordAudit } from '@/server/audit';
import { log } from '@/server/log';
import type { VerifiedPaymentEvent } from './provider';

/**
 * Apply a verified payment event exactly once. The unique (provider, eventId)
 * record is claimed first, so a provider's retries and duplicate deliveries
 * are recognised and skipped; subscription state is then written by the server
 * only, and every change is audited.
 */
export async function processPaymentEvent(db: Db, event: VerifiedPaymentEvent): Promise<'processed' | 'duplicate' | 'ignored'> {
  const { paymentEvents, subscriptions } = collections(db);
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
    paymentEvents.updateOne(
      { provider: event.provider, eventId: event.eventId },
      { $set: { status, processedAt: new Date(), error } },
    );

  try {
    const sub = event.subscription;
    const userId = toObjectId(sub?.userId ?? null);
    if (!sub || !userId) {
      await finish('ignored');
      return 'ignored';
    }
    const now = new Date();
    await subscriptions.updateOne(
      { provider: event.provider, providerSubscriptionId: sub.providerSubscriptionId },
      {
        $set: {
          userId,
          planId: sub.planId,
          providerCustomerId: sub.providerCustomerId,
          status: sub.status,
          currentPeriodStart: sub.currentPeriodStart,
          currentPeriodEnd: sub.currentPeriodEnd,
          cancelAtPeriodEnd: sub.cancelAtPeriodEnd,
          canceledAt: sub.canceledAt,
          updatedAt: now,
        },
        $setOnInsert: { provider: event.provider, providerSubscriptionId: sub.providerSubscriptionId, createdAt: now },
      },
      { upsert: true },
    );
    await recordAudit(db, {
      type: 'subscription.changed',
      userId,
      actor: `webhook:${event.provider}`,
      metadata: { eventType: event.type, planId: sub.planId, status: sub.status },
    });
    await finish('processed');
    return 'processed';
  } catch (error) {
    log.error('billing.event_failed', { provider: event.provider, eventId: event.eventId, error });
    await finish('failed', error instanceof Error ? error.message : 'unknown error');
    throw error;
  }
}
