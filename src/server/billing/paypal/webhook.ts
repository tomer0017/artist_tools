import 'server-only';
import type { PayPalClient } from './client';

// ─── Verifying PayPal webhook deliveries ──────────────────────────────────────
// A delivery is trusted only after PayPal itself confirms its signature
// (POST /v1/notifications/verify-webhook-signature) for our webhook ID. The
// event is sent back exactly as received, byte for byte: PayPal signs the raw
// body, and re-serialized JSON can fail verification. Even a verified event
// is only a pointer: what it says about a subscription or a payment is read
// again from PayPal with our own credentials before anything changes.
//
// Nothing about the payer (name, email, address) is kept from an event: only
// its id, type, time and the ids of what it is about.

/** PayPal events are a few kilobytes; anything far larger is refused unread. */
export const MAX_WEBHOOK_BYTES = 64 * 1024;

export type WebhookRejection = 'too_large' | 'missing_headers' | 'malformed' | 'not_configured' | 'not_verified';

export class WebhookRejected extends Error {
  constructor(readonly reason: WebhookRejection) {
    super(`webhook delivery refused: ${reason.replace('_', ' ')}`);
  }
}

/** A verified PayPal event, reduced to what is needed to look up the current state. */
export interface PayPalWebhookEvent {
  /** PayPal's event id (WH-…): each event is applied once. */
  id: string;
  /** e.g. BILLING.SUBSCRIPTION.ACTIVATED, PAYMENT.SALE.COMPLETED */
  eventType: string;
  createTime: Date | null;
  resourceType: string | null;
  /** What the event is about: a subscription (I-…), sale, plan (P-…) or dispute id. */
  resourceId: string | null;
  /** For a payment: the subscription it belongs to (the sale's billing_agreement_id). */
  subscriptionId: string | null;
  /** For a refund: the payment (sale) it returns money from. */
  saleId: string | null;
  /** For a sale or refund: its amount, as PayPal states it. */
  amount: { value: string; currency: string } | null;
}

const HEADER_NAMES = {
  auth_algo: 'paypal-auth-algo',
  cert_url: 'paypal-cert-url',
  transmission_id: 'paypal-transmission-id',
  transmission_sig: 'paypal-transmission-sig',
  transmission_time: 'paypal-transmission-time',
} as const;

const id = (value: unknown, pattern = /^[A-Za-z0-9_-]{1,64}$/) => (typeof value === 'string' && pattern.test(value) ? value : null);

/** The parts of an event body we use; throws WebhookRejected('malformed') when it is not a PayPal event. */
export function readEvent(rawBody: string): PayPalWebhookEvent {
  let body: { id?: unknown; event_type?: unknown; create_time?: unknown; resource_type?: unknown; resource?: Record<string, unknown> };
  try {
    body = JSON.parse(rawBody) as typeof body;
  } catch {
    throw new WebhookRejected('malformed');
  }
  const eventId = id(body?.id);
  const eventType = typeof body?.event_type === 'string' && /^[A-Z0-9_.-]{3,80}$/.test(body.event_type) ? body.event_type : null;
  if (!eventId || !eventType || typeof body.resource !== 'object' || body.resource === null) throw new WebhookRejected('malformed');
  const created = typeof body.create_time === 'string' ? new Date(body.create_time) : null;
  const resource = body.resource;
  const isSale = eventType.startsWith('PAYMENT.SALE.');
  // A v1 sale or refund states its amount as { total, currency }.
  const money = resource.amount as { total?: unknown; currency?: unknown } | undefined;
  const amount =
    isSale && typeof money?.total === 'string' && /^\d{1,9}(\.\d{1,2})?$/.test(money.total) && typeof money.currency === 'string' && /^[A-Z]{3}$/.test(money.currency)
      ? { value: money.total, currency: money.currency }
      : null;
  return {
    id: eventId,
    eventType,
    createTime: created && !Number.isNaN(created.getTime()) ? created : null,
    resourceType: id(body.resource_type),
    resourceId: id(resource.id) ?? id(resource.dispute_id),
    subscriptionId: isSale ? id(resource.billing_agreement_id) : eventType.startsWith('BILLING.SUBSCRIPTION.') ? id(resource.id) : null,
    saleId: isSale ? id(resource.sale_id) : null,
    amount,
  };
}

/**
 * Verify one delivery with PayPal and return its event. Throws WebhookRejected
 * for anything that must never be applied (answer 400: PayPal will not fix it
 * by retrying), and PayPalError / PayPalUnavailable when PayPal could not
 * verify it right now (answer 5xx, so PayPal delivers it again later).
 */
export async function verifyWebhook(
  client: PayPalClient,
  webhookId: string | null,
  rawBody: string,
  headers: Headers,
): Promise<PayPalWebhookEvent> {
  if (Buffer.byteLength(rawBody, 'utf8') > MAX_WEBHOOK_BYTES) throw new WebhookRejected('too_large');
  if (!webhookId) throw new WebhookRejected('not_configured');
  const values = Object.fromEntries(Object.entries(HEADER_NAMES).map(([field, header]) => [field, headers.get(header)?.trim() ?? ''])) as Record<keyof typeof HEADER_NAMES, string>;
  if (Object.values(values).some((value) => value === '' || value.length > 2048)) throw new WebhookRejected('missing_headers');
  let certHost = '';
  try {
    const cert = new URL(values.cert_url);
    certHost = cert.protocol === 'https:' ? cert.hostname : '';
  } catch {
    // Handled below.
  }
  // PayPal fetches the certificate itself when it verifies; one that is not PayPal's is refused here already.
  if (!/(^|\.)paypal\.com$/.test(certHost)) throw new WebhookRejected('not_verified');
  const event = readEvent(rawBody);

  // The event goes back verbatim inside an otherwise ordinary JSON body.
  const fields = Object.entries({ ...values, webhook_id: webhookId })
    .map(([field, value]) => `${JSON.stringify(field)}:${JSON.stringify(value)}`)
    .join(',');
  const answer = await client.request<{ verification_status?: unknown }>('POST', '/v1/notifications/verify-webhook-signature', {
    rawJson: `{${fields},"webhook_event":${rawBody}}`,
    repeatable: true,
  });
  if (answer?.verification_status !== 'SUCCESS') throw new WebhookRejected('not_verified');
  return event;
}
