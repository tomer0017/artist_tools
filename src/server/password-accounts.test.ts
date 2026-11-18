// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ObjectId } from 'mongodb';
import { MONGO_STARTUP_TIMEOUT, startTestMongo, type TestMongo } from '@/test/mongo';
import { migrate } from '@/server/db/migrate';
import { collections } from '@/server/db/collections';
import { USERNAME_EMAIL_DOMAIN } from '@/lib/username';
import { settleBackground } from './background';
import { createAuth, type Auth } from './auth';
import { getEntitlements, clearPlanCache } from './entitlements';
import { createMailer } from './mail/mailer';
import { runMaintenance } from './maintenance';
import { exportAccountData } from './account-management';
import {
  INITIAL_PASSWORD_HOURS,
  createUsernameAccount,
  endAllSessions,
  generatePassword,
  holdInitialPassword,
  pendingInitialPassword,
  removeUsernameAccount,
  resetUsernamePassword,
  revealInitialPassword,
} from './password-accounts';
import { checkPassword } from './security/password-policy';
import { THROTTLES } from './security/throttle';
import { getUserDetail, listAuditEvents, listUsers, setUserPlan, setUserRole, setUserStatus } from './admin';

// Username accounts for invited testers (ADR-0012), end to end against a real
// database through Better Auth's real endpoints: created only by the server,
// signed in by username, one answer for every failure, throttled, suspended,
// reset, signed out everywhere, and never a way to register or to reach a
// Google account. Staging's configuration: Google, plus usernames, no email.

const BASE = 'http://localhost:8080';
const SECRET = 'test-secret-that-is-at-least-32-characters-long';

let mongo: TestMongo;
/** As staging: Google, open registration, username sign-in on, email and password off, no mail. */
let auth: Auth;
/** The same database with username sign-in off. */
let usernamesOff: Auth;
/** Both password methods on (email accounts need verification). */
let both: Auth;

beforeAll(async () => {
  process.env.BETTER_AUTH_SECRET = SECRET; // secret-box reads the sealing key from the environment
  process.env.BETTER_AUTH_URL = BASE;
  mongo = await startTestMongo();
  await migrate(mongo.db);
  clearPlanCache();
  const common = {
    db: mongo.db,
    client: mongo.client,
    baseURL: BASE,
    secret: SECRET,
    google: { clientId: 'test-client.apps.googleusercontent.com', clientSecret: 'test-client-secret' },
    signups: { mode: 'open' as const },
    mailer: createMailer(mongo.db, 'outbox'),
  };
  auth = createAuth({ ...common, usernamePassword: true });
  usernamesOff = createAuth({ ...common });
  both = createAuth({ ...common, emailPassword: true, usernamePassword: true });
}, MONGO_STARTUP_TIMEOUT);

afterAll(async () => mongo?.stop());

let visitor = 0;
const nextIp = () => `10.9.${Math.floor(++visitor / 250)}.${visitor % 250}`;

const cookiesFrom = (response: Response, previous = ''): string => {
  const jar = new Map(previous.split('; ').filter(Boolean).map((c) => [c.split('=')[0], c] as const));
  for (const line of response.headers.getSetCookie()) {
    const pair = line.split(';')[0];
    jar.set(pair.split('=')[0], pair);
  }
  return [...jar.values()].join('; ');
};
const sessionCookie = (cookies: string) => cookies.split('; ').find((c) => c.startsWith('sc.session_token=') && c.length > 'sc.session_token='.length) ?? '';

async function post(path: string, body: unknown, options: { cookie?: string; ip?: string; via?: Auth } = {}) {
  const response = await (options.via ?? auth).handler(
    new Request(`${BASE}/api/auth${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: BASE, 'x-real-ip': options.ip ?? nextIp(), ...(options.cookie ? { cookie: options.cookie } : {}) },
      body: JSON.stringify(body),
    }),
  );
  await settleBackground();
  return { response, status: response.status, body: await bodyOf(response), cookies: cookiesFrom(response, options.cookie) };
}

/** JSON, or the plain text of a 404 ("Not Found"). */
async function bodyOf(response: Response) {
  const text = await response.text();
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    return text;
  }
}

/** The session as the database has it (the app checks the database too; the library's 5-minute cookie cache is skipped). */
async function liveSession(cookie: string, via: Auth = auth) {
  const response = await via.handler(new Request(`${BASE}/api/auth/get-session?disableCookieCache=true`, { headers: { cookie, 'x-real-ip': nextIp() } }));
  return bodyOf(response);
}

const signIn = (username: string, password: string, options: { ip?: string; via?: Auth } = {}) => post('/sign-in/username', { username, password }, options);

const users = () => collections(mongo.db).users;

async function newTester(username: string, plan: 'free' | 'pro' = 'free') {
  const result = await createUsernameAccount(mongo.db, auth, { username, plan, locale: 'en', test: true, actor: 'cli' });
  if (result.status !== 'created') throw new Error(`not created: ${result.status}`);
  return result;
}

/** A Google account as Better Auth stores one (no password). */
async function seedGoogleUser(email: string, role: 'user' | 'admin' = 'user') {
  const _id = new ObjectId();
  const now = new Date();
  await users().insertOne({ _id, name: 'Google Person', email, emailVerified: true, createdAt: now, updatedAt: now, role, status: 'active', plan: 'free', marketingConsent: false });
  await collections(mongo.db).accounts.insertOne({ _id: new ObjectId(), userId: _id, providerId: 'google', accountId: `google-${_id}`, createdAt: now, updatedAt: now });
  return _id;
}

describe('generated passwords', () => {
  it('are long, random, typeable and always pass the password policy', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 200; i++) {
      const password = generatePassword({ email: 'tomerfree@x.invalid', name: 'Tomerfree' });
      expect(password).toMatch(/^[A-HJ-NP-Za-km-np-z2-9]{4}(-[A-HJ-NP-Za-km-np-z2-9]{4}){3}$/);
      expect(checkPassword(password, { email: 'tomerfree@x.invalid', name: 'Tomerfree' })).toBeNull();
      seen.add(password);
    }
    expect(seen.size).toBe(200);
  });
});

describe('creating a username account', () => {
  it('makes a real Better Auth account: hashed password, user role, the chosen plan, active, no real email', async () => {
    const created = await newTester('Tomerfree');
    expect(created.username).toBe('Tomerfree');
    const user = await users().findOne({ _id: created.userId });
    expect(user).toMatchObject({
      username: 'tomerfree',
      displayUsername: 'Tomerfree',
      name: 'Tomerfree',
      email: `tomerfree@${USERNAME_EMAIL_DOMAIN}`,
      emailVerified: true,
      role: 'user',
      status: 'active',
      plan: 'free',
      testAccount: true,
      createdBy: 'cli',
      locale: 'en',
      currency: 'USD',
      marketingConsent: false,
    });
    const accounts = await collections(mongo.db).accounts.find({ userId: created.userId }).toArray();
    expect(accounts).toHaveLength(1);
    expect(accounts[0]).toMatchObject({ providerId: 'credential', accountId: created.userId.toHexString() });
    // scrypt (salt:key), never the password itself.
    expect(accounts[0].password).toMatch(/^[0-9a-f]+:[0-9a-f]+$/);
    expect(accounts[0].password).not.toContain(created.password);
    const audit = await collections(mongo.db).auditEvents.find({ userId: created.userId }).toArray();
    expect(audit.map((e) => e.type)).toEqual(['admin.account_created']);
    expect(audit[0]).toMatchObject({ actor: 'cli', metadata: { method: 'username', plan: 'free', test: true } });
    expect(JSON.stringify(audit)).not.toContain(created.password);
    // No mail is written anywhere for it.
    expect(await collections(mongo.db).mailOutbox.countDocuments({ to: { $regex: USERNAME_EMAIL_DOMAIN } })).toBe(0);
  });

  it('is idempotent: the same username again changes nothing, whatever the capitals', async () => {
    const before = await collections(mongo.db).accounts.findOne({ providerId: 'credential', userId: (await users().findOne({ username: 'tomerfree' }))!._id });
    for (const again of ['Tomerfree', 'TOMERFREE', ' tomerfree ']) {
      const result = await createUsernameAccount(mongo.db, auth, { username: again, plan: 'pro', locale: 'he', test: false, actor: 'cli' });
      expect(result).toEqual({ status: 'exists', userId: before!.userId });
    }
    expect(await users().countDocuments({ username: 'tomerfree' })).toBe(1);
    expect(await users().findOne({ username: 'tomerfree' })).toMatchObject({ plan: 'free', locale: 'en', testAccount: true });
    const after = await collections(mongo.db).accounts.findOne({ _id: before!._id });
    expect(after!.password).toBe(before!.password);
  });

  it('refuses usernames that are too short, too long or have other characters, and a name that is not one', async () => {
    for (const [username, problem] of [['ab', 'too_short'], ['a'.repeat(31), 'too_long'], ['tomer@free', 'invalid'], ['tomer free', 'invalid'], ['טומר', 'invalid'], ['../admin', 'invalid']] as const) {
      expect(await createUsernameAccount(mongo.db, auth, { username, plan: 'free', locale: 'en', test: true, actor: 'cli' })).toEqual({ status: 'invalid', problem });
    }
    expect(await createUsernameAccount(mongo.db, auth, { username: 'fine_name', name: '‮​', plan: 'free', locale: 'en', test: true, actor: 'cli' })).toEqual({
      status: 'invalid',
      problem: 'name',
    });
    expect(await users().countDocuments({ username: 'fine_name' })).toBe(0);
  });

  it('keeps the language and plan it was given, with the matching currency', async () => {
    const created = await createUsernameAccount(mongo.db, auth, { username: 'Tomerpay', name: 'Tomer Pay', plan: 'pro', locale: 'he', test: false, actor: 'admin:abc' });
    if (created.status !== 'created') throw new Error('not created');
    expect(await users().findOne({ _id: created.userId })).toMatchObject({ name: 'Tomer Pay', plan: 'pro', locale: 'he', currency: 'ILS', testAccount: false, createdBy: 'admin:abc' });
    const entitlements = await getEntitlements(mongo.db, created.userId);
    expect(entitlements).toMatchObject({ access: 'pro', role: 'user', planId: 'pro' });
  });

  it('cannot be reached over HTTP: the server-only endpoints do not exist there', async () => {
    const create = await post('/studio/create-username-account', { username: 'sneaky', name: 'Sneaky', password: 'Kp7x-Tq3m-W9fz-Hd2r', plan: 'pro', locale: 'en' });
    expect(create.status).toBe(404);
    const tomer = await users().findOne({ username: 'tomerfree' });
    const set = await post('/studio/set-username-password', { userId: tomer!._id.toHexString(), password: 'Kp7x-Tq3m-W9fz-Hd2r' });
    expect(set.status).toBe(404);
    expect(await users().countDocuments({ username: 'sneaky' })).toBe(0);
  });
});

describe('signing in with a username', () => {
  it('works with the right password, whatever the capitals of the username, and starts a normal session', async () => {
    const { password, userId } = await newTester('Signer');
    for (const typed of ['Signer', 'signer', 'SIGNER']) {
      const result = await signIn(typed, password);
      expect(result.status, typed).toBe(200);
      expect(sessionCookie(result.cookies)).not.toBe('');
      const session = await liveSession(result.cookies);
      expect(session.user).toMatchObject({ id: userId.toHexString(), username: 'signer', displayUsername: 'Signer', role: 'user', status: 'active' });
    }
    expect((await users().findOne({ _id: userId }))!.lastLoginAt).toBeInstanceOf(Date);
    expect(await collections(mongo.db).auditEvents.countDocuments({ userId, type: 'user.login', 'metadata.method': 'username' })).toBe(3);
    // Secure, HTTP-only, same-site cookies (Secure itself needs HTTPS: the production URL).
    const { response } = await signIn('signer', password);
    const cookie = response.headers.getSetCookie().find((c) => c.startsWith('sc.session_token='))!;
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Lax/i);
  });

  it('gives one answer for a wrong password and for a username that does not exist', async () => {
    const { userId } = await newTester('Guarded');
    const wrong = await signIn('guarded', 'Wrong-Pass-Word-1234');
    const unknown = await signIn('nobody_here', 'Wrong-Pass-Word-1234');
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(wrong.body).toEqual(unknown.body);
    expect(wrong.body).toMatchObject({ code: 'INVALID_USERNAME_OR_PASSWORD' });
    expect(sessionCookie(wrong.cookies)).toBe('');
    expect(await collections(mongo.db).auditEvents.countDocuments({ userId, type: 'auth.login_failed', 'metadata.method': 'username' })).toBe(1);
  });

  it('pauses a username after 10 wrong passwords (even for the right one), without touching other usernames', async () => {
    const { password } = await newTester('Hammered');
    const other = await newTester('Bystander');
    for (let i = 0; i < THROTTLES.signInFailures.limit; i++) expect((await signIn('hammered', `Wrong-Guess-${i}-xyz`)).status).toBe(401);
    const paused = await signIn('Hammered', password);
    expect(paused.status).toBe(429);
    expect(paused.body.code).toBe('TOO_MANY_ATTEMPTS');
    expect(sessionCookie(paused.cookies)).toBe('');
    // The same pause for a username nobody has, so a pause reveals nothing.
    for (let i = 0; i < THROTTLES.signInFailures.limit; i++) await signIn('ghost_user', `Wrong-Guess-${i}-xyz`);
    expect((await signIn('ghost_user', 'Wrong-Guess-x')).body.code).toBe('TOO_MANY_ATTEMPTS');
    expect((await signIn('bystander', other.password)).status).toBe(200);
  });

  it('limits attempts from one network address too (5 a minute)', async () => {
    const ip = '10.200.0.1';
    const statuses = [];
    for (let i = 0; i < 7; i++) statuses.push((await signIn(`someone_${i}`, 'Wrong-Guess-xyz', { ip })).status);
    expect(statuses.slice(0, 5)).toEqual([401, 401, 401, 401, 401]);
    expect(statuses.slice(5)).toEqual([429, 429]);
  });

  it('refuses a suspended account, but tells only someone who knows its password', async () => {
    const { password, userId } = await newTester('Paused_one');
    const signedIn = await signIn('paused_one', password);
    expect(await setUserStatus(mongo.db, { userId, status: 'suspended', reason: 'security', actor: 'cli' })).toBe('updated');
    // Its sessions ended at once…
    expect((await liveSession(signedIn.cookies))).toBeNull();
    // …the right password gets a plain answer and no session…
    const right = await signIn('paused_one', password);
    expect(right.status).toBe(403);
    expect(right.body.code).toBe('ACCOUNT_SUSPENDED');
    expect(sessionCookie(right.cookies)).toBe('');
    // …and a wrong one the same answer as anyone's.
    expect((await signIn('paused_one', 'Wrong-Guess-xyz')).body.code).toBe('INVALID_USERNAME_OR_PASSWORD');
    expect(await setUserStatus(mongo.db, { userId, status: 'active', actor: 'cli' })).toBe('updated');
    expect((await signIn('paused_one', password)).status).toBe(200);
  });

  it('does not exist where username sign-in is off', async () => {
    const { password } = await newTester('Switched');
    expect((await signIn('switched', password, { via: usernamesOff })).status).toBe(404);
  });
});

describe('no registration, no email, no way to a Google account', () => {
  it('has no sign-up, no email sign-in or reset and no username lookup; a password can only be changed by its owner', async () => {
    const body = { email: 'someone@example.com', password: 'violet cactus harbor 42', name: 'Someone', username: 'someone', newPassword: 'violet cactus harbor 43', currentPassword: 'x' };
    for (const path of ['/sign-up/email', '/sign-in/email', '/request-password-reset', '/reset-password', '/verify-password', '/send-verification-email', '/is-username-available']) {
      expect((await post(path, body)).status, path).toBe(404);
    }
    // The lookup would tell anyone whether a username exists: never offered, whatever is on.
    expect((await post('/is-username-available', { username: 'tomerfree' }, { via: both })).status).toBe(404);
    // Changing a password exists, but only for a signed-in person who knows the current one.
    expect((await post('/change-password', body)).status).toBe(401);
    expect(await users().countDocuments({ email: 'someone@example.com' })).toBe(0);
    expect(await users().countDocuments({ username: 'someone' })).toBe(0);
  });

  it('nobody can choose or change a username through the API', async () => {
    const { password } = await newTester('Renamer');
    const signedIn = await signIn('renamer', password);
    for (const field of [{ username: 'tomerpay2' }, { displayUsername: 'Boss' }]) {
      const result = await post('/update-user', field, { cookie: signedIn.cookies });
      expect(result.status).toBe(400);
      expect(result.body.code).toBe('USERNAME_NOT_ALLOWED');
    }
    expect(await users().findOne({ username: 'renamer' })).toMatchObject({ displayUsername: 'Renamer' });
    // Where email sign-up is on, it cannot carry a username either.
    const signUp = await post('/sign-up/email', { email: 'new@example.com', password: 'violet cactus harbor 42', name: 'New', username: 'newbie' }, { via: both });
    expect(signUp.status).toBe(400);
    expect(await users().countDocuments({ email: 'new@example.com' })).toBe(0);
  });

  it('where email sign-in is on too, the placeholder address is not a way in, and usernames still work', async () => {
    const { password } = await newTester('Both_ways');
    const byEmail = await post('/sign-in/email', { email: `both_ways@${USERNAME_EMAIL_DOMAIN}`, password }, { via: both });
    expect(byEmail.status).toBe(401);
    expect(sessionCookie(byEmail.cookies)).toBe('');
    expect((await signIn('both_ways', password, { via: both })).status).toBe(200);
  });

  it('a password reset is refused for a Google account, which gets no password', async () => {
    const google = await seedGoogleUser('artist@example.com');
    expect(await resetUsernamePassword(mongo.db, auth, { userId: google, actor: 'admin:abc' })).toEqual({ status: 'not_username_account' });
    expect(await collections(mongo.db).accounts.countDocuments({ userId: google, providerId: 'credential' })).toBe(0);
    expect(await removeUsernameAccount(mongo.db, { userId: google, actor: 'cli' })).toBe('not_username_account');
    expect(await users().countDocuments({ _id: google })).toBe(1);
  });

  it('a username account can never be made an admin, and a Pro plan never makes anyone one', async () => {
    const { userId } = await newTester('Wannabe', 'pro');
    expect(await setUserRole(mongo.db, { userId, role: 'admin', actor: 'cli' })).toBe('username_account');
    expect((await users().findOne({ _id: userId }))!.role).toBe('user');
    expect((await getEntitlements(mongo.db, userId)).access).toBe('pro');
  });
});

describe('what administrators change', () => {
  it('plan changes apply from the next request, without a new account', async () => {
    const { userId } = await newTester('Planner');
    expect((await getEntitlements(mongo.db, userId)).features).not.toContain('export.gif_large');
    expect(await setUserPlan(mongo.db, { userId, plan: 'pro', actor: 'admin:abc' })).toMatchObject({ status: 'updated', from: 'free', to: 'pro' });
    expect((await getEntitlements(mongo.db, userId)).features).toContain('export.gif_large');
    expect(await setUserPlan(mongo.db, { userId, plan: 'free', actor: 'admin:abc' })).toMatchObject({ status: 'updated', from: 'pro', to: 'free' });
    const back = await getEntitlements(mongo.db, userId);
    expect(back).toMatchObject({ access: 'free', planId: 'free' });
    // The five tools stay on Free.
    expect(back.features).toEqual(expect.arrayContaining(['tool.measure', 'tool.study', 'tool.color', 'tool.grid', 'tool.compare']));
  });

  it('a reset makes a new password, the old one stops working, and every session ends', async () => {
    const { password: first, userId } = await newTester('Forgetful');
    const phone = await signIn('forgetful', first);
    const laptop = await signIn('forgetful', first);
    await holdInitialPassword(mongo.db, userId, first, 'cli');
    for (let i = 0; i < 3; i++) await signIn('forgetful', `Wrong-Guess-${i}-xyz`);

    const reset = await resetUsernamePassword(mongo.db, auth, { userId, actor: 'admin:abc' });
    if (reset.status !== 'reset') throw new Error('not reset');
    expect(reset.password).not.toBe(first);
    expect(reset.sessionsEnded).toBe(2);
    expect((await liveSession(phone.cookies))).toBeNull();
    expect((await liveSession(laptop.cookies))).toBeNull();
    expect((await signIn('forgetful', first)).status).toBe(401);
    expect((await signIn('forgetful', reset.password)).status).toBe(200);
    // The initial password waiting to be revealed is gone with it.
    expect(await pendingInitialPassword(mongo.db, userId)).toBeNull();
    const event = await collections(mongo.db).auditEvents.findOne({ userId, type: 'admin.password_reset' });
    expect(event).toMatchObject({ actor: 'admin:abc', metadata: { sessionsEnded: 2 } });
    expect(JSON.stringify(event)).not.toContain(reset.password);
  });

  it("signs an account out everywhere, but never the admin's own", async () => {
    const { password, userId } = await newTester('Wanderer');
    const a = await signIn('wanderer', password);
    await signIn('wanderer', password);
    expect(await endAllSessions(mongo.db, { userId, actor: 'admin:abc', actorUserId: new ObjectId() })).toEqual({ status: 'ended', count: 2 });
    expect((await liveSession(a.cookies))).toBeNull();
    expect(await endAllSessions(mongo.db, { userId, actor: `admin:${userId}`, actorUserId: userId })).toEqual({ status: 'self' });
    expect(await endAllSessions(mongo.db, { userId: new ObjectId(), actor: 'admin:abc' })).toEqual({ status: 'not_found' });
    expect(await collections(mongo.db).auditEvents.findOne({ userId, type: 'admin.sessions_revoked' })).toMatchObject({ metadata: { count: 2 } });
  });

  it('a tester can replace the password they were given, with the current one and within the policy', async () => {
    const { password, userId } = await newTester('Chooser');
    await holdInitialPassword(mongo.db, userId, password, 'cli');
    const signedIn = await signIn('chooser', password);
    const weak = await post('/change-password', { currentPassword: password, newPassword: 'short' }, { cookie: signedIn.cookies });
    expect(weak.status).toBe(400);
    expect(weak.body.code).toBe('PASSWORD_TOO_SHORT');
    const personal = await post('/change-password', { currentPassword: password, newPassword: 'chooser chooser 2026 blue' }, { cookie: signedIn.cookies });
    expect(personal.body.code).toBe('PASSWORD_PERSONAL');
    const wrong = await post('/change-password', { currentPassword: 'not-it-at-all-123', newPassword: 'violet cactus harbor 42' }, { cookie: signedIn.cookies });
    expect(wrong.status).toBe(400);
    const changed = await post('/change-password', { currentPassword: password, newPassword: 'violet cactus harbor 42', revokeOtherSessions: true }, { cookie: signedIn.cookies });
    expect(changed.status).toBe(200);
    expect((await signIn('chooser', 'violet cactus harbor 42')).status).toBe(200);
    expect((await signIn('chooser', password)).status).toBe(401);
    expect(await pendingInitialPassword(mongo.db, userId)).toBeNull();
    expect(await collections(mongo.db).auditEvents.countDocuments({ userId, type: 'user.password_changed' })).toBe(1);
    expect(await collections(mongo.db).mailOutbox.countDocuments({ to: { $regex: USERNAME_EMAIL_DOMAIN } })).toBe(0);
  });

  it('an operator can remove a username account and everything kept with it', async () => {
    const { password, userId } = await newTester('Leaving');
    await signIn('leaving', password);
    expect(await removeUsernameAccount(mongo.db, { userId, actor: 'cli' })).toBe('removed');
    expect(await users().countDocuments({ _id: userId })).toBe(0);
    expect(await collections(mongo.db).accounts.countDocuments({ userId })).toBe(0);
    expect(await collections(mongo.db).sessions.countDocuments({ userId })).toBe(0);
    expect((await signIn('leaving', password)).status).toBe(401);
    expect(await removeUsernameAccount(mongo.db, { userId, actor: 'cli' })).toBe('not_found');
  });
});

describe('the initial password from the command line', () => {
  it('is kept sealed, can be revealed exactly once, and expires', async () => {
    const { password, userId } = await newTester('Handoff');
    const now = new Date();
    const expiresAt = await holdInitialPassword(mongo.db, userId, password, 'cli', now);
    expect(expiresAt.getTime() - now.getTime()).toBe(INITIAL_PASSWORD_HOURS * 60 * 60 * 1000);
    const stored = await collections(mongo.db).passwordHandoffs.findOne({ _id: userId });
    expect(stored!.sealed).not.toContain(password);
    expect(stored!.sealed).toMatch(/^v1\./);
    expect(await pendingInitialPassword(mongo.db, userId)).toEqual({ expiresAt });

    expect(await revealInitialPassword(mongo.db, { userId, actor: 'admin:abc' })).toEqual({ status: 'revealed', password });
    expect(await revealInitialPassword(mongo.db, { userId, actor: 'admin:abc' })).toEqual({ status: 'none' });
    expect(await pendingInitialPassword(mongo.db, userId)).toBeNull();
    expect(await collections(mongo.db).auditEvents.countDocuments({ userId, type: 'admin.initial_password_revealed' })).toBe(1);
    // The revealed password is the account's password.
    expect((await signIn('handoff', password)).status).toBe(200);

    // After its time, nothing is revealed.
    await holdInitialPassword(mongo.db, userId, password, 'cli', new Date(Date.now() - (INITIAL_PASSWORD_HOURS + 1) * 60 * 60 * 1000));
    expect(await pendingInitialPassword(mongo.db, userId)).toBeNull();
    expect(await revealInitialPassword(mongo.db, { userId, actor: 'admin:abc' })).toEqual({ status: 'none' });
  });
});

describe('nightly maintenance', () => {
  it('never removes a username account as an abandoned sign-up, and still removes real ones', async () => {
    const { userId } = await newTester('Oldtimer');
    // An email sign-up through the real endpoint (where it is on), never confirmed.
    const signUp = await post('/sign-up/email', { email: 'abandoned@example.com', password: 'violet cactus harbor 42', name: 'Abandoned' }, { via: both });
    expect(signUp.status).toBe(200);
    const abandoned = await users().findOne({ email: 'abandoned@example.com' });
    expect(abandoned).toMatchObject({ emailVerified: false });
    const monthAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    await users().updateMany({ _id: { $in: [userId, abandoned!._id] } }, { $set: { createdAt: monthAgo } });
    const result = await runMaintenance(mongo.db);
    expect(result.unverifiedRemoved).toBe(1);
    expect(await users().countDocuments({ _id: abandoned!._id })).toBe(0);
    expect(await users().countDocuments({ _id: userId })).toBe(1);
  });
});

describe('the admin dashboard', () => {
  it('finds accounts by username or email, and names username accounts by their username, never the placeholder', async () => {
    const { userId } = await newTester('Searchable_QA', 'pro');
    const google = await seedGoogleUser('searchable.painter@example.com');
    for (const search of ['searchable_qa', 'SEARCHABLE', 'able_q']) {
      const { rows } = await listUsers(mongo.db, { search });
      expect(rows.map((r) => r.id), search).toContain(userId.toHexString());
    }
    const byEmail = await listUsers(mongo.db, { search: 'painter@example' });
    expect(byEmail.rows.map((r) => r.id)).toEqual([google.toHexString()]);
    // Special characters are searched for literally.
    expect((await listUsers(mongo.db, { search: '.*' })).rows).toHaveLength(0);

    const row = (await listUsers(mongo.db, { search: 'searchable_qa' })).rows[0];
    expect(row).toMatchObject({ username: 'Searchable_QA', role: 'user', plan: 'pro', status: 'active', password: true, google: { linked: false }, testAccount: true });
    const detail = await getUserDetail(mongo.db, userId);
    expect(detail).toMatchObject({ username: 'Searchable_QA', role: 'user', plan: 'pro', password: { setAt: expect.any(Date) }, initialPassword: null });
    expect(detail!.lastLoginAt).toBeNull();
    const events = await listAuditEvents(mongo.db, { userId });
    expect(events[0]).toMatchObject({ type: 'admin.account_created', subject: { email: 'Searchable_QA' }, actor: { kind: 'cli' } });
  });

  it("puts the username in the person's own data export", async () => {
    const { userId } = await newTester('Exporter');
    const data = await exportAccountData(mongo.db, userId);
    expect(data!.account).toMatchObject({ username: 'Exporter', role: 'user', plan: 'free' });
    expect(data!.signInMethods.map((m) => m.method)).toEqual(['password']);
    expect(JSON.stringify(data)).not.toMatch(/[0-9a-f]{32}:[0-9a-f]{64}/);
  });

  it('shows an initial password waiting to be revealed, and only for username accounts', async () => {
    const { userId, password } = await newTester('Waiting');
    const expiresAt = await holdInitialPassword(mongo.db, userId, password, 'cli');
    expect((await getUserDetail(mongo.db, userId))!.initialPassword).toEqual({ expiresAt });
    const google = await seedGoogleUser('no-handoff@example.com');
    await holdInitialPassword(mongo.db, google, 'Kp7x-Tq3m-W9fz-Hd2r', 'cli');
    expect((await getUserDetail(mongo.db, google))!.initialPassword).toBeNull();
  });
});
