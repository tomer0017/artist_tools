// @vitest-environment node
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { MONGO_STARTUP_TIMEOUT, startTestMongo, type TestMongo } from '@/test/mongo';
import { migrate } from '@/server/db/migrate';
import { collections } from '@/server/db/collections';
import { createAuth, signupAllowed, type Auth } from './auth';

// The real sign-in flow, end to end, against a real database. Only Google's
// token endpoint is simulated: it returns an ID token for a fake Google user.

const BASE = 'http://localhost:8080';
const CLIENT_ID = 'test-client.apps.googleusercontent.com';

let mongo: TestMongo;
let auth: Auth;
/** Same database, but registration limited to one invited address (as on staging). */
let inviteOnly: Auth;
const realFetch = globalThis.fetch;

beforeAll(async () => {
  mongo = await startTestMongo();
  await migrate(mongo.db);
  auth = createAuth({
    db: mongo.db,
    client: mongo.client,
    baseURL: BASE,
    secret: 'test-secret-that-is-at-least-32-characters-long',
    google: { clientId: CLIENT_ID, clientSecret: 'test-client-secret' },
    signups: '*',
  });
  inviteOnly = createAuth({
    db: mongo.db,
    client: mongo.client,
    baseURL: BASE,
    secret: 'test-secret-that-is-at-least-32-characters-long',
    google: { clientId: CLIENT_ID, clientSecret: 'test-client-secret' },
    signups: ['invited@example.com', 'second-invite@example.com'],
  });
}, MONGO_STARTUP_TIMEOUT);

afterEach(() => vi.unstubAllGlobals());
afterAll(async () => mongo?.stop());

interface GoogleUser {
  sub: string;
  email: string;
  name?: string;
  /** Google's email_verified claim; true unless a test says otherwise. */
  verified?: boolean;
}

const b64url = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');
const idToken = (user: GoogleUser) =>
  [
    b64url({ alg: 'RS256', typ: 'JWT', kid: 'test' }),
    b64url({
      iss: 'https://accounts.google.com',
      aud: CLIENT_ID,
      sub: user.sub,
      email: user.email,
      email_verified: user.verified ?? true,
      name: user.name ?? 'Ada Artist',
      picture: 'https://example.com/ada.png',
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 3600,
    }),
    'signature',
  ].join('.');

/** Google's token endpoint returns tokens for `user`; every other request is real. */
function simulateGoogle(user: GoogleUser) {
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (url.startsWith('https://oauth2.googleapis.com/token')) {
      return new Response(
        JSON.stringify({ access_token: 'google-access-token', refresh_token: 'google-refresh-token', expires_in: 3599, token_type: 'Bearer', scope: 'openid email profile', id_token: idToken(user) }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }
    return realFetch(input, init);
  });
}

/** Cookie header carrying every cookie a response set. */
const cookiesFrom = (response: Response, previous = ''): string => {
  const jar = new Map(previous.split('; ').filter(Boolean).map((c) => [c.split('=')[0], c] as const));
  for (const line of response.headers.getSetCookie()) {
    const pair = line.split(';')[0];
    jar.set(pair.split('=')[0], pair);
  }
  return [...jar.values()].join('; ');
};

const sessionTokenCookie = (cookies: string) => cookies.split('; ').find((c) => c.startsWith('sc.session_token=')) ?? '';

// Each simulated visitor gets its own address (as nginx reports it), so the
// per-client rate limit never interferes with the functional tests.
let visitor = 0;
const nextVisitorIp = () => `10.0.${Math.floor(++visitor / 250)}.${visitor % 250}`;

async function startSignIn(callbackURL = '/app', using: Auth = auth, ip = nextVisitorIp()) {
  const response = await using.handler(
    new Request(`${BASE}/api/auth/sign-in/social`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: BASE, 'x-real-ip': ip },
      body: JSON.stringify({ provider: 'google', callbackURL }),
    }),
  );
  return { response, body: response.ok ? ((await response.json()) as { url: string; redirect: boolean }) : null };
}

/** Run the whole sign-in as `user`: start, "consent" at Google, come back. */
async function signInAs(user: GoogleUser, using: Auth = auth) {
  const { response, body } = await startSignIn('/app', using);
  const state = new URL(body!.url).searchParams.get('state')!;
  simulateGoogle(user);
  const callback = await using.handler(
    new Request(`${BASE}/api/auth/callback/google?state=${encodeURIComponent(state)}&code=test-code`, {
      headers: { cookie: cookiesFrom(response) },
    }),
  );
  return { callback, cookies: cookiesFrom(callback, cookiesFrom(response)) };
}

const getSession = (cookie: string) => auth.api.getSession({ headers: new Headers({ cookie }) });

describe('starting Google sign-in', () => {
  it('asks Google only for openid, email and profile, with state and PKCE', async () => {
    const { response, body } = await startSignIn();
    expect(response.status).toBe(200);
    const url = new URL(body!.url);
    expect(url.origin + url.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    const q = url.searchParams;
    expect(q.get('client_id')).toBe(CLIENT_ID);
    expect(q.get('redirect_uri')).toBe(`${BASE}/api/auth/callback/google`);
    expect(q.get('response_type')).toBe('code');
    expect(q.get('scope')!.split(' ').sort()).toEqual(['email', 'openid', 'profile']);
    expect(q.get('code_challenge_method')).toBe('S256');
    expect(q.get('code_challenge')).toBeTruthy();
    expect(q.get('state')).toBeTruthy();
    expect(q.get('prompt')).toBe('select_account');
  });

  it('refuses to send the user to another site after sign-in', async () => {
    const { response } = await startSignIn('https://evil.example/steal');
    expect(response.status).toBe(403);
  });
});

describe('the Google callback', () => {
  const ada: GoogleUser = { sub: 'google-sub-ada', email: 'ada@example.com' };

  it('creates the account on first sign-in, without keeping Google tokens', async () => {
    const { callback, cookies } = await signInAs(ada);
    expect(callback.status).toBe(302);
    expect(new URL(callback.headers.get('location')!, BASE).pathname).toBe('/app');
    expect(sessionTokenCookie(cookies)).toBeTruthy();

    const { users, accounts, sessions, auditEvents, analyticsEvents } = collections(mongo.db);
    const user = await users.findOne({ email: ada.email });
    expect(user).toMatchObject({ emailVerified: true, role: 'user', status: 'active', marketingConsent: false });
    expect(user!.lastLoginAt).toBeInstanceOf(Date);

    const account = await accounts.findOne({ userId: user!._id });
    expect(account).toMatchObject({ providerId: 'google', accountId: ada.sub });
    const raw = account as unknown as Record<string, unknown>;
    expect(raw.accessToken ?? null).toBeNull();
    expect(raw.refreshToken ?? null).toBeNull();
    expect(raw.idToken ?? null).toBeNull();

    expect(await sessions.countDocuments({ userId: user!._id })).toBe(1);
    expect(await auditEvents.countDocuments({ userId: user!._id, type: 'user.registered' })).toBe(1);
    expect(await auditEvents.countDocuments({ userId: user!._id, type: 'user.login' })).toBe(1);
    expect(await analyticsEvents.countDocuments({ userId: user!._id, name: 'registration_completed' })).toBe(1);
  });

  it('signs the same Google identity back into the same account (no duplicates)', async () => {
    const before = await collections(mongo.db).users.findOne({ email: ada.email });
    await new Promise((r) => setTimeout(r, 10));
    const { callback } = await signInAs(ada);
    expect(callback.status).toBe(302);
    const { users, accounts, sessions, analyticsEvents } = collections(mongo.db);
    expect(await users.countDocuments({ email: ada.email })).toBe(1);
    expect(await accounts.countDocuments({ providerId: 'google', accountId: ada.sub })).toBe(1);
    expect(await sessions.countDocuments({ userId: before!._id })).toBe(2);
    expect(await analyticsEvents.countDocuments({ userId: before!._id, name: 'registration_completed' })).toBe(1);
    const after = await users.findOne({ _id: before!._id });
    expect(after!.lastLoginAt!.getTime()).toBeGreaterThan(before!.lastLoginAt!.getTime());
  });

  it('does not let a different Google identity into an account just because the email matches', async () => {
    const { callback, cookies } = await signInAs({ sub: 'google-sub-impostor', email: ada.email });
    expect(new URL(callback.headers.get('location')!, BASE).pathname).toBe('/sign-in');
    expect(sessionTokenCookie(cookies)).toBe('');
    expect(await collections(mongo.db).accounts.countDocuments({ accountId: 'google-sub-impostor' })).toBe(0);
  });

  it('rejects a callback whose state was not issued by this server', async () => {
    simulateGoogle(ada);
    const callback = await auth.handler(new Request(`${BASE}/api/auth/callback/google?state=forged&code=test-code`));
    const location = new URL(callback.headers.get('location')!, BASE);
    expect(location.pathname).toBe('/sign-in');
    expect(location.searchParams.get('error')).toBeTruthy();
    expect(sessionTokenCookie(cookiesFrom(callback))).toBe('');
  });
});

describe('sessions', () => {
  const grace: GoogleUser = { sub: 'google-sub-grace', email: 'grace@example.com' };

  it('accepts a valid session and rejects a tampered cookie', async () => {
    const { cookies } = await signInAs(grace);
    const token = sessionTokenCookie(cookies);
    expect((await getSession(token))?.user.email).toBe(grace.email);

    const tampered = token.replace(/.$/, (c) => (c === 'A' ? 'B' : 'A'));
    expect(await getSession(tampered)).toBeNull();
    expect(await getSession('sc.session_token=not-a-real-token')).toBeNull();
  });

  it('rejects an expired session', async () => {
    const { cookies } = await signInAs(grace);
    const token = sessionTokenCookie(cookies);
    const raw = decodeURIComponent(token.split('=')[1]).split('.')[0];
    await collections(mongo.db).sessions.updateOne({ token: raw }, { $set: { expiresAt: new Date(Date.now() - 1000) } });
    expect(await getSession(token)).toBeNull();
  });

  it('signing out ends the session on the server', async () => {
    const { cookies } = await signInAs(grace);
    const token = sessionTokenCookie(cookies);
    const raw = decodeURIComponent(token.split('=')[1]).split('.')[0];
    const response = await auth.handler(
      new Request(`${BASE}/api/auth/sign-out`, { method: 'POST', headers: { cookie: cookies, origin: BASE, 'content-type': 'application/json' }, body: '{}' }),
    );
    expect(response.status).toBe(200);
    expect(await collections(mongo.db).sessions.countDocuments({ token: raw })).toBe(0);
    expect(await getSession(token)).toBeNull();
  });

  it('a suspended account cannot sign in', async () => {
    const linus: GoogleUser = { sub: 'google-sub-linus', email: 'linus@example.com' };
    await signInAs(linus);
    const { users, sessions } = collections(mongo.db);
    const user = await users.findOne({ email: linus.email });
    await users.updateOne({ _id: user!._id }, { $set: { status: 'suspended' } });
    const sessionsBefore = await sessions.countDocuments({ userId: user!._id });

    const { callback, cookies } = await signInAs(linus);
    expect(new URL(callback.headers.get('location')!, BASE).pathname).toBe('/sign-in');
    expect(sessionTokenCookie(cookies)).toBe('');
    expect(await sessions.countDocuments({ userId: user!._id })).toBe(sessionsBefore);
  });
});

describe('invite-only registration (staging)', () => {
  const refusedWith = (callback: Response) => {
    const location = new URL(callback.headers.get('location')!, BASE);
    return { path: location.pathname, error: location.searchParams.get('error') };
  };

  /** Everything Better Auth and the app print while `work` runs. */
  async function captureLogs<T>(work: () => Promise<T>): Promise<{ result: T; logs: string }> {
    const lines: string[] = [];
    const spies = (['log', 'warn', 'error'] as const).map((level) =>
      vi.spyOn(console, level).mockImplementation((...args: unknown[]) => {
        lines.push(args.map((a) => (a instanceof Error ? `${a.name}: ${a.message}` : String(a))).join(' '));
      }),
    );
    try {
      return { result: await work(), logs: lines.join('\n') };
    } finally {
      spies.forEach((spy) => spy.mockRestore());
    }
  }

  it('lets an invited, Google-verified address create an account', async () => {
    const { callback, cookies } = await signInAs({ sub: 'google-sub-invited', email: 'Invited@Example.com' }, inviteOnly);
    expect(new URL(callback.headers.get('location')!, BASE).pathname).toBe('/app');
    expect(sessionTokenCookie(cookies)).toBeTruthy();
    expect(await collections(mongo.db).accounts.countDocuments({ accountId: 'google-sub-invited' })).toBe(1);
  });

  it('refuses everyone else with a clear code, without creating anything', async () => {
    const { result, logs } = await captureLogs(() => signInAs({ sub: 'google-sub-stranger', email: 'stranger@example.com' }, inviteOnly));
    const { callback, cookies } = result;
    const refused = refusedWith(callback);
    expect(refused.path).toBe('/sign-in');
    expect(refused.error).toBe('not_invited');
    expect(sessionTokenCookie(cookies)).toBe('');
    // The refusal goes through Better Auth's validation gate, not the database hook.
    expect(logs).toContain('auth.signup_refused');
    expect(logs).not.toContain('TypeError');
    expect(logs).not.toContain('Unable to create OAuth user');
    expect(logs).not.toContain('auth.signup_gate_bypassed');
    expect(await collections(mongo.db).users.countDocuments({ email: 'stranger@example.com' })).toBe(0);
    expect(await collections(mongo.db).accounts.countDocuments({ accountId: 'google-sub-stranger' })).toBe(0);
  });

  it('refuses an invited address that Google has not verified', async () => {
    // On the list and never registered, so only Google's verification is missing.
    const { callback } = await signInAs({ sub: 'google-sub-unverified', email: 'second-invite@example.com', verified: false }, inviteOnly);
    expect(refusedWith(callback)).toEqual({ path: '/sign-in', error: 'not_invited' });
    expect(await collections(mongo.db).accounts.countDocuments({ accountId: 'google-sub-unverified' })).toBe(0);
  });

  it('fails closed: if the invite check itself breaks, nobody new gets in', async () => {
    const broken = createAuth({
      db: mongo.db,
      client: mongo.client,
      baseURL: BASE,
      secret: 'test-secret-that-is-at-least-32-characters-long',
      google: { clientId: CLIENT_ID, clientSecret: 'test-client-secret' },
      // A policy that throws when consulted, standing in for any bug in the check.
      signups: new Proxy([] as string[], { get: () => { throw new Error('policy unavailable'); } }),
    });
    const { result } = await captureLogs(() => signInAs({ sub: 'google-sub-during-outage', email: 'fresh@example.com' }, broken));
    expect(refusedWith(result.callback)).toEqual({ path: '/sign-in', error: 'validation_failed' });
    expect(sessionTokenCookie(result.cookies)).toBe('');
    expect(await collections(mongo.db).accounts.countDocuments({ accountId: 'google-sub-during-outage' })).toBe(0);
  });

  it('never locks out accounts that already exist', async () => {
    // Ada registered while sign-ups were open (earlier test); she is not on the list.
    const { callback, cookies } = await signInAs({ sub: 'google-sub-ada', email: 'ada@example.com' }, inviteOnly);
    expect(new URL(callback.headers.get('location')!, BASE).pathname).toBe('/app');
    expect(sessionTokenCookie(cookies)).toBeTruthy();
  });

  it('applies the policy exactly as configured', () => {
    expect(signupAllowed('*', { email: 'x@y.z', emailVerified: false })).toBe(true);
    expect(signupAllowed([], { email: 'a@b.c', emailVerified: true })).toBe(false);
    expect(signupAllowed(['a@b.c'], { email: ' A@B.C ', emailVerified: true })).toBe(true);
    expect(signupAllowed(['a@b.c'], { email: 'a@b.c', emailVerified: false })).toBe(false);
    expect(signupAllowed(['a@b.c'], { email: null, emailVerified: true })).toBe(false);
  });
});

describe('rate limiting', () => {
  it('stops one client from starting sign-in more than 10 times a minute', async () => {
    const ip = '192.0.2.77';
    const statuses: number[] = [];
    for (let i = 0; i < 11; i++) statuses.push((await startSignIn('/app', auth, ip)).response.status);
    expect(statuses.slice(0, 10).every((s) => s === 200)).toBe(true);
    expect(statuses[10]).toBe(429);
    // Other visitors are unaffected.
    expect((await startSignIn('/app', auth, '192.0.2.78')).response.status).toBe(200);
  });
});
