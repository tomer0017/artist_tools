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
  })
  .refine((env) => !env.GOOGLE_CLIENT_ID === !env.GOOGLE_CLIENT_SECRET, {
    message: 'GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET must be set together',
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
  };
}
