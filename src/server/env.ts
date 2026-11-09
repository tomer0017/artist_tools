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
 * Who may create a new account. Empty or unset: nobody (registration closed —
 * existing accounts still sign in). A comma-separated list: only those
 * addresses, once Google has verified them. `*`: anyone (public registration).
 */
export type SignupPolicy = '*' | string[];

const parseSignupPolicy = (raw: string | undefined): SignupPolicy => {
  const value = (raw ?? '').trim();
  if (value === '*') return '*';
  return value
    .split(',')
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
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
    signups: parseSignupPolicy(env.AUTH_SIGNUP_ALLOWLIST),
  };
}
