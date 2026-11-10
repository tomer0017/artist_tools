// @vitest-environment node
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { MONGO_STARTUP_TIMEOUT, startTestMongo, type TestMongo } from '@/test/mongo';
import { migrate } from '@/server/db/migrate';
import { collections } from '@/server/db/collections';
import { settleBackground } from './background';
import { createAuth, type Auth } from './auth';
import { createMailer } from './mail/mailer';

// Email + password sign-in, end to end against a real database: sign-up,
// verification, sign-in, reset, the invite gate, the password policy,
// per-address throttles, and how a password account and Google meet. Only
// Google's token endpoint is simulated.

const BASE = 'http://localhost:8080';
const CLIENT_ID = 'test-client.apps.googleusercontent.com';
const PASSWORD = 'violet cactus harbor 42';

let mongo: TestMongo;
let auth: Auth;
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
    signups: { mode: 'invite', invited: ['ada@example.com', 'grace@example.com', 'mary@example.com', 'emmy@example.com', 'rosalind@example.com', 'hedy@example.com', 'katherine@example.com', 'barbara@example.com', 'frances@example.com'] },
    emailPassword: true,
    mailer: createMailer(mongo.db, 'outbox'),
  });
}, MONGO_STARTUP_TIMEOUT);

afterEach(() => vi.unstubAllGlobals());
afterAll(async () => mongo?.stop());

let visitor = 0;
const nextIp = () => `10.1.${Math.floor(++visitor / 250)}.${visitor % 250}`;

const cookiesFrom = (response: Response, previous = ''): string => {
  const jar = new Map(previous.split('; ').filter(Boolean).map((c) => [c.split('=')[0], c] as const));
  for (const line of response.headers.getSetCookie()) {
    const pair = line.split(';')[0];
    jar.set(pair.split('=')[0], pair);
  }
  return [...jar.values()].join('; ');
};
const sessionCookie = (cookies: string) => cookies.split('; ').find((c) => c.startsWith('sc.session_token=') && c.length > 'sc.session_token='.length) ?? '';

async function post(path: string, body: unknown, options: { cookie?: string; ip?: string } = {}) {
  const response = await auth.handler(
    new Request(`${BASE}/api/auth${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: BASE, 'x-real-ip': options.ip ?? nextIp(), ...(options.cookie ? { cookie: options.cookie } : {}) },
      body: JSON.stringify(body),
    }),
  );
  await settleBackground();
  const text = await response.text();
  return { response, status: response.status, body: text ? JSON.parse(text) : null, cookies: cookiesFrom(response, options.cookie) };
}

const signUp = (email: string, password = PASSWORD, name = 'Test Artist') => post('/sign-up/email', { email, password, name, callbackURL: '/email-verified' });
// As the sign-in page does: a verification link sent on sign-in comes back to the same place.
const signIn = (email: string, password = PASSWORD, ip?: string) => post('/sign-in/email', { email, password, callbackURL: '/email-verified' }, { ip });
const mailTo = (address: string, template?: string) =>
  collections(mongo.db).mailOutbox.find({ to: address, ...(template ? { template: template as never } : {}) }, { sort: { createdAt: 1 } }).toArray();

/** Follow the verification link from the latest email, as the person's browser would. */
async function verifyFromInbox(address: string) {
  const mail = (await mailTo(address, 'verify_email')).at(-1)!;
  const url = new URL(mail.links[0].url);
  const response = await auth.handler(new Request(url, { headers: { 'x-real-ip': nextIp() } }));
  await settleBackground();
  return { response, cookies: cookiesFrom(response) };
}

async function signedUpAndVerified(email: string) {
  await signUp(email);
  return verifyFromInbox(email);
}

describe('signing up with email and password', () => {
  it('creates an unverified account that cannot be used until the address is verified', async () => {
    const { status, body, cookies } = await signUp('ada@example.com');
    expect(status).toBe(200);
    expect(body).toEqual({ status: true, message: 'Check your email to continue.' });
    expect(sessionCookie(cookies)).toBe('');

    const user = await collections(mongo.db).users.findOne({ email: 'ada@example.com' });
    expect(user).toMatchObject({ emailVerified: false, role: 'user', plan: 'free', status: 'active', marketingConsent: false, locale: 'en', currency: 'USD' });
    const account = await collections(mongo.db).accounts.findOne({ userId: user!._id });
    expect(account).toMatchObject({ providerId: 'credential' });
    // scrypt, never the password itself.
    expect(account!.password).toMatch(/^[0-9a-f]+:[0-9a-f]+$/);
    expect(account!.password).not.toContain(PASSWORD);
    expect(await collections(mongo.db).auditEvents.findOne({ userId: user!._id, type: 'user.registered' })).toMatchObject({ metadata: { provider: 'credential' } });

    const [mail] = await mailTo('ada@example.com', 'verify_email');
    expect(mail.subject).toBe('Confirm your email address');
    expect(mail.links[0].url).toMatch(/^http:\/\/localhost:8080\/api\/auth\/verify-email\?token=/);

    // The right password is not enough before verification; a fresh link is sent.
    const early = await signIn('ada@example.com');
    expect(early.status).toBe(403);
    expect(early.body.code).toBe('EMAIL_NOT_VERIFIED');
    expect(sessionCookie(early.cookies)).toBe('');
    expect(await mailTo('ada@example.com', 'verify_email')).toHaveLength(2);
  });

  it('verifying signs the person in, and from then on the password works', async () => {
    const { response, cookies } = await verifyFromInbox('ada@example.com');
    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toBe('/email-verified');
    expect(sessionCookie(cookies)).not.toBe('');

    const user = await collections(mongo.db).users.findOne({ email: 'ada@example.com' });
    expect(user!.emailVerified).toBe(true);
    expect(await collections(mongo.db).auditEvents.countDocuments({ userId: user!._id, type: 'user.email_verified' })).toBe(1);
    expect(await collections(mongo.db).analyticsEvents.countDocuments({ userId: user!._id, name: 'registration_completed' })).toBe(1);

    const later = await signIn('ada@example.com');
    expect(later.status).toBe(200);
    expect(sessionCookie(later.cookies)).not.toBe('');
    expect(await collections(mongo.db).auditEvents.findOne({ userId: user!._id, type: 'user.login', 'metadata.method': 'password' })).toBeTruthy();
  });

  it('answers a sign-up for an existing address exactly like a new one, and tells the owner instead', async () => {
    const before = await collections(mongo.db).users.countDocuments();
    const fresh = await signUp('grace@example.com');
    const again = await signUp('ada@example.com', 'another sturdy phrase 7', 'Somebody Else');
    expect(again.status).toBe(fresh.status);
    expect(again.body).toEqual(fresh.body);
    expect(again.response.headers.getSetCookie()).toEqual(fresh.response.headers.getSetCookie());

    expect(await collections(mongo.db).users.countDocuments()).toBe(before + 1); // only grace
    // The existing account keeps its password; the owner hears about the attempt.
    expect((await signIn('ada@example.com')).status).toBe(200);
    expect((await signIn('ada@example.com', 'another sturdy phrase 7')).status).toBe(401);
    const [notice] = await mailTo('ada@example.com', 'existing_account');
    expect(notice.text).toContain('You sign in with your password.');
  });

  it('gives an address that is not invited the same answer, and creates nothing', async () => {
    const refused = await signUp('stranger@example.com');
    const fresh = await signUp('mary@example.com');
    expect(refused.status).toBe(fresh.status);
    expect(refused.body).toEqual(fresh.body);
    expect(await collections(mongo.db).users.countDocuments({ email: 'stranger@example.com' })).toBe(0);
    expect(await mailTo('stranger@example.com')).toHaveLength(0);
  });

  it('refuses weak passwords with guidance, the same way for every address', async () => {
    const cases: [string, string][] = [
      ['short pass', 'PASSWORD_TOO_SHORT'],
      ['Password1234', 'PASSWORD_TOO_COMMON'],
      ['P@ssw0rd2024!', 'PASSWORD_TOO_COMMON'],
      ['qwertyuiop12', 'PASSWORD_TOO_PREDICTABLE'],
      ['aaaaaaaaaaaaaaaa', 'PASSWORD_TOO_PREDICTABLE'],
      ['emmy-studio-2026!', 'PASSWORD_PERSONAL'],
    ];
    for (const [password, code] of cases) {
      for (const email of ['emmy@example.com', 'ada@example.com', 'stranger@example.com']) {
        const result = await signUp(email, password, 'Emmy Noether');
        expect(result.status, `${password} for ${email}`).toBe(400);
        expect(result.body.code).toBe(code);
      }
    }
    expect(await collections(mongo.db).users.countDocuments({ email: 'emmy@example.com' })).toBe(0);
    expect((await signUp('emmy@example.com', 'thirteen quiet lanterns', 'Emmy Noether')).status).toBe(200);
  });
});

describe('signing in with a password', () => {
  it('gives one answer for a wrong password and an unknown address', async () => {
    const wrong = await signIn('ada@example.com', 'not the right phrase at all');
    const unknown = await signIn('nobody-here@example.com', 'not the right phrase at all');
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(wrong.body).toEqual(unknown.body);
  });

  it('pauses password sign-in for an address after 10 wrong passwords, whether or not it has an account', async () => {
    await signedUpAndVerified('rosalind@example.com');
    for (let i = 0; i < 10; i++) expect((await signIn('rosalind@example.com', `wrong guess number ${i}`)).status).toBe(401);
    // Even the right password, from a new address, now waits.
    const paused = await signIn('rosalind@example.com');
    expect(paused.status).toBe(429);
    expect(paused.body.code).toBe('TOO_MANY_ATTEMPTS');
    for (let i = 0; i < 10; i++) await signIn('no-account-here@example.com', `wrong guess number ${i}`);
    expect((await signIn('no-account-here@example.com', 'anything at all here')).status).toBe(429);

    const user = await collections(mongo.db).users.findOne({ email: 'rosalind@example.com' });
    expect(await collections(mongo.db).auditEvents.countDocuments({ userId: user!._id, type: 'auth.login_failed' })).toBe(10);
    expect(await collections(mongo.db).auditEvents.countDocuments({ type: 'auth.throttled', 'metadata.purpose': 'sign_in' })).toBeGreaterThanOrEqual(2);
    // The window holds a hash, never the address.
    const windows = await collections(mongo.db).authThrottles.find().toArray();
    expect(JSON.stringify(windows)).not.toContain('rosalind');
  });

  it('limits one network address to 5 sign-in attempts a minute', async () => {
    const ip = '10.9.9.9';
    const statuses = [];
    for (let i = 0; i < 6; i++) statuses.push((await signIn('grace@example.com', `guess ${i} of many tries`, ip)).status);
    expect(statuses.slice(0, 5).every((s) => s === 401 || s === 403)).toBe(true);
    expect(statuses[5]).toBe(429);
  });
});

describe('resetting a password', () => {
  const requestReset = (email: string) => post('/request-password-reset', { email, redirectTo: '/reset-password' });

  it('answers the same for any address and emails a single-use link to account owners', async () => {
    const known = await requestReset('ada@example.com');
    const unknown = await requestReset('nobody-at-all@example.com');
    expect(known.status).toBe(200);
    expect(known.body).toEqual(unknown.body);
    expect(await mailTo('nobody-at-all@example.com')).toHaveLength(0);

    const [mail] = await mailTo('ada@example.com', 'reset_password');
    const token = new URL(mail.links[0].url).searchParams.get('token')!;
    expect(mail.links[0].url.startsWith(`${BASE}/reset-password?token=`)).toBe(true);
    // Stored hashed: the database never holds the token itself.
    const stored = await collections(mongo.db).verifications.find().toArray();
    expect(JSON.stringify(stored)).not.toContain(token);
  });

  it('sets the new password, signs out every device, and cannot be used twice', async () => {
    const device = await signIn('ada@example.com');
    expect(sessionCookie(device.cookies)).not.toBe('');
    const [mail] = (await mailTo('ada@example.com', 'reset_password')).slice(-1);
    const token = new URL(mail.links[0].url).searchParams.get('token')!;

    expect((await post('/reset-password', { token, newPassword: 'Password1234' })).body.code).toBe('PASSWORD_TOO_COMMON');
    const reset = await post('/reset-password', { token, newPassword: 'amber falcon orchard 9' });
    expect(reset.status).toBe(200);
    expect((await post('/reset-password', { token, newPassword: 'another amber falcon 10' })).status).toBe(400);

    const user = await collections(mongo.db).users.findOne({ email: 'ada@example.com' });
    expect(await collections(mongo.db).sessions.countDocuments({ userId: user!._id })).toBe(0);
    expect((await signIn('ada@example.com')).status).toBe(401);
    expect((await signIn('ada@example.com', 'amber falcon orchard 9')).status).toBe(200);
    expect(await collections(mongo.db).auditEvents.countDocuments({ userId: user!._id, type: 'user.password_reset' })).toBe(1);
    expect(await mailTo('ada@example.com', 'password_changed')).toHaveLength(1);
  });

  it('sends at most 3 messages of a kind to one address per hour, silently', async () => {
    for (let i = 0; i < 5; i++) expect((await requestReset('grace@example.com')).status).toBe(200);
    expect(await mailTo('grace@example.com', 'reset_password')).toHaveLength(3);
  });
});

describe('a password account and Google', () => {
  const b64url = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');
  function simulateGoogle(sub: string, email: string) {
    const idToken = [
      b64url({ alg: 'RS256', typ: 'JWT', kid: 'test' }),
      b64url({ iss: 'https://accounts.google.com', aud: CLIENT_ID, sub, email, email_verified: true, name: 'Google Person', iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 3600 }),
      'signature',
    ].join('.');
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (url.startsWith('https://oauth2.googleapis.com/token')) {
        return new Response(JSON.stringify({ access_token: 'a', expires_in: 3599, token_type: 'Bearer', scope: 'openid email profile', id_token: idToken }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      return realFetch(input, init);
    });
  }
  async function googleCallback(started: { response: Response; body: { url: string } }, cookie: string) {
    const state = new URL(started.body.url).searchParams.get('state')!;
    const callback = await auth.handler(
      new Request(`${BASE}/api/auth/callback/google?state=${encodeURIComponent(state)}&code=test-code`, { headers: { cookie: cookiesFrom(started.response, cookie), 'x-real-ip': nextIp() } }),
    );
    await settleBackground();
    return callback;
  }

  it('never merges a Google sign-in into a password account with the same address', async () => {
    await signedUpAndVerified('hedy@example.com');
    const started = await post('/sign-in/social', { provider: 'google', callbackURL: '/app' });
    simulateGoogle('google-sub-hedy', 'hedy@example.com');
    const callback = await googleCallback(started, '');
    expect(new URL(callback.headers.get('location')!, BASE).searchParams.get('error')).toBe('account_not_linked');
    expect(sessionCookie(cookiesFrom(callback))).toBe('');
    expect(await collections(mongo.db).accounts.countDocuments({ providerId: 'google', accountId: 'google-sub-hedy' })).toBe(0);
  });

  it('lets the signed-in owner connect Google with the same address, and tells them', async () => {
    const { cookies } = await signIn('hedy@example.com');
    const started = await post('/link-social', { provider: 'google', callbackURL: '/app/profile' }, { cookie: cookies });
    expect(started.status).toBe(200);
    simulateGoogle('google-sub-hedy', 'hedy@example.com');
    const callback = await googleCallback({ response: started.response, body: started.body }, cookies);
    expect(callback.headers.get('location')).toBe('/app/profile');

    const user = await collections(mongo.db).users.findOne({ email: 'hedy@example.com' });
    expect(await collections(mongo.db).accounts.countDocuments({ userId: user!._id })).toBe(2);
    expect(await collections(mongo.db).auditEvents.findOne({ userId: user!._id, type: 'account.linked' })).toMatchObject({ metadata: { provider: 'google' } });
    expect(await mailTo('hedy@example.com', 'google_connected')).toHaveLength(1);
  });

  it('refuses to connect a Google account with a different address', async () => {
    await signedUpAndVerified('katherine@example.com');
    const { cookies } = await signIn('katherine@example.com');
    const started = await post('/link-social', { provider: 'google', callbackURL: '/app/profile' }, { cookie: cookies });
    simulateGoogle('google-sub-other', 'someone-else@example.com');
    const callback = await googleCallback({ response: started.response, body: started.body }, cookies);
    expect(callback.headers.get('location')).toMatch(/error=/);
    expect(await collections(mongo.db).accounts.countDocuments({ accountId: 'google-sub-other' })).toBe(0);
  });

  it('turns away a password sign-up for an address that signs in with Google, and tells its owner how they sign in', async () => {
    const started = await post('/sign-in/social', { provider: 'google', callbackURL: '/app' });
    simulateGoogle('google-sub-barbara', 'barbara@example.com');
    await googleCallback(started, '');
    const google = await collections(mongo.db).users.findOne({ email: 'barbara@example.com' });
    expect(google).toBeTruthy();

    expect((await signUp('barbara@example.com')).status).toBe(200);
    expect(await collections(mongo.db).accounts.countDocuments({ userId: google!._id })).toBe(1);
    const [notice] = await mailTo('barbara@example.com', 'existing_account');
    expect(notice.text).toContain('You sign in with Google.');
    expect((await signIn('barbara@example.com')).status).toBe(401);
  });
});
