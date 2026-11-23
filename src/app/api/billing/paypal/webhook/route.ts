import { NextResponse } from 'next/server';
import { getPayPalClient } from '@/server/billing/paypal/client';
import { applyEvent, claimEvent, finishEvent } from '@/server/billing/paypal/subscriptions';
import { MAX_WEBHOOK_BYTES, verifyWebhook, WebhookRejected } from '@/server/billing/paypal/webhook';
import { getDb } from '@/server/db/client';
import { paypalConfig } from '@/server/env';
import { log } from '@/server/log';

// PayPal's notifications (docs/billing/03-paypal.md). Called server to server:
// no session and no CSRF token, only PayPal's signature, which PayPal itself
// confirms for our webhook ID before anything is applied. Answers:
// - 400 for anything that is not a verified PayPal delivery (retrying won't fix it);
// - 503 when PayPal could not confirm it right now (PayPal delivers it again);
// - 200 once the event is applied, or was already;
// - 500 when applying it failed (PayPal retries; the event may then run again).
// Even a verified event only says what to look at: the subscription or
// payment it names is read again from PayPal before anything changes.

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const answer = (status: number) => NextResponse.json({ ok: status === 200 }, { status, headers: { 'cache-control': 'no-store' } });

export async function POST(request: Request) {
  const settings = paypalConfig();
  const client = getPayPalClient();
  if (!settings || !client) return answer(404);
  if (Number(request.headers.get('content-length') ?? 0) > MAX_WEBHOOK_BYTES) return answer(413);
  const raw = await request.text();

  let event;
  try {
    event = await verifyWebhook(client, settings.webhookId, raw, request.headers);
  } catch (error) {
    if (error instanceof WebhookRejected) {
      log.warn('billing.webhook_rejected', { reason: error.reason });
      return answer(400);
    }
    log.error('billing.webhook_unverifiable', { error: error instanceof Error ? error.message : 'unknown' });
    return answer(503);
  }

  const db = getDb();
  if ((await claimEvent(db, event)) === 'duplicate') return answer(200);
  try {
    const outcome = await applyEvent(db, client, event);
    await finishEvent(db, event.id, outcome);
    return answer(200);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown error';
    await finishEvent(db, event.id, 'failed', message);
    log.error('billing.webhook_failed', { event: event.id, type: event.eventType, error: message });
    return answer(500);
  }
}
