import 'server-only';
import { MongoClient, type Db } from 'mongodb';
import { dbConfig } from '@/server/env';

// One MongoClient per server process (it manages its own connection pool and
// connects on first use). In development, module reloads would otherwise open
// a new pool on every edit, so the client lives on globalThis.

interface Mongo {
  client: MongoClient;
  db: Db;
}

const holder = globalThis as unknown as { __studioMongo?: Mongo };

export function getMongo(): Mongo {
  if (!holder.__studioMongo) {
    const { MONGODB_URI, MONGODB_DB } = dbConfig();
    const client = new MongoClient(MONGODB_URI, {
      appName: 'studio-companion',
      maxPoolSize: 10,
      serverSelectionTimeoutMS: 5_000,
      connectTimeoutMS: 10_000,
    });
    holder.__studioMongo = { client, db: client.db(MONGODB_DB) };
  }
  return holder.__studioMongo;
}

export const getDb = (): Db => getMongo().db;

/** Close the pool: graceful shutdown, scripts and tests. */
export async function closeMongo(): Promise<void> {
  const current = holder.__studioMongo;
  holder.__studioMongo = undefined;
  await current?.client.close();
}

/** Readiness probe: true when the database answers in time. */
export async function pingDb(db: Db = getDb(), timeoutMs = 2_000): Promise<boolean> {
  try {
    await db.command({ ping: 1 }, { timeoutMS: timeoutMs });
    return true;
  } catch {
    return false;
  }
}
