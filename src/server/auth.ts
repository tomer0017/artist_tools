import 'server-only';
import { betterAuth } from 'better-auth';
import { mongodbAdapter } from 'better-auth/adapters/mongodb';
import { APIError, createAuthMiddleware, isAPIError } from 'better-auth/api';
import { nextCookies } from 'better-auth/next-js';
import type { Db, MongoClient } from 'mongodb';
import { DEFAULT_CURRENCY, DEFAULT_LOCALE } from '@/lib/locale';
import { authConfig, type SignupPolicy } from '@/server/env';
import { getMongo } from '@/server/db/client';
import { collections, toObjectId } from '@/server/db/collections';
import { recordAudit } from '@/server/audit';
import { trackEvent } from '@/server/analytics';
import { runInBackground } from '@/server/background';
import { log } from '@/server/log';
import { createMailer, type Mailer } from '@/server/mail/mailer';
import { mailTemplates } from '@/server/mail/templates';
import { PASSWORD_MAX_LENGTH, PASSWORD_MESSAGES, PASSWORD_MIN_LENGTH, checkPassword } from '@/server/security/password-policy';
import { THROTTLES, clearThrottle, consumeThrottle, throttleCount } from '@/server/security/throttle';

// ─── Authentication ────────────────────────────────────────────────────────────
// Google sign-in (OpenID Connect: authorization code + state + PKCE, handled by
// Better Auth) and, where enabled, email + password with a verified address,
// on database sessions in MongoDB. A Google account is identified by its
// Google `sub`, never by its email address, and accounts are never merged
// because their addresses match: a second sign-in method is added only by its
// owner, from a signed-in session (docs/adr/0002, 0003).

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
  /** Account email (verification, reset, security notices). */
  mailer: Mailer;
  /** Next.js cookie integration for server actions; off where there is no request scope (tests). */
  nextjs?: boolean;
}

/** How long a session counts as "just signed in" for sensitive changes (adding a password, deleting the account). */
export const FRESH_SESSION_SECONDS = 10 * 60;

export type SignupMethod = 'google' | 'email-password';

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

/** The sign-in method behind a Better Auth request, from its endpoint path. */
const methodOf = (path: string | undefined) =>
  path === '/sign-in/email' ? 'password' : path === '/verify-email' ? 'email_link' : path?.startsWith('/callback/') ? 'google' : 'other';

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

  /** Sign-in methods an account has, for messages that tell people how they sign in. */
  async function methodsOf(userId: string) {
    const accounts = await collections(db).accounts.find({ userId: toObjectId(userId)! }, { projection: { providerId: 1 } }).toArray();
    return { password: accounts.some((a) => a.providerId === 'credential'), google: accounts.some((a) => a.providerId === 'google') };
  }

  // Mail goes out in the background: a response takes the same time whether
  // or not the address has an account.
  const send = async (mail: ReturnType<(typeof mailTemplates)[keyof typeof mailTemplates]>, user: { email?: string | null; id?: string | null }) => {
    if (user.email) await mailer.deliver(mail, { address: user.email, userId: user.id ?? null });
  };

  return betterAuth({
    appName: 'Studio Companion',
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
            await send(mailTemplates.resetPassword(user.name, `${appURL}/reset-password?token=${encodeURIComponent(token)}`), user);
          },
          onPasswordReset: async ({ user }) => {
            await safely('auth.audit_failed', () => recordAudit(db, { type: 'user.password_reset', userId: user.id, actor: `user:${user.id}`, metadata: {} }));
            runInBackground(send(mailTemplates.passwordChanged(user.name, `${appURL}/sign-in`), user));
          },
          onExistingUserSignUp: async ({ user }) => {
            await send(mailTemplates.existingAccount(user.name, await methodsOf(user.id), { signIn: `${appURL}/sign-in`, reset: `${appURL}/forgot-password` }), user);
          },
        }
      : { enabled: false },
    emailVerification: deps.emailPassword
      ? {
          sendOnSignUp: true,
          // Signing in with the right password to an unverified address sends a fresh link.
          sendOnSignIn: true,
          autoSignInAfterVerification: true,
          expiresIn: 24 * 60 * 60,
          sendVerificationEmail: async ({ user, url }) => {
            await send(mailTemplates.verifyEmail(user.name, url), user);
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
      validateUserInfo: async ({ user, source }) => {
        if (source.action !== 'create-user') return;
        const method: SignupMethod = source.method === 'email-password' ? 'email-password' : 'google';
        if (signupAllowed(deps.signups, user, method)) return;
        log.warn('auth.signup_refused', { method, reason: method === 'google' && !user.emailVerified ? 'email_not_verified' : 'not_invited' });
        return { error: 'not_invited', errorDescription: 'This account has not been invited yet.' };
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
        // Password policy, on every way a password is chosen.
        if (ctx.path === '/sign-up/email' || ctx.path === '/reset-password' || ctx.path === '/change-password') {
          const password = ctx.path === '/sign-up/email' ? body.password : body.newPassword;
          const email = typeof body.email === 'string' ? body.email : ctx.context.session?.user.email;
          const name = typeof body.name === 'string' ? body.name : ctx.context.session?.user.name;
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
        if (ctx.path === '/unlink-account' && !failed && ctx.context.session && typeof body.providerId === 'string') {
          const user = ctx.context.session.user;
          await safely('auth.audit_failed', () =>
            recordAudit(db, { type: 'account.unlinked', userId: user.id, actor: `user:${user.id}`, metadata: { provider: body.providerId as string } }),
          );
        }
        if (ctx.path === '/change-password' && !failed && ctx.context.session) {
          const user = ctx.context.session.user;
          await safely('auth.audit_failed', () => recordAudit(db, { type: 'user.password_changed', userId: user.id, actor: `user:${user.id}`, metadata: {} }));
          runInBackground(send(mailTemplates.passwordChanged(user.name, `${appURL}/sign-in`), user));
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
            const method: SignupMethod = ctx?.path === '/sign-up/email' ? 'email-password' : 'google';
            if (!signupAllowed(deps.signups, user, method)) {
              log.error('auth.signup_gate_bypassed', { method });
              return false;
            }
          },
          after: async (user, ctx) => {
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
          // Suspended accounts cannot start new sessions.
          before: async (session) => {
            const user = await collections(deps.db).users.findOne({ _id: toObjectId(session.userId) }, { projection: { status: 1 } });
            if (user?.status && user.status !== 'active') return false;
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
            const user = await users().findOne({ _id: userId }, { projection: { name: 1, email: 1 } });
            if (!user) return;
            await safely('auth.audit_failed', () =>
              recordAudit(db, { type: 'account.linked', userId: account.userId, actor: `user:${account.userId}`, metadata: { provider: account.providerId } }),
            );
            const mail = account.providerId === 'google' ? mailTemplates.googleConnected(user.name) : mailTemplates.passwordAdded(user.name);
            runInBackground(send(mail, { email: user.email, id: account.userId }));
          },
        },
        update: { before: async (account) => ({ data: withoutTokens(account) }) },
      },
    },
    plugins: deps.nextjs ? [nextCookies()] : [],
  });
}

export type Auth = ReturnType<typeof createAuth>;

let instance: Auth | undefined;

/** The app's auth instance, created on first use from the environment. */
export function getAuth(): Auth {
  if (!instance) {
    const { baseURL, secret, google, signups, emailPassword, mail } = authConfig();
    const { client, db } = getMongo();
    instance = createAuth({ db, client, baseURL, secret, google, signups, emailPassword, mailer: createMailer(db, mail.transport), nextjs: true });
  }
  return instance;
}

/** Whether this server can offer Google sign-in (its OAuth client is configured). */
export const googleSignInAvailable = (): boolean => authConfig().google !== null;

/** Whether this server offers email + password sign-in. */
export const emailPasswordAvailable = (): boolean => authConfig().emailPassword;

/** Whether new visitors can create an account themselves ('open') or need an invitation ('invite'). */
export const registrationMode = (): SignupPolicy['mode'] => authConfig().signups.mode;
