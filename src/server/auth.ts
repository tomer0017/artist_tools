import 'server-only';
import { betterAuth } from 'better-auth';
import { mongodbAdapter } from 'better-auth/adapters/mongodb';
import { nextCookies } from 'better-auth/next-js';
import type { Db, MongoClient } from 'mongodb';
import { authConfig, type SignupPolicy } from '@/server/env';
import { getMongo } from '@/server/db/client';
import { collections, toObjectId } from '@/server/db/collections';
import { recordAudit } from '@/server/audit';
import { trackEvent } from '@/server/analytics';
import { log } from '@/server/log';

// ─── Authentication ────────────────────────────────────────────────────────────
// Google sign-in (OpenID Connect: authorization code + state + PKCE, handled by
// Better Auth) with database sessions in MongoDB. An account IS its Google
// identity (`sub`): accounts are never matched or merged by email address.

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
  /** Next.js cookie integration for server actions; off where there is no request scope (tests). */
  nextjs?: boolean;
}

/**
 * Whether a brand-new account may be created. Only gates registration: the
 * account's identity remains its Google `sub`, and no role or permission is
 * ever derived from an email address. Google must have verified the address.
 */
export function signupAllowed(policy: SignupPolicy, user: { email?: string | null; emailVerified?: boolean | null }): boolean {
  if (policy === '*') return true;
  if (!user.emailVerified || !user.email) return false;
  return policy.includes(user.email.trim().toLowerCase());
}

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
  return betterAuth({
    appName: 'Studio Companion',
    baseURL: deps.baseURL,
    secret: deps.secret,
    database: mongodbAdapter(deps.db, { client: deps.client, usePlural: true }),
    telemetry: { enabled: false },
    // Google is the only way in: there are no passwords to leak or reset.
    emailAndPassword: { enabled: false },
    socialProviders: deps.google
      ? { google: { clientId: deps.google.clientId, clientSecret: deps.google.clientSecret, prompt: 'select_account' } }
      : {},
    account: {
      accountLinking: { enabled: false },
      encryptOAuthTokens: true,
    },
    session: {
      expiresIn: 60 * 60 * 24 * 30, // 30 days…
      updateAge: 60 * 60 * 24, // …renewed at most once a day while in use
      // A signed cookie cache saves a database read per request; five minutes
      // is the longest a revoked session or changed account can linger.
      cookieCache: { enabled: true, maxAge: 5 * 60 },
    },
    user: {
      // Registration is invite-only until it is opened on purpose. Better Auth
      // runs this gate before it creates any user (Google sign-ups included)
      // and refuses with the returned code; if the gate itself throws, the
      // sign-up is refused too (fails closed). Existing accounts signing in
      // pass through untouched.
      validateUserInfo: async ({ user, source }) => {
        if (source.action !== 'create-user') return;
        if (signupAllowed(deps.signups, user)) return;
        log.warn('auth.signup_refused', { reason: user.emailVerified ? 'not_invited' : 'email_not_verified' });
        return { error: 'not_invited', errorDescription: 'This account has not been invited yet.' };
      },
      additionalFields: {
        role: { type: 'string', required: false, defaultValue: 'user', input: false },
        status: { type: 'string', required: false, defaultValue: 'active', input: false },
        lastLoginAt: { type: 'date', required: false, input: false },
        marketingConsent: { type: 'boolean', required: false, defaultValue: false, input: false },
        marketingConsentAt: { type: 'date', required: false, input: false },
        marketingConsentSource: { type: 'string', required: false, input: false },
      },
    },
    rateLimit: {
      enabled: true,
      storage: 'memory',
      window: 60,
      max: 100,
      customRules: {
        '/sign-in/social': { window: 60, max: 10 },
        '/callback/*': { window: 60, max: 20 },
      },
    },
    trustedOrigins: [new URL(deps.baseURL).origin],
    // Failed sign-ins land back on the sign-in page with a readable message.
    onAPIError: { errorURL: '/sign-in' },
    advanced: {
      // Better Auth skips its origin and callbackURL checks when it thinks it
      // runs under tests. Keep them on everywhere, so tests exercise exactly
      // the protection production relies on (no open redirects, no CSRF).
      disableOriginCheck: false,
      useSecureCookies: deps.baseURL.startsWith('https://'),
      cookiePrefix: COOKIE_PREFIX,
      // nginx sets X-Real-IP to the connecting address; clients cannot spoof it.
      ipAddress: { ipAddressHeaders: ['x-real-ip'] },
    },
    databaseHooks: {
      user: {
        create: {
          // Second line of defence: only reached if some creation path ever
          // skipped user.validateUserInfo above.
          before: async (user) => {
            if (!signupAllowed(deps.signups, user)) {
              log.error('auth.signup_gate_bypassed', { reason: user.emailVerified ? 'not_invited' : 'email_not_verified' });
              return false;
            }
          },
          after: async (user) => {
            await safely('auth.audit_failed', () =>
              recordAudit(deps.db, { type: 'user.registered', userId: user.id, actor: `user:${user.id}`, metadata: { provider: 'google' } }),
            );
            await safely('auth.analytics_failed', () =>
              trackEvent(deps.db, { name: 'registration_completed', userId: user.id, dedupeKey: `registration_completed:${user.id}` }),
            );
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
          after: async (session) => {
            await safely('auth.login_bookkeeping_failed', async () => {
              await collections(deps.db).users.updateOne({ _id: toObjectId(session.userId) }, { $set: { lastLoginAt: new Date() } });
              await recordAudit(deps.db, { type: 'user.login', userId: session.userId, actor: `user:${session.userId}`, metadata: {} });
              await trackEvent(deps.db, { name: 'login_succeeded', userId: session.userId });
            });
          },
        },
      },
      account: {
        create: { before: async (account) => ({ data: withoutTokens(account) }) },
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
    const { baseURL, secret, google, signups } = authConfig();
    const { client, db } = getMongo();
    instance = createAuth({ db, client, baseURL, secret, google, signups, nextjs: true });
  }
  return instance;
}

/** Whether this server can offer Google sign-in (its OAuth client is configured). */
export const googleSignInAvailable = (): boolean => authConfig().google !== null;
