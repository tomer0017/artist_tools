import 'server-only';
import { betterAuth } from 'better-auth';
import { mongodbAdapter } from 'better-auth/adapters/mongodb';
import { APIError, createAuthEndpoint, createAuthMiddleware, getSessionFromCtx, isAPIError } from 'better-auth/api';
import { nextCookies } from 'better-auth/next-js';
import { username as usernamePlugin } from 'better-auth/plugins/username';
import type { Db, MongoClient } from 'mongodb';
import { z } from 'zod';
import { LOCALE_COOKIE, localeFromAcceptLanguage, localizedPath } from '@/i18n/config';
import { DEFAULT_CURRENCY, DEFAULT_LOCALE, LOCALES, isLocale, type Locale } from '@/lib/locale';
import { PLAN_IDS } from '@/lib/plans';
import { USERNAME_MAX_LENGTH, USERNAME_MIN_LENGTH, isUsernameEmail, normalizeUsername, usernameEmail, usernameProblem } from '@/lib/username';
import { authConfig, type SignupPolicy } from '@/server/env';
import { getMongo } from '@/server/db/client';
import { collections, toObjectId } from '@/server/db/collections';
import { recordAudit } from '@/server/audit';
import { trackEvent } from '@/server/analytics';
import { runInBackground } from '@/server/background';
import { log } from '@/server/log';
import { createMailer, type Mailer } from '@/server/mail/mailer';
import { mailTemplates, type RenderedMail } from '@/server/mail/templates';
import { PASSWORD_MAX_LENGTH, PASSWORD_MESSAGES, PASSWORD_MIN_LENGTH, checkPassword } from '@/server/security/password-policy';
import { EVERYONE, THROTTLES, clearThrottle, consumeThrottle, throttleCount } from '@/server/security/throttle';

// ─── Authentication ────────────────────────────────────────────────────────────
// Google sign-in (OpenID Connect: authorization code + state + PKCE, handled by
// Better Auth); where enabled, email + password with a verified address; and,
// where enabled, a username + password for accounts that administrators
// create for invited testers (no registration, no email; ADR-0012). All on
// database sessions in MongoDB. A Google account is identified by its Google
// `sub`, never by its email address, and accounts are never merged because
// their addresses match: a second sign-in method is added only by its owner,
// from a signed-in session (docs/adr/0002, 0003).

/** Session cookies are `sc.session_token` (`__Secure-sc.…` over HTTPS). */
export const COOKIE_PREFIX = 'sc';

interface AuthDeps {
  db: Db;
  client: MongoClient;
  baseURL: string;
  secret: string;
  /** null until the Google OAuth client exists; sign-in is then unavailable. */
  google: { clientId: string; clientSecret: string } | null;
  /** Who may create a new account (see SignupPolicy); signing in to an existing one is never affected. */
  signups: SignupPolicy;
  /** Email + password sign-in, with verification and resets sent through `mailer`. */
  emailPassword?: boolean;
  /** Username + password sign-in, for accounts administrators create (no sign-up, no email). */
  usernamePassword?: boolean;
  /** Account email (verification, reset, security notices). */
  mailer: Mailer;
  /** Next.js cookie integration for server actions; off where there is no request scope (tests). */
  nextjs?: boolean;
}

/** How long a session counts as "just signed in" for sensitive changes (adding a password, deleting the account). */
export const FRESH_SESSION_SECONDS = 10 * 60;

export type SignupMethod = 'google' | 'email-password';

/**
 * Every endpoint of email + password sign-in. Where that method is off they
 * do not exist (404): nobody can sign up, sign in, reset, verify or check a
 * password. The code stays, for when it is switched back on. With username
 * sign-in on, `/change-password` stays, for a tester to replace the password
 * they were given (it needs the current one).
 */
export const PASSWORD_ENDPOINTS = [
  '/sign-up/email',
  '/sign-in/email',
  '/request-password-reset',
  '/reset-password',
  '/reset-password/:token',
  '/change-password',
  '/verify-password',
  '/send-verification-email',
  '/verify-email',
];

/** Username sign-in (Better Auth's username plugin): absent unless it is on. */
export const USERNAME_ENDPOINTS = ['/sign-in/username'];

/** Never offered: it would tell anyone whether a username exists. */
export const NEVER_ENDPOINTS = ['/is-username-available'];

/** The endpoints that do not exist on a server with these sign-in methods. */
export function disabledEndpoints(methods: { emailPassword?: boolean; usernamePassword?: boolean }): string[] {
  const keep = methods.usernamePassword ? ['/change-password'] : [];
  return [
    ...NEVER_ENDPOINTS,
    ...(methods.emailPassword ? [] : PASSWORD_ENDPOINTS.filter((path) => !keep.includes(path))),
    ...(methods.usernamePassword ? [] : USERNAME_ENDPOINTS),
  ];
}

/**
 * Server-only: create a username account (src/server/password-accounts.ts).
 * Never routed over HTTP (SERVER_ONLY); reached only through `auth.api` by an
 * administrator's verified action or the operator CLI.
 */
export const CREATE_USERNAME_ACCOUNT_PATH = '/studio/create-username-account';

/** Server-only: replace a username account's password (the caller signs it out everywhere). */
export const SET_USERNAME_PASSWORD_PATH = '/studio/set-username-password';

/** Failed sign-ins are counted per username under this "address" (hashed, see throttle.ts). */
export const usernameThrottleKey = (username: string) => `username:${normalizeUsername(username)}`;

const createUsernameAccountBody = z.object({
  username: z.string(),
  name: z.string().min(1).max(80),
  password: z.string().min(PASSWORD_MIN_LENGTH).max(PASSWORD_MAX_LENGTH),
  plan: z.enum(PLAN_IDS),
  locale: z.enum(LOCALES),
});

/**
 * Better Auth endpoints for the app's own server code. They create and
 * update accounts the way Better Auth's admin plugin does (its internal
 * adapter and password hasher), inside an endpoint context so every database
 * hook and validation runs; the admin plugin itself is not installed (its
 * HTTP endpoints would bypass this app's roles, two-factor gate and audit).
 */
const studioAccounts = () => ({
  id: 'studio-accounts',
  endpoints: {
    createUsernameAccount: createAuthEndpoint(
      CREATE_USERNAME_ACCOUNT_PATH,
      { method: 'POST', body: createUsernameAccountBody, metadata: { SERVER_ONLY: true } },
      async (ctx) => {
        const { username, name, password, plan, locale } = ctx.body;
        if (usernameProblem(username)) throw new APIError('BAD_REQUEST', { code: 'INVALID_USERNAME', message: 'Username is invalid' });
        const hash = await ctx.context.password.hash(password);
        // The username plugin's own hook checks the name is free and stores it in lower case.
        const user = await ctx.context.internalAdapter.createUser(
          {
            email: usernameEmail(username),
            // Nothing to verify: the placeholder can never receive mail (src/lib/username.ts).
            emailVerified: true,
            name,
            username,
            displayUsername: username,
            role: 'user',
            status: 'active',
            plan,
            locale,
            currency: locale === 'he' ? 'ILS' : DEFAULT_CURRENCY,
            marketingConsent: false,
          },
          { method: 'admin' },
        );
        if (!user) throw new APIError('INTERNAL_SERVER_ERROR', { code: 'FAILED_TO_CREATE_USER', message: 'Failed to create user' });
        try {
          await ctx.context.internalAdapter.linkAccount({ userId: user.id, providerId: 'credential', accountId: user.id, password: hash });
        } catch (error) {
          // Never leave a username that has no password.
          await ctx.context.internalAdapter.deleteUser(user.id);
          throw error;
        }
        return ctx.json({ userId: user.id });
      },
    ),
    setUsernamePassword: createAuthEndpoint(
      SET_USERNAME_PASSWORD_PATH,
      {
        method: 'POST',
        body: z.object({ userId: z.string(), password: z.string().min(PASSWORD_MIN_LENGTH).max(PASSWORD_MAX_LENGTH) }),
        metadata: { SERVER_ONLY: true },
      },
      async (ctx) => {
        const user = await ctx.context.internalAdapter.findUserById(ctx.body.userId);
        const account = user ? await ctx.context.internalAdapter.findCredentialAccount(user.id) : null;
        if (!user || !(user as { username?: unknown }).username || !account) {
          throw new APIError('NOT_FOUND', { code: 'NOT_A_USERNAME_ACCOUNT', message: 'Not a username account' });
        }
        await ctx.context.internalAdapter.updatePassword(user.id, await ctx.context.password.hash(ctx.body.password));
        return ctx.json({ status: true });
      },
    ),
  },
});

/**
 * Whether a brand-new account may be created. Only gates registration: no
 * role or permission is ever derived from an email address, and new accounts
 * are always role `user` on the Free plan. With Google, Google must have
 * verified the address; with a password, the account cannot be used until its
 * owner verifies the address by email (requireEmailVerification), so it may
 * be created unverified. In invite mode the address must be on the list.
 */
export function signupAllowed(
  policy: SignupPolicy,
  user: { email?: string | null; emailVerified?: boolean | null },
  method: SignupMethod = 'google',
): boolean {
  if (!user.email) return false;
  if (method === 'google' && !user.emailVerified) return false;
  if (policy.mode === 'open') return true;
  return policy.invited.includes(user.email.trim().toLowerCase());
}

/** The language a request asks for: the language cookie, else Accept-Language, else English. */
function requestLocale(headers: Headers | null): Locale {
  const cookie = headers
    ?.get('cookie')
    ?.split(';')
    .map((part) => part.trim().split('='))
    .find(([name]) => name === LOCALE_COOKIE)?.[1];
  return isLocale(cookie) ? cookie : (localeFromAcceptLanguage(headers?.get('accept-language')) ?? DEFAULT_LOCALE);
}

/** The sign-in method behind a Better Auth request, from its endpoint path. */
const methodOf = (path: string | undefined) =>
  path === '/sign-in/email'
    ? 'password'
    : path === '/sign-in/username'
      ? 'username'
      : path === '/verify-email'
        ? 'email_link'
        : path?.startsWith('/callback/')
          ? 'google'
          : 'other';

/** Side work after sign-in must never undo a sign-in that already succeeded. */
async function safely(event: string, work: () => Promise<unknown>) {
  try {
    await work();
  } catch (error) {
    log.error(event, { error });
  }
}

/** We never call Google APIs, so OAuth tokens are not kept at all. */
const withoutTokens = <T extends Record<string, unknown>>(account: T): T => ({
  ...account,
  accessToken: null,
  refreshToken: null,
  idToken: null,
});

export function createAuth(deps: AuthDeps) {
  const { db, mailer } = deps;
  const appURL = new URL(deps.baseURL).origin;
  const users = () => collections(db).users;
  const disabled = disabledEndpoints(deps);

  /** The language an account's emails are written in, and its pages' addresses in that language. */
  const localeOf = (user: unknown) => (user as { locale?: unknown } | null)?.locale;
  const pageFor = (user: unknown, path: string) => {
    const locale = localeOf(user);
    return localizedPath(path, isLocale(locale) ? locale : DEFAULT_LOCALE);
  };

  /** Sign-in methods an account has, for messages that tell people how they sign in. */
  async function methodsOf(userId: string) {
    const accounts = await collections(db).accounts.find({ userId: toObjectId(userId)! }, { projection: { providerId: 1 } }).toArray();
    return { password: accounts.some((a) => a.providerId === 'credential'), google: accounts.some((a) => a.providerId === 'google') };
  }

  // Mail goes out in the background: a response takes the same time whether
  // or not the address has an account. A username account's placeholder
  // address is never written to.
  const send = async (mail: RenderedMail, user: { email?: string | null; id?: string | null }) => {
    if (user.email && !isUsernameEmail(user.email)) await mailer.deliver(mail, { address: user.email, userId: user.id ?? null });
  };

  // New accounts from everyone together: past the hourly or the daily limit,
  // sign-ups pause for every address alike until the window ends. Signing in
  // to an existing account is never affected. The first refusal of a window
  // is audited, so admins see it in the activity log.
  const SIGNUP_WINDOWS = [
    ['signups:hour', THROTTLES.newAccountsPerHour],
    ['signups:day', THROTTLES.newAccountsPerDay],
  ] as const;
  async function signupsPaused() {
    for (const [purpose, rule] of SIGNUP_WINDOWS) {
      if ((await throttleCount(db, purpose, EVERYONE)) < rule.limit) continue;
      if ((await consumeThrottle(db, 'signups:paused', EVERYONE, { limit: 1, windowSeconds: rule.windowSeconds })).allowed) {
        await safely('auth.audit_failed', () => recordAudit(db, { type: 'auth.throttled', userId: null, actor: 'system', metadata: { purpose: 'signups' } }));
      }
      return true;
    }
    return false;
  }
  async function countSignup() {
    for (const [purpose, rule] of SIGNUP_WINDOWS) await consumeThrottle(db, purpose, EVERYONE, rule);
  }

  return betterAuth({
    appName: 'SketchyArtLab',
    baseURL: deps.baseURL,
    secret: deps.secret,
    database: mongodbAdapter(deps.db, { client: deps.client, usePlural: true }),
    telemetry: { enabled: false },
    // Warnings and errors only: some of the library's info messages contain
    // email addresses, which our logs never hold.
    logger: { level: 'warn' },
    // Email + password only where enabled (and only with a mail transport):
    // the address must be verified before the account can be used; a sign-up
    // for an address that already has an account gets the same answer as a
    // new one, and the owner gets an email instead. Passwords are hashed with
    // the library's scrypt; reset tokens are single-use, last 30 minutes and
    // are stored hashed; a reset signs out every device.
    emailAndPassword: deps.emailPassword
      ? {
          enabled: true,
          requireEmailVerification: true,
          autoSignIn: false,
          minPasswordLength: PASSWORD_MIN_LENGTH,
          maxPasswordLength: PASSWORD_MAX_LENGTH,
          resetPasswordTokenExpiresIn: 30 * 60,
          revokeSessionsOnPasswordReset: true,
          sendResetPassword: async ({ user, token }) => {
            await send(mailTemplates(localeOf(user)).resetPassword(user.name, `${appURL}${pageFor(user, '/reset-password')}?token=${encodeURIComponent(token)}`), user);
          },
          onPasswordReset: async ({ user }) => {
            await safely('auth.audit_failed', () => recordAudit(db, { type: 'user.password_reset', userId: user.id, actor: `user:${user.id}`, metadata: {} }));
            runInBackground(send(mailTemplates(localeOf(user)).passwordChanged(user.name, `${appURL}${pageFor(user, '/sign-in')}`), user));
          },
          onExistingUserSignUp: async ({ user }) => {
            await send(
              mailTemplates(localeOf(user)).existingAccount(user.name, await methodsOf(user.id), {
                signIn: `${appURL}${pageFor(user, '/sign-in')}`,
                reset: `${appURL}${pageFor(user, '/forgot-password')}`,
              }),
              user,
            );
          },
        }
      : // Off: nobody signs in or up with an email address. The lengths still
        // apply where a username account changes its password.
        { enabled: false, minPasswordLength: PASSWORD_MIN_LENGTH, maxPasswordLength: PASSWORD_MAX_LENGTH },
    emailVerification: deps.emailPassword
      ? {
          sendOnSignUp: true,
          // Signing in with the right password to an unverified address sends a fresh link.
          sendOnSignIn: true,
          autoSignInAfterVerification: true,
          expiresIn: 24 * 60 * 60,
          sendVerificationEmail: async ({ user, url }) => {
            await send(mailTemplates(localeOf(user)).verifyEmail(user.name, url), user);
          },
          afterEmailVerification: async (user) => {
            await safely('auth.audit_failed', () => recordAudit(db, { type: 'user.email_verified', userId: user.id, actor: `user:${user.id}`, metadata: {} }));
            // A password account counts as registered once its address is proven.
            await safely('auth.analytics_failed', () =>
              trackEvent(db, { name: 'registration_completed', userId: user.id, dedupeKey: `registration_completed:${user.id}` }),
            );
          },
        }
      : undefined,
    // Off means absent: those endpoints answer 404 before any other work
    // (the one with a token in its path is caught in the hook below).
    disabledPaths: disabled,
    // Tokens kept in `verifications` (resets, OAuth state) are stored as
    // SHA-256 hashes, so reading the database is not enough to use one.
    verification: { storeIdentifier: 'hashed' },
    socialProviders: deps.google
      ? { google: { clientId: deps.google.clientId, clientSecret: deps.google.clientSecret, prompt: 'select_account' } }
      : {},
    account: {
      // Never automatic: a Google sign-in whose address belongs to another
      // account is refused, not merged. A signed-in person can connect Google
      // (same, Google-verified address) or add a password themselves.
      accountLinking: {
        enabled: true,
        disableImplicitLinking: true,
        allowDifferentEmails: false,
        requireLocalEmailVerified: true,
        trustedProviders: [],
        allowUnlinkingAll: false,
      },
      encryptOAuthTokens: true,
    },
    session: {
      expiresIn: 60 * 60 * 24 * 30, // 30 days…
      updateAge: 60 * 60 * 24, // …renewed at most once a day while in use
      // A signed cookie cache saves a database read per request; five minutes
      // is the longest a revoked session or changed account can linger.
      cookieCache: { enabled: true, maxAge: 5 * 60 },
      freshAge: FRESH_SESSION_SECONDS,
    },
    user: {
      // Registration is invite-only until it is opened on purpose. Better Auth
      // runs this gate before it creates any user (Google and password
      // sign-ups alike) and refuses with the returned code; if the gate itself
      // throws, the sign-up is refused too (fails closed). Existing accounts
      // signing in pass through untouched. A refused password sign-up gets the
      // same answer as any other, so the gate never reveals the invite list.
      // Past the global limits on new accounts, sign-ups pause (see above).
      validateUserInfo: async ({ user, source }) => {
        if (source.action !== 'create-user') return;
        // An administrator creating a username account (the server-only
        // endpoint above, never reachable over HTTP): not a registration, so
        // neither the invitation list nor the sign-up limits apply.
        if (source.method === 'admin') return;
        const method: SignupMethod = source.method === 'email-password' ? 'email-password' : 'google';
        if (!signupAllowed(deps.signups, user, method)) {
          const unverified = method === 'google' && !user.emailVerified;
          log.warn('auth.signup_refused', { method, reason: unverified ? 'email_not_verified' : 'not_invited' });
          return unverified
            ? { error: 'email_not_verified', errorDescription: 'Google has not verified this email address.' }
            : { error: 'not_invited', errorDescription: 'This account has not been invited yet.' };
        }
        if (await signupsPaused()) {
          log.warn('auth.signup_refused', { method, reason: 'paused' });
          return { error: 'signups_paused', errorDescription: 'New sign-ups are paused for a short while.' };
        }
        await countSignup();
      },
      // `input: false`: none of these can be set through any auth endpoint
      // (sign-up, update-user); only the server writes them.
      additionalFields: {
        role: { type: 'string', required: false, defaultValue: 'user', input: false },
        status: { type: 'string', required: false, defaultValue: 'active', input: false },
        plan: { type: 'string', required: false, defaultValue: 'free', input: false },
        lastLoginAt: { type: 'date', required: false, input: false },
        marketingConsent: { type: 'boolean', required: false, defaultValue: false, input: false },
        marketingConsentAt: { type: 'date', required: false, input: false },
        marketingConsentSource: { type: 'string', required: false, input: false },
        locale: { type: 'string', required: false, defaultValue: DEFAULT_LOCALE, input: false },
        currency: { type: 'string', required: false, defaultValue: DEFAULT_CURRENCY, input: false },
      },
    },
    // Per-IP limits (nginx's X-Real-IP), kept in MongoDB so a restart does not
    // reset them. Per-address limits come on top (hooks below).
    rateLimit: {
      enabled: true,
      storage: 'database',
      window: 60,
      max: 100,
      customRules: {
        '/sign-in/social': { window: 60, max: 10 },
        '/callback/*': { window: 60, max: 20 },
        '/sign-in/email': { window: 60, max: 5 },
        '/sign-in/username': { window: 60, max: 5 },
        '/sign-up/email': { window: 10 * 60, max: 5 },
        '/request-password-reset': { window: 15 * 60, max: 5 },
        '/reset-password': { window: 15 * 60, max: 10 },
        '/send-verification-email': { window: 15 * 60, max: 5 },
        '/verify-email': { window: 10 * 60, max: 20 },
        '/change-password': { window: 15 * 60, max: 5 },
      },
    },
    trustedOrigins: [appURL],
    // Failed sign-ins land back on the sign-in page with a readable message.
    onAPIError: { errorURL: '/sign-in' },
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        const body = (ctx.body ?? {}) as Record<string, unknown>;
        if (disabled.includes(ctx.path)) throw new APIError('NOT_FOUND');
        // Usernames are given by administrators: nobody chooses or changes
        // one through the API (the plugin would otherwise accept them here).
        if ((ctx.path === '/update-user' || ctx.path === '/sign-up/email') && ('username' in body || 'displayUsername' in body)) {
          throw new APIError('BAD_REQUEST', { code: 'USERNAME_NOT_ALLOWED', message: 'Usernames are given by an administrator.' });
        }
        // A username account's placeholder address is not a way in: it signs
        // in with its username, under that username's own throttle.
        if (ctx.path === '/sign-in/email' && isUsernameEmail(typeof body.email === 'string' ? body.email : null)) {
          throw new APIError('UNAUTHORIZED', { code: 'INVALID_EMAIL_OR_PASSWORD', message: 'Invalid email or password' });
        }
        // Too many wrong passwords for this username (whether or not it
        // exists): pause its sign-in until the window ends.
        if (ctx.path === '/sign-in/username' && typeof body.username === 'string') {
          if ((await throttleCount(db, 'signin-fail', usernameThrottleKey(body.username))) >= THROTTLES.signInFailures.limit) {
            await safely('auth.audit_failed', () => recordAudit(db, { type: 'auth.throttled', userId: null, actor: 'system', metadata: { purpose: 'sign_in' } }));
            throw new APIError('TOO_MANY_REQUESTS', { code: 'TOO_MANY_ATTEMPTS', message: 'Too many attempts. Please wait 15 minutes.' });
          }
        }
        // Sign-ups paused: the same answer for every address, given before
        // the library looks up whether the address already has an account.
        if (ctx.path === '/sign-up/email' && (await signupsPaused())) {
          throw new APIError('TOO_MANY_REQUESTS', { code: 'SIGNUPS_PAUSED', message: 'New sign-ups are paused for a short while. Please try again later.' });
        }
        // Password policy, on every way a password is chosen. A change comes
        // from a signed-in person, whose session is read here (it is not
        // loaded yet before the endpoint runs), so their name, address or
        // username is checked too.
        if (ctx.path === '/sign-up/email' || ctx.path === '/reset-password' || ctx.path === '/change-password') {
          const password = ctx.path === '/sign-up/email' ? body.password : body.newPassword;
          const session = ctx.path === '/change-password' ? (ctx.context.session ?? (await getSessionFromCtx(ctx).catch(() => null))) : null;
          const email = typeof body.email === 'string' ? body.email : session?.user.email;
          const name = typeof body.name === 'string' ? body.name : session?.user.name;
          const problem = typeof password === 'string' ? checkPassword(password, { email, name }) : null;
          if (problem) throw new APIError('BAD_REQUEST', { code: `PASSWORD_${problem.toUpperCase()}`, message: PASSWORD_MESSAGES[problem] });
        }
        // Too many wrong passwords for this address: pause password sign-in
        // for it (whether or not it has an account) until the window ends.
        if (ctx.path === '/sign-in/email' && typeof body.email === 'string') {
          if ((await throttleCount(db, 'signin-fail', body.email)) >= THROTTLES.signInFailures.limit) {
            await safely('auth.audit_failed', () => recordAudit(db, { type: 'auth.throttled', userId: null, actor: 'system', metadata: { purpose: 'sign_in' } }));
            throw new APIError('TOO_MANY_REQUESTS', {
              code: 'TOO_MANY_ATTEMPTS',
              message: 'Too many attempts. Please wait 15 minutes, or reset your password.',
            });
          }
        }
      }),
      after: createAuthMiddleware(async (ctx) => {
        const body = (ctx.body ?? {}) as Record<string, unknown>;
        const returned = ctx.context.returned;
        const failed = isAPIError(returned);
        // One answer for every accepted sign-up — new, already registered or
        // not invited — so the response cannot tell them apart (the library's
        // stand-in user for the latter two has a slightly different shape).
        if (ctx.path === '/sign-up/email' && !failed) {
          return ctx.json({ status: true, message: 'Check your email to continue.' });
        }
        if (ctx.path === '/sign-in/email' && typeof body.email === 'string') {
          if (failed && returned.statusCode === 401) {
            await consumeThrottle(db, 'signin-fail', body.email, THROTTLES.signInFailures);
            const known = await users().findOne({ email: body.email.trim().toLowerCase() }, { projection: { _id: 1 } });
            await safely('auth.audit_failed', () =>
              recordAudit(db, { type: 'auth.login_failed', userId: known?._id ?? null, actor: 'system', metadata: { method: 'password' } }),
            );
          } else if (!failed) {
            await clearThrottle(db, 'signin-fail', body.email);
          }
        }
        // Username sign-in: one answer for an unknown username and a wrong
        // password (the library's), counted per username.
        if (ctx.path === '/sign-in/username' && typeof body.username === 'string') {
          const key = usernameThrottleKey(body.username);
          if (failed && returned.statusCode === 401) {
            await consumeThrottle(db, 'signin-fail', key, THROTTLES.signInFailures);
            const known = await users().findOne({ username: normalizeUsername(body.username) }, { projection: { _id: 1 } });
            await safely('auth.audit_failed', () =>
              recordAudit(db, { type: 'auth.login_failed', userId: known?._id ?? null, actor: 'system', metadata: { method: 'username' } }),
            );
          } else if (!failed) {
            await clearThrottle(db, 'signin-fail', key);
          }
        }
        if (ctx.path === '/unlink-account' && !failed && ctx.context.session && typeof body.providerId === 'string') {
          const user = ctx.context.session.user;
          await safely('auth.audit_failed', () =>
            recordAudit(db, { type: 'account.unlinked', userId: user.id, actor: `user:${user.id}`, metadata: { provider: body.providerId as string } }),
          );
        }
        if (ctx.path === '/change-password' && !failed && ctx.context.session) {
          const user = ctx.context.session.user;
          await safely('auth.audit_failed', () => recordAudit(db, { type: 'user.password_changed', userId: user.id, actor: `user:${user.id}`, metadata: {} }));
          // An initial password still waiting to be revealed is no longer the password.
          await safely('auth.handoff_cleanup_failed', () => collections(db).passwordHandoffs.deleteOne({ _id: toObjectId(user.id)! }));
          runInBackground(send(mailTemplates(localeOf(user)).passwordChanged(user.name, `${appURL}${pageFor(user, '/sign-in')}`), user));
        }
      }),
    },
    advanced: {
      // Better Auth skips its origin and callbackURL checks when it thinks it
      // runs under tests. Keep them on everywhere, so tests exercise exactly
      // the protection production relies on (no open redirects, no CSRF).
      disableOriginCheck: false,
      useSecureCookies: deps.baseURL.startsWith('https://'),
      cookiePrefix: COOKIE_PREFIX,
      // nginx sets X-Real-IP to the connecting address; clients cannot spoof it.
      ipAddress: { ipAddressHeaders: ['x-real-ip'] },
      // Email and other side work never delays (or times) a response.
      backgroundTasks: { handler: runInBackground },
    },
    databaseHooks: {
      user: {
        create: {
          // Second line of defence: only reached if some creation path ever
          // skipped user.validateUserInfo above. Only the password sign-up
          // endpoint may create an unverified account.
          before: async (user, ctx) => {
            // An administrator's username account: its language and the rest
            // were chosen by the endpoint that creates it.
            if (ctx?.path === CREATE_USERNAME_ACCOUNT_PATH) return { data: user };
            const method: SignupMethod = ctx?.path === '/sign-up/email' ? 'email-password' : 'google';
            if (!signupAllowed(deps.signups, user, method)) {
              log.error('auth.signup_gate_bypassed', { method });
              return false;
            }
            // The language of the page they signed up from (cookie, else the
            // browser's), and the matching currency; both changeable later.
            const locale = requestLocale(ctx?.headers ?? null);
            return { data: { ...user, locale, currency: locale === 'he' ? 'ILS' : DEFAULT_CURRENCY } };
          },
          after: async (user, ctx) => {
            // Username accounts are recorded by whoever created them (admin.account_created).
            if (ctx?.path === CREATE_USERNAME_ACCOUNT_PATH) return;
            const provider = ctx?.path === '/sign-up/email' ? 'credential' : 'google';
            await safely('auth.audit_failed', () =>
              recordAudit(deps.db, { type: 'user.registered', userId: user.id, actor: `user:${user.id}`, metadata: { provider } }),
            );
            // Password accounts count once their address is verified (above).
            if (provider === 'google') {
              await safely('auth.analytics_failed', () =>
                trackEvent(deps.db, { name: 'registration_completed', userId: user.id, dedupeKey: `registration_completed:${user.id}` }),
              );
            }
          },
        },
      },
      session: {
        create: {
          // Suspended accounts cannot start new sessions. Username sign-in
          // reaches this only after the password was checked, so it may say
          // plainly why (instead of the library's "failed to create
          // session"); a wrong password gets the same answer as anyone's.
          before: async (session, ctx) => {
            const user = await collections(deps.db).users.findOne({ _id: toObjectId(session.userId) }, { projection: { status: 1 } });
            if (user?.status && user.status !== 'active') {
              if (ctx?.path === '/sign-in/username') throw new APIError('FORBIDDEN', { code: 'ACCOUNT_SUSPENDED', message: 'This account is suspended.' });
              return false;
            }
          },
          after: async (session, ctx) => {
            await safely('auth.login_bookkeeping_failed', async () => {
              await collections(deps.db).users.updateOne({ _id: toObjectId(session.userId) }, { $set: { lastLoginAt: new Date() } });
              await recordAudit(deps.db, { type: 'user.login', userId: session.userId, actor: `user:${session.userId}`, metadata: { method: methodOf(ctx?.path) } });
              await trackEvent(deps.db, { name: 'login_succeeded', userId: session.userId });
            });
          },
        },
      },
      account: {
        create: {
          before: async (account) => ({ data: withoutTokens(account) }),
          after: async (account) => {
            // A second sign-in method was added (connecting Google, setting a
            // password, or a reset that gave a Google account a password):
            // audited, and the owner is told. The first one is the sign-up.
            const userId = toObjectId(account.userId)!;
            if ((await collections(db).accounts.countDocuments({ userId })) < 2) return;
            const user = await users().findOne({ _id: userId }, { projection: { name: 1, email: 1, locale: 1 } });
            if (!user) return;
            await safely('auth.audit_failed', () =>
              recordAudit(db, { type: 'account.linked', userId: account.userId, actor: `user:${account.userId}`, metadata: { provider: account.providerId } }),
            );
            const mail = account.providerId === 'google' ? mailTemplates(localeOf(user)).googleConnected(user.name) : mailTemplates(localeOf(user)).passwordAdded(user.name);
            runInBackground(send(mail, { email: user.email, id: account.userId }));
          },
        },
        update: { before: async (account) => ({ data: withoutTokens(account) }) },
      },
    },
    plugins: [
      // Sign-in by username (POST /sign-in/username, where it is on). Same
      // rules as src/lib/username.ts; stored in lower case.
      usernamePlugin({ minUsernameLength: USERNAME_MIN_LENGTH, maxUsernameLength: USERNAME_MAX_LENGTH }),
      studioAccounts(),
      ...(deps.nextjs ? [nextCookies()] : []),
    ],
  });
}

export type Auth = ReturnType<typeof createAuth>;

let instance: Auth | undefined;

/** The app's auth instance, created on first use from the environment. */
export function getAuth(): Auth {
  if (!instance) instance = authFromEnvironment({ nextjs: true });
  return instance;
}

/** An auth instance configured from the environment; the operator CLI uses one without Next.js cookies. */
export function authFromEnvironment(options: { nextjs: boolean }): Auth {
  const { baseURL, secret, google, signups, emailPassword, usernamePassword, mail } = authConfig();
  const { client, db } = getMongo();
  return createAuth({ db, client, baseURL, secret, google, signups, emailPassword, usernamePassword, mailer: createMailer(db, mail.transport, mail), nextjs: options.nextjs });
}

/** Whether this server can offer Google sign-in (its OAuth client is configured). */
export const googleSignInAvailable = (): boolean => authConfig().google !== null;

/** Whether this server offers email + password sign-in. */
export const emailPasswordAvailable = (): boolean => authConfig().emailPassword;

/** Whether this server offers username + password sign-in (accounts administrators create). */
export const usernamePasswordAvailable = (): boolean => authConfig().usernamePassword;

/** Whether new visitors can create an account themselves ('open') or need an invitation ('invite'). */
export const registrationMode = (): SignupPolicy['mode'] => authConfig().signups.mode;
