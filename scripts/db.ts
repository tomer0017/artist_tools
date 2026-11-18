// Database operations for operators, run on a trusted machine that has the
// environment configured (.env.local locally; the server's env file there):
//
//   npm run db -- migrate                     create indexes, sync plans, backfill (idempotent)
//   npm run db -- list-users                  every account, emails masked, with its Google link
//   npm run db -- find-user <email>           show a user's id (they must have signed in once)
//   npm run db -- grant-admin <userId>        give a verified Google account the admin role (audited)
//   npm run db -- revoke-admin <userId>       take the admin role away; never from the last admin (audited)
//   npm run db -- set-plan <userId> free|pro  assign a plan without billing, for testing (audited)
//   npm run db -- maintenance                 nightly: remove never-confirmed password sign-ups, prune rate limits
//   npm run db -- mail-test <email> [en|he]   check the email provider: connect, sign in, send one test message
//   npm run db -- create-tester <username> free|pro [he]
//                                             a username account for a tester (ADR-0012); does nothing if the
//                                             username exists; its password is never printed: it can be revealed
//                                             once in the admin dashboard for 72 hours
//   npm run db -- remove-tester <username>    delete a username account (never a Google account or an admin)
//   npm run db -- login-test                  check username sign-in end to end over this server's own URL,
//                                             with a temporary account that is removed afterwards
//   npm run db -- entitlement-test [--publish-check [--hold <seconds>]]
//                                             check over this server's own URL that each plan gets exactly what
//                                             the published catalog gives it (every tool and export, refusals
//                                             included), and a plan change, with temporary accounts removed
//                                             afterwards; --publish-check also records the live version and
//                                             content, publishes a temporary version over exactly that version
//                                             (Create a Grid off for everyone; Free gains Measure & Plan, Compare
//                                             & Correct and GIFs, loses saving images), checks it, then publishes
//                                             the recorded content again over the temporary version only (never
//                                             over an admin's draft or publication: it stops and says so) and
//                                             checks the live content equals the record; refuses to start while
//                                             a catalog draft exists; --hold keeps the temporary version up to
//                                             600 s, or until a line arrives on standard input
//   npm run db -- temp-testers create|remove  temporary username accounts (Free, Pro, Free in Hebrew) for a browser check
//                                             of this server; `create` writes their passwords to standard
//                                             output, which must be a pipe or a file, never a terminal;
//                                             `remove` deletes every such account
//
// Admin access is granted only here or by another admin, always by user id —
// never from configuration or an email address. Username accounts can never
// be admins.
//
// Runs with the react-server condition so `server-only` modules can be imported.
import { existsSync } from 'node:fs';
import { createHash, randomBytes } from 'node:crypto';
import { EXPORT_FEATURE_IDS, FEATURES, TOOL_FEATURE_IDS, isPlanId, type FeatureId, type PlanId, type PlanOffer } from '@/lib/plans';
import { findUserByEmail, getUserDetail, listUsers, setUserPlan, setUserRole, setUserStatus } from '@/server/admin';
import { authFromEnvironment } from '@/server/auth';
import { CatalogSchema, catalogSpec, type Catalog } from '@/server/config/catalog';
import { getDraft, getPublished, publishIfUnchanged } from '@/server/config/versions';
import { closeMongo, getDb } from '@/server/db/client';
import { collections, toObjectId } from '@/server/db/collections';
import { migrate } from '@/server/db/migrate';
import { authConfig } from '@/server/env';
import { getPlanOffer } from '@/server/entitlements';
import { createMailer } from '@/server/mail/mailer';
import { mailTemplates } from '@/server/mail/templates';
import { runMaintenance } from '@/server/maintenance';
import { resetMfa } from '@/server/admin-mfa';
import {
  INITIAL_PASSWORD_HOURS,
  createUsernameAccount,
  findByUsername,
  holdInitialPassword,
  removeUsernameAccount,
  resetUsernamePassword,
} from '@/server/password-accounts';

if (existsSync('.env.local')) process.loadEnvFile('.env.local');

const USAGE =
  'Usage: npm run db -- migrate | list-users | find-user <email> | grant-admin <userId> | revoke-admin <userId> | set-plan <userId> free|pro | reset-admin-mfa <userId> | maintenance | mail-test <email> [en|he] | create-tester <username> free|pro [he] | remove-tester <username> | login-test | entitlement-test [--publish-check [--hold <seconds>]] | temp-testers create|remove';

/** Emails are personal data: operators see enough to recognise an account, not the address. */
const mask = (email: string) => {
  const [local = '', domain = ''] = email.split('@');
  return `${local.slice(0, 1)}***@${domain}`;
};
const when = (date: Date | null) => (date ? date.toISOString().replace('T', ' ').slice(0, 16) + 'Z' : '—');

function invitation(email: string): string {
  try {
    const { signups } = authConfig();
    if (signups.mode === 'open') return 'open registration';
    return signups.invited.includes(email.trim().toLowerCase()) ? 'on the invite list' : 'not on the invite list';
  } catch {
    return 'invite list unknown';
  }
}

function userIdFrom(arg: string | undefined) {
  const userId = toObjectId(arg);
  if (!userId) throw new Error(`${USAGE}\n(userId must be the 24-character id shown by list-users or find-user)`);
  return userId;
}

async function main(command: string | undefined, arg: string | undefined, arg2: string | undefined): Promise<void> {
  const db = getDb();
  switch (command) {
    case 'migrate': {
      const r = await migrate(db);
      console.log(`Migration done: ${r.indexes} indexes ensured, ${r.configSeeded} configuration kinds published with defaults, ${r.plansInserted} plans inserted, ${r.plansUpdated} plans updated, ${r.usersBackfilled} accounts set to Free, ${r.preferencesBackfilled} given default language and currency.`);
      return;
    }
    case 'list-users': {
      const { rows, total } = await listUsers(db, { pageSize: 200 });
      console.log(`${total} account(s)`);
      for (const u of rows) {
        console.log(
          [
            u.id,
            u.username ? `username:${u.username}` : mask(u.email),
            `verified:${u.emailVerified ? 'yes' : 'no'}`,
            `google:${u.google.linked ? u.google.idHint : 'none'}`,
            `role:${u.role}`,
            `plan:${u.plan}`,
            `status:${u.status}`,
            `created:${when(u.createdAt)}`,
            `last-login:${when(u.lastLoginAt)}`,
            `logins:${u.logins}`,
            invitation(u.email),
          ].join('  '),
        );
      }
      return;
    }
    case 'find-user': {
      if (!arg) throw new Error(USAGE);
      const user = await findUserByEmail(db, arg);
      if (!user) throw new Error('No user with that email. They need to sign in once first.');
      console.log(`id: ${user._id.toHexString()}  name: ${user.name}  role: ${user.role ?? 'user'}  status: ${user.status ?? 'active'}`);
      return;
    }
    case 'grant-admin': {
      const userId = userIdFrom(arg);
      const detail = await getUserDetail(db, userId);
      if (!detail) throw new Error('No user with that id.');
      const googleAccounts = await collections(db).accounts.countDocuments({ userId, providerId: 'google' });
      console.log(
        `Account ${detail.id}: ${mask(detail.email)}, email verified: ${detail.emailVerified ? 'yes' : 'no'}, ` +
          `Google identity: ${googleAccounts === 1 ? detail.google.idHint : `${googleAccounts} found`}, status: ${detail.status}, ` +
          `created ${when(detail.createdAt)}, last login ${when(detail.lastLoginAt)}, ${detail.logins} login(s), ${invitation(detail.email)}`,
      );
      // Only a real, verified Google sign-in can become an admin.
      if (detail.status !== 'active') throw new Error('Refused: the account is not active.');
      if (!detail.emailVerified) throw new Error('Refused: Google has not verified this email address.');
      if (googleAccounts !== 1) throw new Error('Refused: the account must be linked to exactly one Google identity.');
      const result = await setUserRole(db, { userId, role: 'admin', actor: 'cli' });
      console.log(result === 'unchanged' ? 'Already an admin; nothing changed.' : 'Granted: the account is now an admin (recorded in the audit log).');
      return;
    }
    case 'revoke-admin': {
      const userId = userIdFrom(arg);
      const result = await setUserRole(db, { userId, role: 'user', actor: 'cli' });
      if (result === 'not_found') throw new Error('No user with that id.');
      if (result === 'last_admin') throw new Error('Refused: this is the last admin. Grant admin to another account first.');
      console.log(result === 'unchanged' ? 'Not an admin; nothing changed.' : 'Revoked: the account is now a regular user (recorded in the audit log).');
      return;
    }
    case 'set-plan': {
      const userId = userIdFrom(arg);
      if (!isPlanId(arg2)) throw new Error(USAGE);
      const result = await setUserPlan(db, { userId, plan: arg2, actor: 'cli' });
      if (result.status === 'not_found') throw new Error('No user with that id.');
      console.log(result.status === 'unchanged' ? `Already on ${arg2}; nothing changed.` : `Plan changed: ${result.from} → ${result.to} (recorded in the audit log).`);
      return;
    }
    case 'reset-admin-mfa': {
      // For an administrator who lost both the phone and the recovery codes:
      // removes their two-factor setup (audited); they can enrol again.
      const userId = userIdFrom(arg);
      const removed = await resetMfa(db, userId, 'cli');
      console.log(removed ? 'Two-factor verification removed for that account (recorded in the audit log).' : 'That account had no two-factor verification.');
      return;
    }
    case 'maintenance': {
      const r = await runMaintenance(db);
      console.log(
        `Maintenance done: ${r.unverifiedRemoved} never-confirmed sign-ups removed, ${r.rateLimitsPruned} idle rate-limit rows pruned, ` +
          `${r.analyticsPruned} analytics events and ${r.auditPruned} audit events past their retention deleted.`,
      );
      return;
    }
    case 'mail-test': {
      // After setting up email (deploy/set-mail.sh): proves the provider
      // accepts this server's connection and sign-in, then sends one message.
      if (!arg?.includes('@')) throw new Error(USAGE);
      const { mail } = authConfig();
      const mailer = createMailer(db, mail.transport, mail);
      console.log(`Transport: ${mail.transport}. Sender: ${mail.from}.${mail.smtp ? ` Server: ${mail.smtp.host}:${mail.smtp.port} (TLS).` : ''}`);
      if (mail.transport === 'smtp') {
        const check = await mailer.check();
        if (!check.ok) throw new Error(`The mail server refused the connection or the sign-in: ${'reason' in check ? check.reason : 'no reason given'}`);
        console.log('Connected and signed in to the mail server.');
      }
      const result = await mailer.deliver(mailTemplates(arg2).deliveryTest(), { address: arg, userId: null });
      const outcomes: Record<typeof result, string> = {
        sent: mail.transport === 'smtp' ? `The provider accepted the message for ${mask(arg)}. Check that inbox, and its spam folder.` : `Kept in the outbox (/admin/mail) for ${mask(arg)}; nothing was emailed.`,
        throttled: `Not sent: ${mask(arg)} already had 3 test messages this hour.`,
        disabled: 'Not sent: MAIL_TRANSPORT is disabled.',
        failed: 'The provider refused the message; the error code is in the log (mail.failed).',
      };
      console.log(outcomes[result]);
      if (result !== 'sent') process.exitCode = 1;
      return;
    }
    case 'create-tester': {
      // Idempotent: an existing username is reported and left exactly as it is.
      if (!arg || !isPlanId(arg2)) throw new Error(USAGE);
      const locale = process.argv[5] === 'he' ? 'he' : 'en';
      const auth = authFromEnvironment({ nextjs: false });
      const result = await createUsernameAccount(db, auth, { username: arg, plan: arg2, locale, test: true, actor: 'cli' });
      if (result.status === 'invalid') throw new Error(`Refused: that username or name cannot be used (${result.problem}). Usernames are 3–30 English letters, digits, dots or underscores.`);
      if (result.status === 'conflict') throw new Error('Refused: that username cannot be used.');
      if (result.status === 'exists') {
        const existing = await findByUsername(db, arg);
        console.log(
          `${existing?.displayUsername ?? arg} already exists (id ${result.userId.toHexString()}, role ${existing?.role ?? 'user'}, plan ${existing?.plan ?? 'free'}, ` +
            `status ${existing?.status ?? 'active'}): nothing changed. To give it a new password, use Reset password in the admin dashboard.`,
        );
        return;
      }
      // The password is never printed: it is sealed for one reveal in the dashboard.
      const until = await holdInitialPassword(db, result.userId, result.password, 'cli');
      console.log(
        `Created ${result.username} (id ${result.userId.toHexString()}): role user, plan ${arg2}, active, test account, language ${locale}. ` +
          `Its initial password was not printed; reveal it once in the admin dashboard (Users → ${result.username} → Reveal initial password) ` +
          `until ${when(until)} (${INITIAL_PASSWORD_HOURS} hours). Recorded in the audit log.`,
      );
      return;
    }
    case 'remove-tester': {
      if (!arg) throw new Error(USAGE);
      const existing = await findByUsername(db, arg);
      if (!existing) throw new Error('No account with that username.');
      const removed = await removeUsernameAccount(db, { userId: existing._id, actor: 'cli' });
      if (removed !== 'removed') throw new Error('Refused: only a username account that is not an admin can be removed this way.');
      console.log(`Removed ${existing.displayUsername ?? arg} (id ${existing._id.toHexString()}) and its sessions, password and data (recorded in the audit log).`);
      return;
    }
    case 'login-test':
      process.exitCode = await loginTest(db);
      return;
    case 'entitlement-test': {
      if (arg !== undefined && arg !== '--publish-check') throw new Error(USAGE);
      const holdAt = process.argv.indexOf('--hold');
      const hold = holdAt > 0 ? Number(process.argv[holdAt + 1]) : 0;
      if (!Number.isInteger(hold) || hold < 0 || hold > 600 || (hold > 0 && arg !== '--publish-check')) throw new Error(USAGE);
      process.exitCode = await entitlementTest(db, arg === '--publish-check', hold);
      return;
    }
    case 'temp-testers':
      if (arg === 'create') return createTempTesters(db);
      if (arg === 'remove') return removeTempTesters(db);
      throw new Error(USAGE);
    default:
      throw new Error(USAGE);
  }
}

/**
 * Username sign-in, end to end through this server's public address (nginx,
 * TLS, the app), with a temporary test account that is removed at the end
 * whatever happens. Passwords stay in memory: nothing secret is printed.
 * At most 5 sign-ins a minute (the per-network limit), so it pauses once.
 */
async function loginTest(db: ReturnType<typeof getDb>): Promise<number> {
  const { baseURL, usernamePassword } = authConfig();
  if (!usernamePassword) {
    console.log('Username sign-in is off here (AUTH_USERNAME_PASSWORD); nothing to test.');
    return 1;
  }
  const base = new URL(baseURL).origin;
  const auth = authFromEnvironment({ nextjs: false });
  const username = `logintest_${randomBytes(3).toString('hex')}`;
  const results: [string, boolean][] = [];
  const check = (label: string, ok: boolean) => {
    results.push([label, ok]);
    console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${label}`);
  };
  const signIn = async (password: string) => {
    const response = await fetchRetrying(`${base}/api/auth/sign-in/username`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: base },
      body: JSON.stringify({ username, password }),
      redirect: 'manual',
    });
    const cookies = response.headers.getSetCookie();
    const body = (await response.json().catch(() => null)) as { code?: string } | null;
    return { status: response.status, code: body?.code, cookie: cookies.map((c) => c.split(';')[0]).join('; '), raw: cookies };
  };
  const me = async (cookie: string) => {
    const response = await fetchRetrying(`${base}/api/me`, { headers: { cookie } });
    return { status: response.status, body: (await response.json().catch(() => null)) as { user?: { username?: string; role?: string; features?: string[]; plan?: { effective?: string } } } | null };
  };
  const status = async (path: string, cookie: string) => (await fetchRetrying(`${base}${path}`, { headers: { cookie }, redirect: 'manual' })).status;

  console.log(`Username sign-in test against ${base} with a temporary account (${username}):`);
  const created = await createUsernameAccount(db, auth, { username, plan: 'free', locale: 'en', test: true, actor: 'cli' });
  if (created.status !== 'created') {
    console.log(`  FAIL  could not create the temporary account (${created.status})`);
    return 1;
  }
  try {
    const first = await signIn(created.password);
    const session = first.raw.find((c) => /^(__Secure-)?sc\.session_token=/.test(c)) ?? '';
    check('signs in with username and password', first.status === 200 && session !== '');
    check('the session cookie is Secure, HttpOnly and SameSite=Lax', /;\s*Secure/i.test(session) && /HttpOnly/i.test(session) && /SameSite=Lax/i.test(session));
    const free = await me(first.cookie);
    const offer = await getPlanOffer(db);
    check(
      'the studio knows the account: user role, Free, exactly what the published Free plan includes',
      free.status === 200 && free.body?.user?.username === username && free.body.user.role === 'user' && free.body.user.plan?.effective === 'free' &&
        JSON.stringify(free.body.user.features) === JSON.stringify(offer.free),
    );
    check('admin pages and the admin export do not exist for it (404)', (await status('/admin', first.cookie)) === 404 && (await status('/admin/activity/export', first.cookie)) === 404);
    await setUserPlan(db, { userId: created.userId, plan: 'pro', actor: 'cli' });
    const pro = await me(first.cookie);
    check('a plan change to Pro applies on the next request', pro.body?.user?.plan?.effective === 'pro' && JSON.stringify(pro.body.user.features) === JSON.stringify(offer.pro));
    await setUserPlan(db, { userId: created.userId, plan: 'free', actor: 'cli' });
    check('and back to Free', (await me(first.cookie)).body?.user?.plan?.effective === 'free');
    const wrong = await signIn('Not-The-Pass-word-42');
    check('a wrong password gets the one generic answer (401)', wrong.status === 401 && wrong.code === 'INVALID_USERNAME_OR_PASSWORD' && wrong.cookie === '');

    const reset = await resetUsernamePassword(db, auth, { userId: created.userId, actor: 'cli' });
    if (reset.status !== 'reset') throw new Error('reset failed');
    check('a password reset signs it out at once', (await me(first.cookie)).status === 401);
    console.log('  …   waiting a minute (at most 5 sign-ins a minute from one network)');
    await new Promise((resolve) => setTimeout(resolve, 61_000));
    check('the old password stops working', (await signIn(created.password)).status === 401);
    const second = await signIn(reset.password);
    check('the new password works', second.status === 200 && (await me(second.cookie)).status === 200);

    await setUserStatus(db, { userId: created.userId, status: 'suspended', reason: 'other', actor: 'cli' });
    check('suspending it ends its session at once', (await me(second.cookie)).status === 401);
    const suspended = await signIn(reset.password);
    check('a suspended account cannot sign in (403, no session)', suspended.status === 403 && suspended.code === 'ACCOUNT_SUSPENDED' && suspended.cookie === '');
  } catch (error) {
    check(`unexpected error: ${error instanceof Error ? error.message : String(error)}`, false);
  } finally {
    const removed = await removeUsernameAccount(db, { userId: created.userId, actor: 'cli' });
    console.log(`  ${removed === 'removed' ? 'ok  ' : 'FAIL'}  the temporary account was removed`);
    if (removed !== 'removed') results.push(['cleanup', false]);
  }
  const failed = results.filter(([, ok]) => !ok).length;
  console.log(failed === 0 ? 'All checks passed.' : `${failed} check(s) failed.`);
  return failed === 0 ? 0 : 1;
}

/**
 * fetch, tried again (up to five times, two seconds apart) when the request
 * could not be made at all — this server's resolver sometimes takes 5 to 15 s
 * to resolve its own public (sslip.io) name — but never after an answer,
 * whatever it is.
 */
async function fetchRetrying(url: string, init?: RequestInit): Promise<Response> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await fetch(url, init);
    } catch (error) {
      if (attempt >= 5) throw error;
      await new Promise((resolve) => setTimeout(resolve, 2_000));
    }
  }
}

/** Sign in over this server's public address; the session cookie (in memory only), or null. */
async function httpsSignIn(base: string, username: string, password: string): Promise<string | null> {
  const response = await fetchRetrying(`${base}/api/auth/sign-in/username`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: base },
    body: JSON.stringify({ username, password }),
    redirect: 'manual',
  });
  if (response.status !== 200) return null;
  return response.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
}

/** A catalog version's content as one comparable fingerprint (key order does not matter). */
function fingerprint(value: unknown): string {
  const canonical = (v: unknown): unknown =>
    Array.isArray(v) ? v.map(canonical) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canonical((v as Record<string, unknown>)[k])])) : v;
  return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex').slice(0, 16);
}

/** What `plans` holds per plan, without timestamps (an absent daily limit and an empty one are the same). */
async function plansState(db: ReturnType<typeof getDb>) {
  const docs = await collections(db).plans.find({}, { sort: { _id: 1 } }).toArray();
  return docs.map((p) => ({ id: p._id, active: p.active, features: p.features, limits: p.limits ?? {}, dailyLimits: p.dailyLimits ?? {} }));
}

/** Waits up to `seconds`, or until a line arrives on standard input (a browser check that is done says so). */
function holdFor(seconds: number): Promise<'line' | 'time'> {
  return new Promise((resolve) => {
    const finish = (how: 'line' | 'time') => {
      clearTimeout(timer);
      process.stdin.off('data', onData);
      // Done with standard input: an open pipe would keep the process from exiting.
      process.stdin.destroy();
      resolve(how);
    };
    const onData = (chunk: Buffer | string) => {
      if (String(chunk).includes('\n')) finish('line');
    };
    const timer = setTimeout(() => finish('time'), seconds * 1000);
    process.stdin.on('data', onData);
    process.stdin.on('error', () => undefined);
    process.stdin.resume();
  });
}

/**
 * What each plan may use, end to end through this server's public address
 * (nginx, TLS, the app), compared with the published catalog: for a
 * temporary Free account and a temporary Pro account, every tool (allowed or
 * refused with the tool named), every export from a tool the plan includes,
 * what /api/me reports, and a plan change on the same session.
 *
 * With `publishCheck`, a real change of published entitlements: the live
 * version and its exact content are recorded first; a temporary version is
 * published over exactly that version (Create a Grid off for everyone; Free
 * gains Measure & Plan, Compare & Correct and GIFs, and loses saving images)
 * and checked; after `holdSeconds` (or a line on standard input) the recorded
 * content is published again, over the temporary version only. If anyone
 * published or opened a draft meanwhile, nothing of theirs is overwritten:
 * the restore stops and says so. At the end the live content must equal the
 * recorded one. Nothing secret is printed; the temporary accounts (and their
 * sessions) are removed at the end.
 */
async function entitlementTest(db: ReturnType<typeof getDb>, publishCheck: boolean, holdSeconds = 0): Promise<number> {
  const { baseURL, usernamePassword } = authConfig();
  if (!usernamePassword) {
    console.log('Username sign-in is off here (AUTH_USERNAME_PASSWORD); the test signs in with temporary username accounts.');
    return 1;
  }
  const live = await getPublished(db, catalogSpec);
  if (publishCheck && (await getDraft(db, catalogSpec))) {
    console.log('A catalog draft exists: publishing a test version would publish it. Nothing was done; publish or discard the draft first.');
    return 1;
  }
  // The exact live configuration, recorded before anything changes.
  const snapshot = {
    version: live?.version ?? null,
    publishedAt: live?.publishedAt ?? null,
    publishedBy: live?.publishedBy ?? null,
    document: CatalogSchema.parse(live?.document ?? catalogSpec.defaults()),
    plans: await plansState(db),
  };
  const base = new URL(baseURL).origin;
  const auth = authFromEnvironment({ nextjs: false });
  const suffix = randomBytes(3).toString('hex');
  const results: [string, boolean][] = [];
  const check = (label: string, ok: boolean) => {
    results.push([label, ok]);
    console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${label}`);
  };
  const usage = async (cookie: string, body: { tool?: FeatureId; features?: FeatureId[] }) => {
    const response = await fetchRetrying(`${base}/api/usage`, { method: 'POST', headers: { 'content-type': 'application/json', origin: base, cookie }, body: JSON.stringify(body) });
    const answer = (await response.json().catch(() => ({}))) as { features?: string[] };
    return { status: response.status, refused: answer.features ?? [] };
  };
  const meFeatures = async (cookie: string) => {
    const response = await fetchRetrying(`${base}/api/me?check=1`, { headers: { cookie } });
    return response.ok ? (((await response.json()) as { user: { features: string[] } }).user.features) : null;
  };
  const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

  /** Every tool and export for one account, against what its plan includes as published now. */
  const checkPlan = async (label: string, cookie: string, planId: PlanId, offer: PlanOffer) => {
    const included = offer[planId];
    check(`${label}: /api/me reports exactly the published ${planId} plan (${included.length} features)`, same(await meFeatures(cookie), included));
    let wrong: string[] = [];
    for (const tool of TOOL_FEATURE_IDS) {
      const answer = await usage(cookie, { tool });
      const expected = included.includes(tool) ? { status: 200, refused: [] } : { status: 403, refused: [tool] };
      if (!same(answer, expected)) wrong.push(`${tool}: ${answer.status}`);
    }
    const allowedTools = TOOL_FEATURE_IDS.filter((t) => included.includes(t)).map(String).join(', ') || 'none';
    check(`${label}: tools open exactly as published (allowed: ${allowedTools})${wrong.length ? ` — wrong: ${wrong.join('; ')}` : ''}`, wrong.length === 0);
    // Exports, from a tool the plan includes (or the server must refuse the tool first).
    const from = TOOL_FEATURE_IDS.find((t) => included.includes(t)) ?? null;
    wrong = [];
    for (const feature of EXPORT_FEATURE_IDS) {
      const features: FeatureId[] = feature === 'export.gif_large' || feature === 'export.gif_difference' ? ['export.gif', feature] : [feature];
      const answer = await usage(cookie, from ? { tool: from, features } : { features });
      const missing = features.filter((f) => !included.includes(f));
      const expected = missing.length === 0 ? { status: 200, refused: [] } : { status: 403, refused: missing };
      if (!same(answer, expected)) wrong.push(`${feature}: ${answer.status}`);
    }
    check(`${label}: exports allowed or refused exactly as published${wrong.length ? ` — wrong: ${wrong.join('; ')}` : ''}`, wrong.length === 0);
    // A tool the plan lacks refuses its exports too, whatever they are.
    const lacking = TOOL_FEATURE_IDS.find((t) => !included.includes(t));
    if (lacking) check(`${label}: an export from ${lacking} (not in the plan) is refused`, same(await usage(cookie, { tool: lacking, features: ['export.image'] }), { status: 403, refused: [lacking] }));
  };

  console.log(`Plan enforcement test against ${base}, published catalog version ${live?.version ?? '(defaults)'}, temporary accounts:`);
  if (publishCheck) {
    const d = snapshot.document;
    console.log(`  …   recorded the live configuration: version ${snapshot.version}, published ${snapshot.publishedAt?.toISOString() ?? '—'} by ${snapshot.publishedBy ?? '—'}, content ${fingerprint(d)}`);
    console.log(`        Free: ${d.plans.free.features.join(', ') || 'nothing'}; quotas ${JSON.stringify(d.plans.free.quotas)}`);
    console.log(`        Pro: ${d.plans.pro.features.join(', ') || 'nothing'}; quotas ${JSON.stringify(d.plans.pro.quotas)}`);
    console.log(`        off for everyone: ${d.disabled.join(', ') || 'nothing'}; plans documents ${fingerprint(snapshot.plans)}`);
  }
  const created: { userId: import('mongodb').ObjectId; planId: PlanId; cookie: string | null }[] = [];
  /** The temporary version, once published over the recorded one. */
  let temporaryVersion: number | null = null;
  try {
    for (const planId of ['free', 'pro'] as const) {
      const account = await createUsernameAccount(db, auth, { username: `enttest_${planId}_${suffix}`, plan: planId, locale: 'en', test: true, actor: 'cli' });
      if (account.status !== 'created') throw new Error(`could not create the temporary ${planId} account (${account.status})`);
      // Held for the clean-up before anything else can fail.
      const entry: { userId: import('mongodb').ObjectId; planId: PlanId; cookie: string | null } = { userId: account.userId, planId, cookie: null };
      created.push(entry);
      entry.cookie = await httpsSignIn(base, account.username, account.password);
    }
    check('both temporary accounts sign in over HTTPS', created.every((c) => c.cookie));
    const [free, pro] = created.map((c) => ({ cookie: c.cookie ?? '' }));
    const offer = await getPlanOffer(db);
    await checkPlan('Free', free.cookie, 'free', offer);
    await checkPlan('Pro', pro.cookie, 'pro', offer);
    const proOnlyTool = TOOL_FEATURE_IDS.find((t) => offer.pro.includes(t) && !offer.free.includes(t));
    if (proOnlyTool) {
      await setUserPlan(db, { userId: created[0].userId, plan: 'pro', actor: 'cli' });
      check(`Free → Pro on the same session: ${proOnlyTool} is allowed at once`, (await usage(free.cookie, { tool: proOnlyTool })).status === 200);
      await setUserPlan(db, { userId: created[0].userId, plan: 'free', actor: 'cli' });
      check(`and back to Free: ${proOnlyTool} is refused again`, (await usage(free.cookie, { tool: proOnlyTool })).status === 403);
    }

    if (publishCheck) {
      const changed: Catalog = structuredClone(snapshot.document);
      changed.disabled = [...new Set([...changed.disabled, 'tool.grid' as const])];
      const freePlan = changed.plans.free;
      freePlan.features = FEATURES.filter((f) => (freePlan.features.includes(f) || f === 'tool.measure' || f === 'tool.compare' || f === 'export.gif') && f !== 'export.image');
      delete freePlan.quotas['export.image'];
      const published = await publishIfUnchanged(db, catalogSpec, changed, { version: snapshot.version }, 'cli',
        'Entitlement test (temporary): Create a Grid off for everyone; Free gains Measure & Plan, Compare & Correct and GIFs, loses saved images');
      if (published.status !== 'published') throw new Error(`the temporary version was not published (${published.status}): the live configuration changed before it could be`);
      temporaryVersion = published.version;
      check(`published a temporary version (version ${published.version}, over version ${snapshot.version} only)`, true);
      const temporary = await getPlanOffer(db);
      check('Free and Pro lose Create a Grid at once (403 on the same sessions)', (await usage(free.cookie, { tool: 'tool.grid' })).status === 403 && (await usage(pro.cookie, { tool: 'tool.grid' })).status === 403);
      check('Free gains Measure & Plan and Compare & Correct at once', (await usage(free.cookie, { tool: 'tool.measure' })).status === 200 && (await usage(free.cookie, { tool: 'tool.compare' })).status === 200);
      check('Free saves GIFs from Compare & Correct, never the Pro ones', (await usage(free.cookie, { tool: 'tool.compare', features: ['export.gif'] })).status === 200 &&
        same(await usage(free.cookie, { tool: 'tool.compare', features: ['export.gif', 'export.gif_large'] }), { status: 403, refused: ['export.gif_large'] }) &&
        same(await usage(free.cookie, { tool: 'tool.compare', features: ['export.gif', 'export.gif_difference'] }), { status: 403, refused: ['export.gif_difference'] }));
      check('Free can no longer save images; Pro still can', same(await usage(free.cookie, { tool: 'tool.study', features: ['export.image'] }), { status: 403, refused: ['export.image'] }) &&
        (await usage(pro.cookie, { tool: 'tool.study', features: ['export.image'] })).status === 200);
      await checkPlan('Free, temporary version', free.cookie, 'free', temporary);
      await checkPlan('Pro, temporary version', pro.cookie, 'pro', temporary);
      if (holdSeconds > 0) {
        console.log(`  …   keeping the temporary version up to ${holdSeconds} s, or until a line arrives on standard input (a browser check is watching)`);
        const how = await holdFor(holdSeconds);
        console.log(`  …   ${how === 'line' ? 'the browser check is done' : 'the time is up'}: restoring`);
      }
    }
  } catch (error) {
    check(`unexpected error: ${error instanceof Error ? error.message : String(error)}`, false);
  } finally {
    if (temporaryVersion !== null) {
      let restoredOk = false;
      try {
        // Over the temporary version only: if an admin published or opened a draft meanwhile, theirs stays.
        const published = await publishIfUnchanged(db, catalogSpec, snapshot.document, { version: temporaryVersion }, 'cli', `Version ${snapshot.version ?? 'defaults'} again, after the entitlement test`);
        if (published.status === 'published') {
          const now = await getPublished(db, catalogSpec);
          const sameContent = fingerprint(CatalogSchema.parse(now?.document)) === fingerprint(snapshot.document);
          const samePlans = fingerprint(await plansState(db)) === fingerprint(snapshot.plans);
          restoredOk = sameContent && samePlans;
          check(`published the recorded configuration again (version ${published.version}): content ${fingerprint(CatalogSchema.parse(now?.document))} ${sameContent ? 'identical to' : 'DIFFERENT FROM'} version ${snapshot.version}, plans documents ${samePlans ? 'identical' : 'DIFFERENT'}`, restoredOk);
        } else {
          check(
            published.status === 'changed'
              ? `NOT RESTORED: another version went live while the test ran (now version ${published.live}); nothing of it was overwritten. Version ${temporaryVersion} was the temporary one; once that change is settled, publish version ${snapshot.version}'s content again from /admin/plans if needed`
              : published.status === 'draft_exists'
                ? `NOT RESTORED: an admin opened a draft while the test ran; it was not touched. Version ${temporaryVersion} (temporary) is still live: publish version ${snapshot.version}'s content again from /admin/plans once the draft is done`
                : `NOT RESTORED: ${published.issues.join('; ')}`,
            false,
          );
        }
      } catch (error) {
        check(`RESTORING THE CATALOG FAILED: ${error instanceof Error ? error.message : String(error)} — publish version ${snapshot.version} again from /admin/plans`, false);
      }
      if (restoredOk) {
        try {
          const back = await getPlanOffer(db);
          const [free, pro] = created;
          if (free?.cookie && pro?.cookie) {
            await checkPlan('Free, after restoring', free.cookie, 'free', back);
            await checkPlan('Pro, after restoring', pro.cookie, 'pro', back);
          }
        } catch (error) {
          check(`checking after restoring (the catalog itself is restored): ${error instanceof Error ? error.message : String(error)}`, false);
        }
      }
    }
    for (const account of created) {
      const removed = await removeUsernameAccount(db, { userId: account.userId, actor: 'cli' });
      if (removed !== 'removed') results.push([`cleanup ${account.planId}`, false]);
    }
    console.log(`  ${results.every(([label]) => !label.startsWith('cleanup')) ? 'ok  ' : 'FAIL'}  the temporary accounts (${created.length}) were removed`);
  }
  const failed = results.filter(([, ok]) => !ok).length;
  console.log(failed === 0 ? 'All checks passed.' : `${failed} check(s) failed.`);
  return failed === 0 ? 0 : 1;
}

const TEMP_TESTER_PREFIX = 'qa_tmp_';

/**
 * Temporary username accounts for a browser check of this server (Free, Pro,
 * and Free in Hebrew), made the normal way. Their passwords go to standard
 * output as one JSON line, only when it is a pipe or a file: never onto a
 * terminal (or into a session log). Remove them with `temp-testers remove`.
 */
async function createTempTesters(db: ReturnType<typeof getDb>): Promise<void> {
  if (process.stdout.isTTY) throw new Error('Refused: the passwords would appear on this screen. Pipe the output to a file (mode 600) and delete it after the check.');
  const auth = authFromEnvironment({ nextjs: false });
  const suffix = randomBytes(3).toString('hex');
  const out: Record<string, { username: string; password: string }> = {};
  const kinds = [
    { key: 'free', plan: 'free', locale: 'en' },
    { key: 'pro', plan: 'pro', locale: 'en' },
    { key: 'freehe', plan: 'free', locale: 'he' },
  ] as const;
  for (const kind of kinds) {
    const created = await createUsernameAccount(db, auth, { username: `${TEMP_TESTER_PREFIX}${kind.key}_${suffix}`, plan: kind.plan, locale: kind.locale, test: true, actor: 'cli' });
    if (created.status !== 'created') throw new Error(`Could not create the temporary ${kind.key} account (${created.status}).`);
    await collections(db).users.updateOne({ _id: created.userId }, { $set: { introsSeen: ['measure', 'value', 'color', 'grid', 'compare'] } });
    out[kind.key] = { username: created.username, password: created.password };
  }
  process.stdout.write(`${JSON.stringify(out)}\n`);
  console.error(`Created ${Object.values(out).map((a) => a.username).join(' and ')} (test accounts). Remove them with: npm run db -- temp-testers remove`);
}

async function removeTempTesters(db: ReturnType<typeof getDb>): Promise<void> {
  const found = await collections(db).users.find({ username: { $regex: `^${TEMP_TESTER_PREFIX}` }, createdBy: 'cli', role: 'user' }, { projection: { username: 1 } }).toArray();
  for (const user of found) {
    const removed = await removeUsernameAccount(db, { userId: user._id, actor: 'cli' });
    console.log(`${removed === 'removed' ? 'Removed' : 'Could not remove'} ${user.username} (id ${user._id.toHexString()}).`);
  }
  if (found.length === 0) console.log('No temporary testers to remove.');
}

main(process.argv[2], process.argv[3], process.argv[4])
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => closeMongo());
