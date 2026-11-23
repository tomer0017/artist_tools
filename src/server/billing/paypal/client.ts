import 'server-only';
import { createHash } from 'node:crypto';
import { paypalConfig, type PayPalSettings } from '@/server/env';

// ─── PayPal REST client ───────────────────────────────────────────────────────
// Server-side only: the client secret never leaves this process, and the
// access token PayPal returns for it lives in memory until shortly before it
// expires. Neither is ever logged or put in an error message.
//
// Requests time out, and are repeated only when repeating is harmless:
// - reads (GET), and writes that carry a PayPal-Request-Id (PayPal answers a
//   repeat with the first result instead of acting twice);
// - after a network failure, a timeout, 429 or a 5xx answer, a few times
//   with growing pauses;
// - once more with a fresh token after a 401.
// Anything else is answered with a PayPalError that names PayPal's error
// (name, issue, debug id) and nothing the caller sent.

const TOKEN_MARGIN_MS = 5 * 60 * 1000;
const TIMEOUT_MS = 15_000;
const RETRY_PAUSES_MS = [400, 1500];

export class PayPalError extends Error {
  constructor(
    readonly status: number,
    /** PayPal's error name, e.g. UNPROCESSABLE_ENTITY or RESOURCE_NOT_FOUND. */
    readonly errorName: string | null,
    /** The first detail's issue, e.g. SUBSCRIPTION_STATUS_INVALID. */
    readonly issue: string | null,
    /** PayPal's id for the failed call (for their support), safe to log. */
    readonly debugId: string | null,
  ) {
    super(`PayPal answered ${status}${errorName ? ` ${errorName}` : ''}${issue ? ` (${issue})` : ''}`);
  }
}

/** PayPal could not be reached or did not answer in time: nothing is known about the outcome. */
export class PayPalUnavailable extends Error {}

type Method = 'GET' | 'POST' | 'PATCH';

export interface RequestOptions {
  query?: Record<string, string | undefined>;
  body?: unknown;
  /** A JSON body sent exactly as given (e.g. a webhook event that must reach PayPal byte for byte); instead of `body`. */
  rawJson?: string;
  /** The call has no effect at PayPal (e.g. verifying a signature), so repeating it is harmless. */
  repeatable?: boolean;
  /** Makes a write safe to repeat (PayPal keeps it 72 hours on the calls that support it). */
  requestId?: string;
  /** Ask PayPal to answer a write with the full resource. */
  representation?: boolean;
}

export interface PayPalClient {
  readonly environment: PayPalSettings['environment'];
  request<T>(method: Method, path: string, options?: RequestOptions): Promise<T>;
  /** What PayPal allows this app to do (the token's scopes), for a read-only capability check. */
  scopes(): Promise<string[]>;
}

interface Token {
  value: string;
  expiresAt: number;
  scopes: string[];
}

export function createPayPalClient(
  settings: PayPalSettings,
  deps: { fetch?: typeof fetch; sleep?: (ms: number) => Promise<void>; now?: () => number } = {},
): PayPalClient {
  const doFetch = deps.fetch ?? fetch;
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const now = deps.now ?? Date.now;
  let token: Token | null = null;
  let pendingToken: Promise<Token> | null = null;

  async function call(url: string, init: RequestInit): Promise<Response> {
    try {
      return await doFetch(url, { ...init, cache: 'no-store', signal: AbortSignal.timeout(TIMEOUT_MS) });
    } catch (error) {
      throw new PayPalUnavailable(`PayPal could not be reached (${error instanceof Error ? error.name : 'error'})`);
    }
  }

  async function failure(response: Response): Promise<PayPalError> {
    let body: { name?: unknown; details?: { issue?: unknown }[]; debug_id?: unknown; error?: unknown } = {};
    try {
      body = (await response.json()) as typeof body;
    } catch {
      // Not JSON: the status says enough.
    }
    const text = (value: unknown) => (typeof value === 'string' && /^[A-Za-z0-9_.-]{1,80}$/.test(value) ? value : null);
    return new PayPalError(
      response.status,
      text(body.name) ?? text(body.error),
      text(body.details?.[0]?.issue),
      text(body.debug_id) ?? text(response.headers.get('paypal-debug-id')),
    );
  }

  async function fetchToken(): Promise<Token> {
    const basic = Buffer.from(`${settings.clientId}:${settings.clientSecret}`).toString('base64');
    let lastError: Error | null = null;
    for (let attempt = 0; attempt <= RETRY_PAUSES_MS.length; attempt++) {
      if (attempt > 0) await sleep(RETRY_PAUSES_MS[attempt - 1]);
      let response: Response;
      try {
        response = await call(`${settings.apiBase}/v1/oauth2/token`, {
          method: 'POST',
          headers: { authorization: `Basic ${basic}`, accept: 'application/json', 'content-type': 'application/x-www-form-urlencoded' },
          body: 'grant_type=client_credentials',
        });
      } catch (error) {
        lastError = error as Error;
        continue;
      }
      if (response.ok) {
        const body = (await response.json()) as { access_token?: unknown; expires_in?: unknown; scope?: unknown };
        if (typeof body.access_token !== 'string' || body.access_token.length < 10) throw new PayPalError(response.status, 'INVALID_TOKEN_RESPONSE', null, null);
        const lifetimeMs = (typeof body.expires_in === 'number' && body.expires_in > 0 ? body.expires_in : 300) * 1000;
        return {
          value: body.access_token,
          expiresAt: now() + Math.max(lifetimeMs - TOKEN_MARGIN_MS, lifetimeMs / 2),
          scopes: typeof body.scope === 'string' ? body.scope.split(/\s+/).filter(Boolean) : [],
        };
      }
      lastError = await failure(response);
      // Wrong credentials or a refused app: asking again will not help.
      if (response.status !== 429 && response.status < 500) throw lastError;
    }
    throw lastError ?? new PayPalUnavailable('PayPal did not issue a token');
  }

  async function currentToken(fresh = false): Promise<Token> {
    if (!fresh && token && token.expiresAt > now()) return token;
    pendingToken ??= fetchToken().finally(() => {
      pendingToken = null;
    });
    token = await pendingToken;
    return token;
  }

  async function request<T>(method: Method, path: string, options: RequestOptions = {}): Promise<T> {
    if (!path.startsWith('/v')) throw new Error('PayPal paths start with the API version, e.g. /v1/…');
    const query = Object.entries(options.query ?? {}).filter((entry): entry is [string, string] => typeof entry[1] === 'string');
    const url = `${settings.apiBase}${path}${query.length ? `?${new URLSearchParams(query).toString()}` : ''}`;
    const repeatable = method === 'GET' || Boolean(options.requestId) || options.repeatable === true;
    const body = options.rawJson ?? (options.body === undefined ? undefined : JSON.stringify(options.body));
    let refreshed = false;
    let lastError: Error | null = null;
    for (let attempt = 0; attempt <= RETRY_PAUSES_MS.length; attempt++) {
      if (attempt > 0) await sleep(RETRY_PAUSES_MS[attempt - 1]);
      const { value } = await currentToken();
      const headers: Record<string, string> = { authorization: `Bearer ${value}`, accept: 'application/json' };
      if (body !== undefined) headers['content-type'] = 'application/json';
      if (options.requestId) headers['paypal-request-id'] = options.requestId;
      if (options.representation) headers.prefer = 'return=representation';
      let response: Response;
      try {
        response = await call(url, { method, headers, body });
      } catch (error) {
        lastError = error as Error;
        if (!repeatable) throw lastError;
        continue;
      }
      if (response.status === 401 && !refreshed) {
        // The token was revoked or expired early: one more try with a new one.
        refreshed = true;
        token = null;
        await currentToken(true);
        attempt--;
        continue;
      }
      if (response.ok) {
        if (response.status === 204) return undefined as T;
        const text = await response.text();
        return (text ? JSON.parse(text) : undefined) as T;
      }
      lastError = await failure(response);
      if (!repeatable || (response.status !== 429 && response.status < 500)) throw lastError;
    }
    throw lastError ?? new PayPalUnavailable('PayPal did not answer');
  }

  return {
    environment: settings.environment,
    request,
    scopes: async () => (await currentToken()).scopes,
  };
}

let shared: { key: string; client: PayPalClient } | null = null;

/** The PayPal client for this server's settings, or null when PayPal is not configured. */
export function getPayPalClient(): PayPalClient | null {
  const settings = paypalConfig();
  if (!settings) return null;
  // A new client when the credentials change (the key holds only a hash of the secret).
  const key = createHash('sha256').update(`${settings.environment}\n${settings.clientId}\n${settings.clientSecret}`).digest('hex');
  if (shared?.key !== key) shared = { key, client: createPayPalClient(settings) };
  return shared.client;
}
