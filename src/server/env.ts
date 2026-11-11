import 'server-only';
import { z } from 'zod';

// Configuration comes only from the environment: .env.local in development,
// a root-owned env file on the server. It is read lazily, so building the app
// never needs secrets, and a missing value fails with a clear message that
// never echoes the value itself.

/** A variable that must be present and non-empty; messages name the variable. */
const required = (name: string) => z.string({ required_error: `${name} is not set` }).min(1, `${name} is not set`);

const dbSchema = z.object({
  MONGODB_URI: required('MONGODB_URI'),
  MONGODB_DB: required('MONGODB_DB'),
});

/** Environments where the mail outbox (messages readable by admins) is allowed. */
const OUTBOX_ENVIRONMENTS = ['development', 'test', 'staging'];

// Google credentials are optional (a server can run before its OAuth client
// exists: sign-in then says it is not set up yet), but never half-configured.
const authSchema = z
  .object({
    BETTER_AUTH_URL: required('BETTER_AUTH_URL').url('BETTER_AUTH_URL must be a full URL, e.g. http://localhost:8080'),
    BETTER_AUTH_SECRET: required('BETTER_AUTH_SECRET').min(32, 'BETTER_AUTH_SECRET must be at least 32 characters'),
    GOOGLE_CLIENT_ID: z.string().optional(),
    GOOGLE_CLIENT_SECRET: z.string().optional(),
    AUTH_SIGNUP_MODE: z.enum(['invite', 'open'], { message: 'AUTH_SIGNUP_MODE must be "invite" or "open"' }).optional(),
    AUTH_SIGNUP_ALLOWLIST: z.string().optional(),
    APP_ENV: z
      .enum(['development', 'test', 'staging', 'production'], { message: 'APP_ENV must be development, test, staging or production' })
      .optional(),
    AUTH_EMAIL_PASSWORD: z.enum(['on', 'off'], { message: 'AUTH_EMAIL_PASSWORD must be "on" or "off"' }).optional(),
    MAIL_TRANSPORT: z.enum(['disabled', 'outbox'], { message: 'MAIL_TRANSPORT must be "disabled" or "outbox"' }).optional(),
    MAIL_FROM: z.string().max(200).optional(),
    ADMIN_MFA_REQUIRED: z.enum(['on', 'off'], { message: 'ADMIN_MFA_REQUIRED must be "on" or "off"' }).optional(),
  })
  .refine((env) => !env.GOOGLE_CLIENT_ID === !env.GOOGLE_CLIENT_SECRET, {
    message: 'GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET must be set together',
  })
  // The outbox keeps live verification and reset links for admins to read:
  // only where every account is a test account, and never by omission.
  .refine((env) => env.MAIL_TRANSPORT !== 'outbox' || OUTBOX_ENVIRONMENTS.includes(env.APP_ENV ?? ''), {
    message: 'MAIL_TRANSPORT=outbox needs APP_ENV=development, test or staging (it is never allowed in production)',
  })
  // Passwords need email: there is no verification or reset without it.
  .refine((env) => env.AUTH_EMAIL_PASSWORD !== 'on' || (env.MAIL_TRANSPORT ?? 'disabled') !== 'disabled', {
    message: 'AUTH_EMAIL_PASSWORD=on needs a mail transport (MAIL_TRANSPORT)',
  });

function read<T extends z.ZodTypeAny>(schema: T, area: string): z.infer<T> {
  const result = schema.safeParse(process.env);
  if (!result.success) {
    throw new Error(`[config] ${area}: ${result.error.issues.map((i) => i.message).join('; ')}`);
  }
  return result.data;
}

export const dbConfig = () => read(dbSchema, 'database');
/**
 * Who may create a new account with Google (signing in to an existing account
 * is never affected). AUTH_SIGNUP_MODE:
 * - `invite` (the default): only the Google-verified addresses listed in
 *   AUTH_SIGNUP_ALLOWLIST (comma-separated); an empty list lets nobody in;
 * - `open`: public registration — any Google account whose email Google has
 *   verified gets a new free account.
 * Older env files that put `*` in AUTH_SIGNUP_ALLOWLIST (and set no mode) mean
 * `open`.
 */
export type SignupPolicy = { mode: 'open' } | { mode: 'invite'; invited: string[] };

const parseSignupPolicy = (mode: 'invite' | 'open' | undefined, allowlist: string | undefined): SignupPolicy => {
  const list = (allowlist ?? '').trim();
  if (mode === 'open' || (mode === undefined && list === '*')) return { mode: 'open' };
  return {
    mode: 'invite',
    invited: list
      .split(',')
      .map((email) => email.trim().toLowerCase())
      .filter((email) => email.includes('@')),
  };
};

export type MailTransport = 'disabled' | 'outbox';

export function authConfig() {
  const env = read(authSchema, 'authentication');
  return {
    baseURL: env.BETTER_AUTH_URL,
    secret: env.BETTER_AUTH_SECRET,
    google:
      env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET
        ? { clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET }
        : null,
    signups: parseSignupPolicy(env.AUTH_SIGNUP_MODE, env.AUTH_SIGNUP_ALLOWLIST),
    /** Which deployment this is; unset means an unnamed one (treated like production for anything risky). */
    appEnv: env.APP_ENV ?? null,
    /** Email and password sign-in (off unless AUTH_EMAIL_PASSWORD=on; always needs mail). */
    emailPassword: env.AUTH_EMAIL_PASSWORD === 'on',
    /**
     * Every administrator must enrol two-factor verification before using the
     * admin dashboard (off unless ADMIN_MFA_REQUIRED=on; docs/security/admin-2fa.md).
     * Admins who enrolled are always asked for a code, whatever this says.
     */
    adminMfaRequired: env.ADMIN_MFA_REQUIRED === 'on',
    mail: {
      transport: (env.MAIL_TRANSPORT ?? 'disabled') as MailTransport,
      from: env.MAIL_FROM?.trim() || 'Studio Companion <no-reply@studio-companion.invalid>',
    },
  };
}
