// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { createPayPalClient, PayPalError } from './client';
import { MAX_WEBHOOK_BYTES, readEvent, verifyWebhook, WebhookRejected } from './webhook';

const SETTINGS = { environment: 'sandbox' as const, apiBase: 'https://api-m.sandbox.paypal.com', clientId: 'client-id-0123456789abcdef', clientSecret: 'client-secret-0123456789abcdef', webhookId: '1JE4291016473214C' };
const TOKEN = () => new Response(JSON.stringify({ access_token: 'A21AAtoken0001', expires_in: 32400, scope: '' }), { status: 200 });

// A sale event as PayPal sends it: key order and spacing are PayPal's, and must reach the verification untouched.
const SALE_EVENT = `{"id":"WH-7Y7254563A4550640-11V2185806837105M","event_version":"1.0","create_time":"2026-11-23T10:00:05.000Z","resource_type":"sale","event_type":"PAYMENT.SALE.COMPLETED","summary":"Payment completed for ILS 33.43 ILS",
 "resource":{"billing_agreement_id":"I-BW452GLLEP1G","amount":{"total":"33.43","currency":"ILS"},"payment_mode":"INSTANT_TRANSFER","state":"completed","id":"80021663DE681814L","payer_email":"buyer@example.com"}}`;

const HEADERS = () =>
  new Headers({
    'paypal-auth-algo': 'SHA256withRSA',
    'paypal-cert-url': 'https://api.sandbox.paypal.com/v1/notifications/certs/CERT-360caa42-fca2a594-a5cafa77',
    'paypal-transmission-id': '103e3700-8b0c-11ef-9f8b-3d6c2b5f1c11',
    'paypal-transmission-sig': 'aBcD+signature/value==',
    'paypal-transmission-time': '2026-11-23T10:00:06Z',
  });

function paypal(verifyReplies: (Response | Error)[]) {
  const verifyBodies: string[] = [];
  const fetch = (async (input: string | URL, init: RequestInit = {}) => {
    const path = new URL(String(input)).pathname;
    if (path === '/v1/oauth2/token') return TOKEN();
    if (path === '/v1/notifications/verify-webhook-signature') {
      verifyBodies.push(String(init.body));
      const next = verifyReplies.shift();
      if (!next) throw new Error('no more replies');
      if (next instanceof Error) throw next;
      return next;
    }
    throw new Error(`unexpected call to ${path}`);
  }) as typeof globalThis.fetch;
  return { client: createPayPalClient(SETTINGS, { fetch, sleep: async () => {} }), verifyBodies };
}
const verdict = (status: string) => new Response(JSON.stringify({ verification_status: status }), { status: 200 });

describe('PayPal webhook verification', () => {
  it('has PayPal check the signature over the exact body, then keeps only ids and the type', async () => {
    const { client, verifyBodies } = paypal([verdict('SUCCESS')]);
    const event = await verifyWebhook(client, SETTINGS.webhookId, SALE_EVENT, HEADERS());
    expect(event).toEqual({
      id: 'WH-7Y7254563A4550640-11V2185806837105M',
      eventType: 'PAYMENT.SALE.COMPLETED',
      createTime: new Date('2026-11-23T10:00:05.000Z'),
      resourceType: 'sale',
      resourceId: '80021663DE681814L',
      subscriptionId: 'I-BW452GLLEP1G',
      saleId: null,
      amount: { value: '33.43', currency: 'ILS' },
    });
    expect(JSON.stringify(event)).not.toContain('buyer@example.com');
    // The event travels verbatim: PayPal's own spacing and key order, not a re-serialized copy.
    expect(verifyBodies[0]).toContain(`"webhook_event":${SALE_EVENT}}`);
    expect(JSON.parse(verifyBodies[0])).toMatchObject({
      auth_algo: 'SHA256withRSA',
      transmission_id: '103e3700-8b0c-11ef-9f8b-3d6c2b5f1c11',
      transmission_sig: 'aBcD+signature/value==',
      transmission_time: '2026-11-23T10:00:06Z',
      webhook_id: '1JE4291016473214C',
    });
  });

  it('refuses what PayPal does not confirm', async () => {
    const { client } = paypal([verdict('FAILURE')]);
    await expect(verifyWebhook(client, SETTINGS.webhookId, SALE_EVENT, HEADERS())).rejects.toMatchObject({ reason: 'not_verified' });
  });

  it('refuses without asking PayPal what cannot be a PayPal delivery', async () => {
    const { client, verifyBodies } = paypal([]);
    const without = HEADERS();
    without.delete('paypal-transmission-sig');
    const reasons = async (body: string, headers: Headers, webhookId: string | null = SETTINGS.webhookId) =>
      ((await verifyWebhook(client, webhookId, body, headers).catch((e) => e)) as WebhookRejected).reason;
    expect(await reasons(SALE_EVENT, without)).toBe('missing_headers');
    const foreignCert = HEADERS();
    foreignCert.set('paypal-cert-url', 'https://paypal.com.attacker.example/cert.pem');
    expect(await reasons(SALE_EVENT, foreignCert)).toBe('not_verified');
    const plainHttp = HEADERS();
    plainHttp.set('paypal-cert-url', 'http://api.paypal.com/v1/notifications/certs/CERT-1');
    expect(await reasons(SALE_EVENT, plainHttp)).toBe('not_verified');
    expect(await reasons('{"not":"an event"}', HEADERS())).toBe('malformed');
    expect(await reasons('x'.repeat(MAX_WEBHOOK_BYTES + 1), HEADERS())).toBe('too_large');
    // Without our webhook ID nothing can be verified, so nothing is applied.
    expect(await reasons(SALE_EVENT, HEADERS(), null)).toBe('not_configured');
    expect(verifyBodies).toHaveLength(0);
  });

  it('lets PayPal deliver again later when it cannot verify right now', async () => {
    const down = () => new Response(JSON.stringify({ name: 'INTERNAL_SERVICE_ERROR' }), { status: 503 });
    const { client, verifyBodies } = paypal([down(), down(), down()]);
    const error = await verifyWebhook(client, SETTINGS.webhookId, SALE_EVENT, HEADERS()).catch((e) => e);
    expect(error).toBeInstanceOf(PayPalError);
    expect(error).not.toBeInstanceOf(WebhookRejected);
    expect(verifyBodies).toHaveLength(3);
  });

  it('reads the ids subscription and dispute events are about', () => {
    expect(readEvent('{"id":"WH-1","event_type":"BILLING.SUBSCRIPTION.CANCELLED","resource_type":"subscription","resource":{"id":"I-BW452GLLEP1G","status":"CANCELLED"}}')).toMatchObject({
      resourceId: 'I-BW452GLLEP1G',
      subscriptionId: 'I-BW452GLLEP1G',
    });
    expect(readEvent('{"id":"WH-2","event_type":"CUSTOMER.DISPUTE.CREATED","resource_type":"dispute","resource":{"dispute_id":"PP-D-27803"}}')).toMatchObject({
      resourceId: 'PP-D-27803',
      subscriptionId: null,
    });
  });
});
