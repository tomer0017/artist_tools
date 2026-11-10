// Everything the end-to-end tests run against, started by Playwright:
//   1. a throwaway MongoDB (single-node replica set, like Atlas), migrated;
//   2. signed-in test accounts — sessions created in the database and signed
//      with this run's random secret, exactly as Better Auth signs them — whose
//      cookies are written to e2e/.auth/<name>.json for Playwright;
//   3. the production (standalone) server, pointed at that database.
// No login bypass exists in the app: tests are signed in the way a real
// session is, and the server verifies them the same way.
//
// Runs with the react-server condition so `server-only` modules can be imported.
import { spawn } from 'node:child_process';
import { createHmac, randomBytes } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { MongoClient, ObjectId, type Db } from 'mongodb';
import { migrate } from '@/server/db/migrate';

const PORT = 8080;
const BASE_URL = `http://localhost:${PORT}`;
const SECRET = randomBytes(32).toString('base64');
const DB_NAME = 'studio_e2e';

/** The signed cookie value Better Auth expects: `token.HMAC-SHA256(token)`, URL-encoded. */
const signedCookie = (token: string) => encodeURIComponent(`${token}.${createHmac('sha256', SECRET).update(token).digest('base64')}`);

async function seedSignedInUser(db: Db, name: string, role: 'user' | 'admin', plan: 'free' | 'pro' = 'free', sessionExpired = false) {
  const userId = new ObjectId();
  const now = new Date();
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
    lastLoginAt: now,
    marketingConsent: false,
  });
  await db.collection('audit_events').insertOne({ type: 'user.registered', userId, actor: `user:${userId}`, at: now, metadata: { provider: 'google' } });
  await db.collection('accounts').insertOne({ _id: new ObjectId(), userId, providerId: 'google', accountId: `e2e-${name}`, createdAt: now, updatedAt: now });
  const token = randomBytes(24).toString('base64url');
  await db.collection('sessions').insertOne({
    _id: new ObjectId(),
    userId,
    token,
    expiresAt: new Date(Date.now() + (sessionExpired ? -60 * 60 * 1000 : 7 * 24 * 60 * 60 * 1000)),
    createdAt: now,
    updatedAt: now,
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
mkdirSync('e2e/.auth', { recursive: true });
await seedSignedInUser(db, 'user', 'user'); // Free: what specs are signed in as by default
await seedSignedInUser(db, 'pro', 'user', 'pro');
await seedSignedInUser(db, 'admin', 'admin');
await seedSignedInUser(db, 'signout', 'user');
// Accounts the admin specs change (plan, role); nothing else relies on them.
await seedSignedInUser(db, 'target', 'user');
await seedSignedInUser(db, 'promote', 'user');
await seedSignedInUser(db, 'leaver', 'user');
await seedSignedInUser(db, 'expired', 'user', 'free', true);
await client.close();

const server = spawn('node', ['.next/standalone/server.js'], {
  stdio: 'inherit',
  env: {
    ...process.env,
    NODE_ENV: 'production',
    PORT: String(PORT),
    MONGODB_URI: replSet.getUri(),
    MONGODB_DB: DB_NAME,
    BETTER_AUTH_URL: BASE_URL,
    BETTER_AUTH_SECRET: SECRET,
    GOOGLE_CLIENT_ID: 'e2e-client-id.apps.googleusercontent.com',
    GOOGLE_CLIENT_SECRET: 'e2e-client-secret',
  },
});

const stop = async () => {
  server.kill('SIGTERM');
  await replSet.stop();
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
server.on('exit', async (code) => {
  await replSet.stop();
  process.exit(code ?? 0);
});
