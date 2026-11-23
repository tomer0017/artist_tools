// Everything the end-to-end tests run against, started by Playwright:
//   1. a throwaway MongoDB (single-node replica set, like Atlas), migrated;
//   2. signed-in test accounts — sessions created in the database and signed
//      with this run's random secret, exactly as Better Auth signs them — whose
//      cookies are written to e2e/.auth/<name>.json for Playwright;
//   3. the production (standalone) server, pointed at that database;
//   4. a second one on port 8081 configured like staging's public sign-in:
//      Google, open to every Google-verified account, plus username sign-in
//      for accounts an admin creates, no mail at all, with its own database
//      (e2e/google-only.spec.ts, e2e/username-accounts.spec.ts). Its username
//      accounts are created the real way (Better Auth, hashed passwords);
//      their per-run random passwords go to e2e/.auth/username-accounts.json;
//   5. a third one on port 8082, set up like staging including its published
//      plan catalog (version 2 of 2026-11-18: Free without Measure & Plan,
//      Compare & Correct and GIFs), published the way an admin publishes,
//      with username accounts on each plan (e2e/entitlements.spec.ts, which
//      publishes other versions through the admin dashboard: nothing else
//      runs against it). Passwords go to e2e/.auth/entitlement-accounts.json.
// The main and plan-enforcement databases also get Learn's synthetic test
// content (src/test/learn-fixture.ts: made-up items and generated images),
// imported and published the way the operator command does, with its assets
// in a temporary directory (ADR-0017). No plan includes a Learn module.
// No login bypass exists in the app: tests are signed in the way a real
// session is, and the server verifies them the same way.
//
// Runs with the react-server condition so `server-only` modules can be imported.
import { spawn } from 'node:child_process';
import { createHmac, randomBytes } from 'node:crypto';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { MongoClient, ObjectId, type Db } from 'mongodb';
import { setOwner } from '@/server/admin';
import { createAuth } from '@/server/auth';
import { catalogSpec, type Catalog } from '@/server/config/catalog';
import { publishDraft, saveDraft } from '@/server/config/versions';
import { migrate } from '@/server/db/migrate';
import { createMailer } from '@/server/mail/mailer';
import { createUsernameAccount, holdInitialPassword } from '@/server/password-accounts';
import { learnContentSpec, publishedLearnContent } from '@/server/learn/content';
import { itemsOf } from '@/lib/learn/model';
import { pricingSpec } from '@/server/config/pricing';
import { setBillingAccess } from '@/server/billing/paypal/subscriptions';
import { importSeed } from '@/server/learn/import';
import { writeLearnFixture } from '@/test/learn-fixture';

const PORT = 8080;
const BASE_URL = `http://localhost:${PORT}`;
const SECRET = randomBytes(32).toString('base64');
const DB_NAME = 'studio_e2e';
const GOOGLE_ONLY_PORT = 8081;
const GOOGLE_ONLY_DB = 'studio_e2e_google_only';
const ENTITLEMENTS_PORT = 8082;
const ENTITLEMENTS_DB = 'studio_e2e_entitlements';
/** The plan catalog published on staging (version 2, 2026-11-18). */
const STAGING_CATALOG: Catalog = {
  plans: {
    free: { features: ['tool.study', 'tool.color', 'tool.grid', 'export.image'], quotas: {} },
    pro: { features: ['tool.measure', 'tool.study', 'tool.color', 'tool.grid', 'tool.compare', 'export.image', 'export.gif', 'export.gif_large', 'export.gif_difference'], quotas: {} },
  },
  disabled: [],
};
// The sealing key of initial passwords comes from the environment's auth
// settings (src/server/security/secret-box.ts); each server gets its own URL.
process.env.BETTER_AUTH_SECRET = SECRET;
process.env.BETTER_AUTH_URL = BASE_URL;
/** Learn's asset directory for this run (outside the repository, like the server's). */
const LEARN_ASSETS_DIR = mkdtempSync(path.join(tmpdir(), 'studio-e2e-learn-assets-'));
// E2E_LEARN_SEED: a seed folder of your own instead (for looking at real test
// content locally, e.g. the private seed kept outside the repository). The
// test suite itself always runs on the synthetic fixture.
const LEARN_SEED = process.env.E2E_LEARN_SEED || writeLearnFixture(mkdtempSync(path.join(tmpdir(), 'studio-e2e-learn-seed-')));
process.env.LEARN_ASSETS_DIR = LEARN_ASSETS_DIR;

/** Import and publish the synthetic Learn content, as `npm run db -- learn-import` and `learn-publish` do. */
async function seedLearn(db: Db) {
  const imported = await importSeed(db, LEARN_ASSETS_DIR, LEARN_SEED, 'cli');
  if (imported.status !== 'saved') throw new Error(`Could not import the Learn fixture: ${JSON.stringify(imported)}`);
  if ((await publishDraft(db, learnContentSpec, 'cli')).status !== 'published') throw new Error('Could not publish the Learn fixture');
}

/** The signed cookie value Better Auth expects: `token.HMAC-SHA256(token)`, URL-encoded. */
const signedCookie = (token: string) => encodeURIComponent(`${token}.${createHmac('sha256', SECRET).update(token).digest('base64')}`);

const ALL_TOOLS = ['measure', 'value', 'color', 'grid', 'compare'];

async function seedSignedInUser(
  db: Db,
  name: string,
  role: 'user' | 'admin',
  plan: 'free' | 'pro' = 'free',
  sessionExpired = false,
  introsSeen = ALL_TOOLS,
  /** How long ago the session started (sensitive changes need one younger than 10 minutes). */
  signedInMinutesAgo = 0,
) {
  const userId = new ObjectId();
  const now = new Date();
  const signedInAt = new Date(now.getTime() - signedInMinutesAgo * 60_000);
  await db.collection('users').insertOne({
    _id: userId,
    name: `E2E ${name}`,
    email: `${name}@e2e.test`,
    emailVerified: true,
    image: null,
    createdAt: now,
    updatedAt: now,
    role,
    status: 'active',
    plan,
    // Tools already introduced, so specs see the plain tool unless they test introductions.
    introsSeen,
    lastLoginAt: now,
    marketingConsent: false,
  });
  await db.collection('audit_events').insertOne({ type: 'user.registered', userId, actor: `user:${userId}`, at: now, metadata: { provider: 'google' } });
  await db.collection('accounts').insertOne({ _id: new ObjectId(), userId, providerId: 'google', accountId: `e2e-${name}`, createdAt: now, updatedAt: now });
  await seedSession(db, userId, name, sessionExpired, signedInAt);
  return userId;
}

/** A signed-in session for an existing account, saved as the storage state `e2e/.auth/<name>.json`. */
async function seedSession(db: Db, userId: ObjectId, name: string, sessionExpired = false, signedInAt = new Date()) {
  const token = randomBytes(24).toString('base64url');
  await db.collection('sessions').insertOne({
    _id: new ObjectId(),
    userId,
    token,
    expiresAt: new Date(Date.now() + (sessionExpired ? -60 * 60 * 1000 : 7 * 24 * 60 * 60 * 1000)),
    createdAt: signedInAt,
    updatedAt: signedInAt,
    ipAddress: '',
    userAgent: 'e2e',
  });
  writeFileSync(
    `e2e/.auth/${name}.json`,
    JSON.stringify({
      cookies: [{ name: 'sc.session_token', value: signedCookie(token), domain: 'localhost', path: '/', expires: -1, httpOnly: true, secure: false, sameSite: 'Lax' }],
      origins: [],
    }),
  );
}

const replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
const client = new MongoClient(replSet.getUri());
await client.connect();
const db = client.db(DB_NAME);
await migrate(db);
await seedLearn(db);
mkdirSync('e2e/.auth', { recursive: true });
await seedSignedInUser(db, 'user', 'user'); // Free: what specs are signed in as by default
await seedSignedInUser(db, 'pro', 'user', 'pro');
// The default admin is the owner, made so the way the operator does it (server command line).
const ownerId = await seedSignedInUser(db, 'admin', 'admin');
await setOwner(db, ownerId, 'cli');
// Learn's screens (e2e/learn-screens.spec.ts, ADR-0018): admins, the only
// accounts Learn opens for until a plan includes it; one per test that keeps
// a history or class mode, since tests run in parallel.
for (const name of ['learner', 'learner-history', 'learner-tools', 'learner-sheets', 'learner-he', 'teacher', 'learner-mobile', 'learner-lesson', 'learner-playground']) await seedSignedInUser(db, name, 'admin');
await seedSignedInUser(db, 'signout', 'user');
// Accounts the admin specs change (plan, role); nothing else relies on them.
await seedSignedInUser(db, 'target', 'user');
await seedSignedInUser(db, 'promote', 'user');
await seedSignedInUser(db, 'leaver', 'user');
await seedSignedInUser(db, 'expired', 'user', 'free', true);
// First-time visitors who have not seen any tool introduction (one per browser project).
await seedSignedInUser(db, 'newbie', 'user', 'free', false, []);
await seedSignedInUser(db, 'newbie-chromium', 'user', 'free', false, []);
await seedSignedInUser(db, 'newbie-iphone-webkit', 'user', 'free', false, []);
// Account-page specs: one that edits its profile, one signed in an hour ago (sensitive changes ask to confirm).
await seedSignedInUser(db, 'editor', 'user');
await seedSignedInUser(db, 'settled', 'user', 'free', false, ALL_TOOLS, 60);
// Admin-dashboard specs: the owner in a session signed in an hour ago (sensitive changes ask to confirm;
// only the owner changes roles), and the accounts it changes.
await seedSession(db, ownerId, 'admin-settled', false, new Date(Date.now() - 60 * 60_000));
await seedSignedInUser(db, 'grantee', 'user');
// A paying account: its subscription and payment as the server writes them from
// verified provider events (no provider is connected in tests). A test account,
// so revenue figures leave it out. The admin specs give and end manual Pro next
// to it and check billing stays exactly as it was.
{
  const subscriber = await seedSignedInUser(db, 'subscriber', 'user');
  const now = new Date();
  const day = 24 * 60 * 60 * 1000;
  await db.collection('users').updateOne({ _id: subscriber }, { $set: { testAccount: true } });
  await db.collection('subscriptions').insertOne({
    userId: subscriber, planId: 'pro', provider: 'e2e', providerCustomerId: 'cus_e2e', providerSubscriptionId: 'sub_e2e', status: 'active',
    currentPeriodStart: new Date(now.getTime() - 10 * day), currentPeriodEnd: new Date(now.getTime() + 20 * day), cancelAtPeriodEnd: false, canceledAt: null,
    createdAt: now, updatedAt: now, interval: 'month', currency: 'USD', amountMinor: 990,
  });
  await db.collection('payments').insertOne({
    provider: 'e2e', providerPaymentId: 'pay_e2e', userId: subscriber, providerSubscriptionId: 'sub_e2e', kind: 'charge', status: 'succeeded',
    amountMinor: 990, currency: 'USD', occurredAt: new Date(now.getTime() - 10 * day), receiptUrl: null, createdAt: now,
  });
}
await seedSignedInUser(db, 'suspendee', 'user');
await seedSignedInUser(db, 'candidate', 'user');
// Manage access back to Free in one step; an admin who is not the owner (owner protection).
await seedSignedInUser(db, 'freeback', 'user');
await seedSignedInUser(db, 'deputy', 'admin');
// A sign-in that must survive closing and reopening the browser (one per browser project).
for (const name of ['persistent-chromium', 'persistent-iphone-webkit']) await seedSignedInUser(db, name, 'user');
// An admin who sets up two-factor verification, with three more sessions of the same account.
{
  const mfaAdmin = await seedSignedInUser(db, 'admin-mfa', 'admin');
  for (const name of ['admin-mfa-2', 'admin-mfa-3', 'admin-mfa-4', 'admin-mfa-5', 'admin-mfa-6', 'admin-mfa-7']) await seedSession(db, mfaAdmin, name);
}
// E2E_BILLING_QA=1 (for looking at the upgrade screens locally; the suite never
// sets it): Pro on sale as on production. A $1 monthly price, subscriptions open
// to everyone, a confirmed shekel rate, Measure and Compare in Pro only, and the
// first two lessons open on Free. PAYPAL_* (sandbox, made up) must be set too;
// nothing reaches PayPal until someone presses Continue with PayPal.
if (process.env.E2E_BILLING_QA === '1') {
  const price = { id: 'pro-month-usd', planId: 'pro' as const, interval: 'month' as const, currency: 'USD' as const, amountMinor: 100, trialDays: null, active: true, providerRefs: {} };
  if ((await saveDraft(db, pricingSpec, { prices: [price] }, 'cli')).status !== 'saved') throw new Error('Could not save the QA price');
  if ((await publishDraft(db, pricingSpec, 'cli')).status !== 'published') throw new Error('Could not publish the QA price');
  await setBillingAccess(db, { openToEveryone: true, testerEmails: [] }, 'cli');
  const now = new Date();
  await db.collection('fx_rates').insertOne({ _id: 'USD_ILS:2026-11-23', pair: 'USD_ILS', date: '2026-11-23', rateMicros: 3_343_000, source: 'boi', fetchedAt: now, checkedAt: now } as never);
  const lessons = itemsOf(await publishedLearnContent(db)).filter((i) => i.collection === 'curriculum' && i.published).map((i) => i.id);
  const all = { mode: 'all' as const };
  const none = { mode: 'none' as const };
  const learnModules = ['learn.curriculum', 'learn.challenges'] as const;
  const qaCatalog = {
    plans: {
      free: { features: [...STAGING_CATALOG.plans.free.features, ...learnModules], quotas: {} },
      pro: { features: [...STAGING_CATALOG.plans.pro.features, ...learnModules], quotas: {} },
    },
    disabled: [],
    learn: {
      access: { free: { curriculum: { mode: 'selected' as const, items: lessons.slice(0, 2) }, color: none, challenges: all }, pro: { curriculum: all, color: none, challenges: all } },
      previews: 'thumbnail' as const,
    },
  };
  if ((await saveDraft(db, catalogSpec, qaCatalog, 'cli', 'Billing QA')).status !== 'saved') throw new Error('Could not save the QA catalog');
  if ((await publishDraft(db, catalogSpec, 'cli')).status !== 'published') throw new Error('Could not publish the QA catalog');
}
// Accounts set to Hebrew that have not seen the tool introductions yet (one per browser project, and one
// whose language the i18n spec switches).
for (const name of ['ivrit-chromium', 'ivrit-iphone-webkit', 'ivrit-switch']) {
  await seedSignedInUser(db, name, 'user', 'free', false, []);
  await db.collection('users').updateOne({ email: `${name}@e2e.test` }, { $set: { locale: 'he', currency: 'ILS' } });
}
// The Google-only server's own accounts: one that has just registered with
// Google (no tool introductions seen yet), an admin, and the username accounts
// of e2e/username-accounts.spec.ts.
{
  const googleOnly = client.db(GOOGLE_ONLY_DB);
  await migrate(googleOnly);
  await seedSignedInUser(googleOnly, 'google-newcomer', 'user', 'free', false, []);
  await seedSignedInUser(googleOnly, 'google-admin', 'admin');
  // The admin that resets and reveals passwords: "signed in" 20 minutes from
  // now, so its sign-in still counts as recent however long the run takes
  // (the rule itself is tested with admin-settled in admin.spec.ts).
  await seedSignedInUser(googleOnly, 'google-admin-qa', 'admin', 'free', false, ALL_TOOLS, -20);
  const auth = createAuth({
    db: googleOnly,
    client,
    baseURL: `http://localhost:${GOOGLE_ONLY_PORT}`,
    secret: SECRET,
    google: null,
    signups: { mode: 'open' },
    usernamePassword: true,
    mailer: createMailer(googleOnly, 'disabled'),
  });
  const testers: Record<string, { username: string; password: string; id: string }> = {};
  const TESTERS: [string, 'free' | 'pro', 'en' | 'he'][] = [
    ['QA_Free', 'free', 'en'],
    ['QA_Pro', 'pro', 'en'],
    ['QA_Ivrit', 'free', 'he'],
    ['QA_Phone', 'free', 'en'],
    ['QA_Phone_He', 'free', 'he'],
    ['QA_Wrong', 'free', 'en'],
    ['QA_Plan', 'free', 'en'],
    ['QA_Reset', 'free', 'en'],
    ['QA_Sessions', 'free', 'en'],
    ['QA_Suspend', 'free', 'en'],
    ['QA_Reveal', 'free', 'en'],
    ['QA_Change', 'free', 'en'],
  ];
  for (const [username, plan, locale] of TESTERS) {
    const created = await createUsernameAccount(googleOnly, auth, { username, plan, locale, test: true, actor: 'cli' });
    if (created.status !== 'created') throw new Error(`Could not seed ${username}: ${created.status}`);
    testers[username] = { username, password: created.password, id: created.userId.toHexString() };
    // Tools already introduced, so specs see the plain tool.
    await googleOnly.collection('users').updateOne({ _id: created.userId }, { $set: { introsSeen: ALL_TOOLS } });
  }
  await holdInitialPassword(googleOnly, new ObjectId(testers.QA_Reveal.id), testers.QA_Reveal.password, 'cli');
  writeFileSync('e2e/.auth/username-accounts.json', JSON.stringify(testers));
}
// The plan-enforcement server's database: staging's published catalog, an
// admin who publishes others and changes plans (its sign-in counts as recent
// for the whole run), and username accounts on each plan, one per scenario.
{
  const entitlements = client.db(ENTITLEMENTS_DB);
  await migrate(entitlements);
  await seedLearn(entitlements);
  if ((await saveDraft(entitlements, catalogSpec, STAGING_CATALOG, 'cli', 'As on staging (version 2, 2026-11-18)')).status !== 'saved') throw new Error('Could not save the staging catalog');
  if ((await publishDraft(entitlements, catalogSpec, 'cli')).status !== 'published') throw new Error('Could not publish the staging catalog');
  await seedSignedInUser(entitlements, 'ent-admin', 'admin', 'free', false, ALL_TOOLS, -60);
  const auth = createAuth({
    db: entitlements,
    client,
    baseURL: `http://localhost:${ENTITLEMENTS_PORT}`,
    secret: SECRET,
    google: null,
    signups: { mode: 'open' },
    usernamePassword: true,
    mailer: createMailer(entitlements, 'disabled'),
  });
  const accounts: Record<string, { username: string; password: string; id: string }> = {};
  const ACCOUNTS: [string, 'free' | 'pro', 'en' | 'he'][] = [
    ['ENT_Free', 'free', 'en'],
    ['ENT_Pro', 'pro', 'en'],
    ['ENT_Ivrit', 'free', 'he'],
    ['ENT_Phone', 'free', 'en'],
    ['ENT_Phone_Pro', 'pro', 'en'],
    ['ENT_Switch', 'free', 'en'],
    ['ENT_Open', 'pro', 'en'],
    ['ENT_Tabs', 'pro', 'en'],
    ['ENT_Export', 'free', 'en'],
    ['ENT_Both_Free', 'free', 'en'],
    ['ENT_Both_Pro', 'pro', 'en'],
  ];
  for (const [username, plan, locale] of ACCOUNTS) {
    const created = await createUsernameAccount(entitlements, auth, { username, plan, locale, test: true, actor: 'cli' });
    if (created.status !== 'created') throw new Error(`Could not seed ${username}: ${created.status}`);
    accounts[username] = { username, password: created.password, id: created.userId.toHexString() };
    await entitlements.collection('users').updateOne({ _id: created.userId }, { $set: { introsSeen: ALL_TOOLS } });
  }
  writeFileSync('e2e/.auth/entitlement-accounts.json', JSON.stringify(accounts));
}
await client.close();

/** The production server on `port`, with this run's database and secret; `overrides` change the settings. */
function startServer(port: number, overrides: Record<string, string | undefined> = {}) {
  return spawn('node', ['.next/standalone/server.js'], {
    stdio: 'inherit',
    // Unset (undefined) values are left out of the child's environment.
    env: {
      ...process.env,
      NODE_ENV: 'production',
      PORT: String(port),
      // Loopback only, as in production (deploy/studio-companion.service). The
      // standalone server listens on $HOSTNAME, which Docker sets to the
      // container's name: in CI's container it never answered on localhost.
      HOSTNAME: '127.0.0.1',
      MONGODB_URI: replSet.getUri(),
      MONGODB_DB: DB_NAME,
      LEARN_ASSETS_DIR,
      BETTER_AUTH_URL: `http://localhost:${port}`,
      BETTER_AUTH_SECRET: SECRET,
      GOOGLE_CLIENT_ID: 'e2e-client-id.apps.googleusercontent.com',
      GOOGLE_CLIENT_SECRET: 'e2e-client-secret',
      // Email + password with the outbox (read by the admin specs), invite-only
      // for the addresses the sign-up specs use.
      APP_ENV: 'test',
      AUTH_EMAIL_PASSWORD: 'on',
      MAIL_TRANSPORT: 'outbox',
      AUTH_SIGNUP_ALLOWLIST: 'newcomer-chromium@e2e.test,phone-chromium@e2e.test,phone-iphone-webkit@e2e.test,hebrew-chromium@e2e.test',
      ...overrides,
    },
  });
}

/** Resolves once `port` answers its readiness check (the database is reachable). */
async function ready(port: number) {
  for (let attempt = 0; attempt < 240; attempt++) {
    try {
      if ((await fetch(`http://localhost:${port}/api/health?ready=1`)).ok) return;
    } catch {
      // Not listening yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`The test server on port ${port} did not become ready`);
}

// The staging-like servers first: Playwright waits for the main one only, so
// by then all three answer.
const stagingLike = { AUTH_SIGNUP_MODE: 'open', AUTH_EMAIL_PASSWORD: 'off', AUTH_USERNAME_PASSWORD: 'on', MAIL_TRANSPORT: undefined, AUTH_SIGNUP_ALLOWLIST: undefined };
const googleOnlyServer = startServer(GOOGLE_ONLY_PORT, { MONGODB_DB: GOOGLE_ONLY_DB, ...stagingLike });
const entitlementsServer = startServer(ENTITLEMENTS_PORT, { MONGODB_DB: ENTITLEMENTS_DB, ...stagingLike });
await ready(GOOGLE_ONLY_PORT);
await ready(ENTITLEMENTS_PORT);
const server = startServer(PORT);
const servers = [server, googleOnlyServer, entitlementsServer];

let stopping = false;
const stop = async (code = 0) => {
  if (stopping) return;
  stopping = true;
  for (const child of servers) child.kill('SIGTERM');
  await replSet.stop();
  process.exit(code);
};
process.on('SIGINT', () => void stop());
process.on('SIGTERM', () => void stop());
// If either server stops, the run is over.
for (const child of servers) child.on('exit', (code) => void stop(code ?? 0));
