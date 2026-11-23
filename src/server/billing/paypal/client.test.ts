// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { createPayPalClient, PayPalError, PayPalUnavailable } from './client';

const SETTINGS = {
  environment: 'sandbox' as const,
  apiBase: 'https://api-m.sandbox.paypal.com',
  clientId: 'client-id-0123456789abcdef',
  clientSecret: 'client-secret-0123456789abcdef',
  webhookId: null,
};
const TOKEN_REPLY = (token = 'A21AAtoken0001', expiresIn = 32400) =>
  new Response(JSON.stringify({ access_token: token, token_type: 'Bearer', expires_in: expiresIn, scope: 'https://uri.paypal.com/services/subscriptions https://uri.paypal.com/services/reporting/search/read' }), { status: 200 });
const json = (status: number, body: unknown, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers });

/** A scripted PayPal: each call takes the next reply for its path. */
function scripted(replies: Record<string, (Response | Error)[]>) {
  const calls: { url: string; method: string; headers: Record<string, string>; body: string | undefined }[] = [];
  const fetch = (async (input: string | URL, init: RequestInit = {}) => {
    const url = String(input);
    calls.push({ url, method: init.method ?? 'GET', headers: { ...(init.headers as Record<string, string>) }, body: init.body as string | undefined });
    const path = new URL(url).pathname;
    const next = replies[path]?.shift();
    if (!next) throw new Error(`unexpected call to ${path}`);
    if (next instanceof Error) throw next;
    return next;
  }) as typeof globalThis.fetch;
  return { fetch, calls };
}

const noSleep = async () => {};

describe('PayPal client', () => {
  it('gets a token with the client credentials once, and reuses it until shortly before it expires', async () => {
    let clock = 1_000_000;
    const paypal = scripted({
      '/v1/oauth2/token': [TOKEN_REPLY('A21AAfirst00001'), TOKEN_REPLY('A21AAsecond0002')],
      '/v1/billing/plans/P-1': [json(200, { id: 'P-1' }), json(200, { id: 'P-1' }), json(200, { id: 'P-1' })],
    });
    const client = createPayPalClient(SETTINGS, { fetch: paypal.fetch, sleep: noSleep, now: () => clock });
    await client.request('GET', '/v1/billing/plans/P-1');
    await client.request('GET', '/v1/billing/plans/P-1');
    const tokenCalls = paypal.calls.filter((c) => c.url.endsWith('/v1/oauth2/token'));
    expect(tokenCalls).toHaveLength(1);
    expect(tokenCalls[0].headers.authorization).toBe(`Basic ${Buffer.from(`${SETTINGS.clientId}:${SETTINGS.clientSecret}`).toString('base64')}`);
    expect(tokenCalls[0].body).toBe('grant_type=client_credentials');
    expect(paypal.calls[1].headers.authorization).toBe('Bearer A21AAfirst00001');

    // 9 hours later the token is replaced before PayPal would refuse it.
    clock += 9 * 60 * 60 * 1000 - 4 * 60 * 1000;
    await client.request('GET', '/v1/billing/plans/P-1');
    expect(paypal.calls.filter((c) => c.url.endsWith('/v1/oauth2/token'))).toHaveLength(2);
    expect(paypal.calls.at(-1)!.headers.authorization).toBe('Bearer A21AAsecond0002');
  });

  it('reports what the app may do, from the token', async () => {
    const paypal = scripted({ '/v1/oauth2/token': [TOKEN_REPLY()] });
    const client = createPayPalClient(SETTINGS, { fetch: paypal.fetch, sleep: noSleep });
    expect(await client.scopes()).toEqual(['https://uri.paypal.com/services/subscriptions', 'https://uri.paypal.com/services/reporting/search/read']);
  });

  it('repeats reads and keyed writes after a failure, but never a write without a key', async () => {
    const paypal = scripted({
      '/v1/oauth2/token': [TOKEN_REPLY()],
      '/v1/billing/subscriptions/I-1': [json(503, { name: 'SERVICE_UNAVAILABLE' }), new TypeError('fetch failed'), json(200, { id: 'I-1', status: 'ACTIVE' })],
      '/v1/billing/subscriptions': [new TypeError('fetch failed'), json(201, { id: 'I-2' }), json(503, {})],
    });
    const client = createPayPalClient(SETTINGS, { fetch: paypal.fetch, sleep: noSleep });
    expect(await client.request('GET', '/v1/billing/subscriptions/I-1')).toEqual({ id: 'I-1', status: 'ACTIVE' });
    expect(await client.request('POST', '/v1/billing/subscriptions', { body: { plan_id: 'P-1' }, requestId: 'cs_abc' })).toEqual({ id: 'I-2' });
    const keyed = paypal.calls.filter((c) => c.method === 'POST' && c.url.endsWith('/v1/billing/subscriptions'));
    expect(keyed.map((c) => c.headers['paypal-request-id'])).toEqual(['cs_abc', 'cs_abc']);
    // Without a key a failed write is reported at once: PayPal may have acted on it.
    await expect(client.request('POST', '/v1/billing/subscriptions', { body: { plan_id: 'P-1' } })).rejects.toBeInstanceOf(PayPalError);
  });

  it('gets a new token once when PayPal refuses the current one', async () => {
    const paypal = scripted({
      '/v1/oauth2/token': [TOKEN_REPLY('A21AAold0000001'), TOKEN_REPLY('A21AAnew0000002')],
      '/v1/billing/plans/P-1': [json(401, { error: 'invalid_token' }), json(200, { id: 'P-1' })],
    });
    const client = createPayPalClient(SETTINGS, { fetch: paypal.fetch, sleep: noSleep });
    expect(await client.request('GET', '/v1/billing/plans/P-1')).toEqual({ id: 'P-1' });
    expect(paypal.calls.at(-1)!.headers.authorization).toBe('Bearer A21AAnew0000002');
  });

  it("names PayPal's error without anything secret, and does not repeat what cannot succeed", async () => {
    const paypal = scripted({
      '/v1/oauth2/token': [TOKEN_REPLY('A21AAsecret0001')],
      '/v1/billing/subscriptions/I-1/cancel': [
        json(422, { name: 'UNPROCESSABLE_ENTITY', details: [{ issue: 'SUBSCRIPTION_STATUS_INVALID', description: 'Invalid subscription status for cancel action; subscription status should be active or suspended.' }], debug_id: 'f0a1b2c3d4' }),
      ],
    });
    const client = createPayPalClient(SETTINGS, { fetch: paypal.fetch, sleep: noSleep });
    const error = (await client.request('POST', '/v1/billing/subscriptions/I-1/cancel', { body: { reason: 'x' } }).catch((e) => e)) as PayPalError;
    expect(error).toBeInstanceOf(PayPalError);
    expect(error).toMatchObject({ status: 422, errorName: 'UNPROCESSABLE_ENTITY', issue: 'SUBSCRIPTION_STATUS_INVALID', debugId: 'f0a1b2c3d4' });
    expect(error.message).toBe('PayPal answered 422 UNPROCESSABLE_ENTITY (SUBSCRIPTION_STATUS_INVALID)');
    for (const secret of ['A21AAsecret0001', SETTINGS.clientSecret, SETTINGS.clientId]) expect(JSON.stringify({ ...error, message: error.message })).not.toContain(secret);
  });

  it('stops at refused credentials, and says when PayPal cannot be reached at all', async () => {
    const refused = scripted({ '/v1/oauth2/token': [json(401, { error: 'invalid_client', error_description: 'Client Authentication failed' })] });
    const client = createPayPalClient(SETTINGS, { fetch: refused.fetch, sleep: noSleep });
    await expect(client.request('GET', '/v1/billing/plans/P-1')).rejects.toMatchObject({ status: 401, errorName: 'invalid_client' });
    expect(refused.calls).toHaveLength(1);

    const down = scripted({ '/v1/oauth2/token': [new TypeError('fetch failed'), new TypeError('fetch failed'), new TypeError('fetch failed')] });
    const offline = createPayPalClient(SETTINGS, { fetch: down.fetch, sleep: noSleep });
    await expect(offline.request('GET', '/v1/billing/plans/P-1')).rejects.toBeInstanceOf(PayPalUnavailable);
    expect(down.calls).toHaveLength(3);
  });
});
