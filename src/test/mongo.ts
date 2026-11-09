import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { MongoClient, type Db } from 'mongodb';

// A throwaway MongoDB for integration tests: a single-node replica set (like
// Atlas, so transactions work). The first run downloads the mongod binary.

export interface TestMongo {
  uri: string;
  client: MongoClient;
  db: Db;
  stop: () => Promise<void>;
}

export const MONGO_STARTUP_TIMEOUT = 180_000;

export async function startTestMongo(): Promise<TestMongo> {
  const replSet = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } });
  const uri = replSet.getUri();
  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db(`test_${Math.random().toString(36).slice(2, 10)}`);
  return {
    uri,
    client,
    db,
    stop: async () => {
      await client.close();
      await replSet.stop();
    },
  };
}
