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

const authSchema = z.object({
  BETTER_AUTH_URL: required('BETTER_AUTH_URL').url('BETTER_AUTH_URL must be a full URL, e.g. http://localhost:8080'),
  BETTER_AUTH_SECRET: required('BETTER_AUTH_SECRET').min(32, 'BETTER_AUTH_SECRET must be at least 32 characters'),
  GOOGLE_CLIENT_ID: required('GOOGLE_CLIENT_ID'),
  GOOGLE_CLIENT_SECRET: required('GOOGLE_CLIENT_SECRET'),
});

function read<T extends z.ZodTypeAny>(schema: T, area: string): z.infer<T> {
  const result = schema.safeParse(process.env);
  if (!result.success) {
    throw new Error(`[config] ${area}: ${result.error.issues.map((i) => i.message).join('; ')}`);
  }
  return result.data;
}

export const dbConfig = () => read(dbSchema, 'database');
export const authConfig = () => read(authSchema, 'authentication');
