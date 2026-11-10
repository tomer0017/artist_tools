// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MongoClient, ObjectId } from 'mongodb';
import { MONGO_STARTUP_TIMEOUT, startTestMongo, type TestMongo } from '@/test/mongo';
import { PLAN_FEATURES } from '@/lib/plans';
import { FEATURES, collections, isDuplicateKeyError, toObjectId } from './collections';
import { INDEXES, migrate } from './migrate';
import { closeMongo, getDb, pingDb } from './client';
import { getUsage, recordUsage, usagePeriod } from '@/server/usage';

let mongo: TestMongo;

beforeAll(async () => {
  mongo = await startTestMongo();
}, MONGO_STARTUP_TIMEOUT);

afterAll(async () => {
  await closeMongo();
  await mongo?.stop();
});

describe('migration', () => {
  it('creates every index and seeds Free and Pro from the plan definitions', async () => {
    const report = await migrate(mongo.db);
    expect(report).toEqual({ indexes: INDEXES.length, plansInserted: 2, plansUpdated: 0, usersBackfilled: 0 });

    for (const index of INDEXES) {
      const names = (await mongo.db.collection(index.collection).listIndexes().toArray()).map((i) => i.name);
      expect(names).toContain(index.options.name);
    }
    const plans = await collections(mongo.db).plans.find().sort({ _id: 1 }).toArray();
    expect(plans.map((p) => p._id)).toEqual(['free', 'pro']);
    for (const plan of plans) {
      expect(plan.features).toEqual(PLAN_FEATURES[plan._id]);
      expect(plan.limits).toEqual({});
      expect(plan.active).toBe(true);
    }
    // Free keeps every tool and every existing save; only the two Pro GIF options differ.
    expect(FEATURES.filter((f) => !PLAN_FEATURES.free.includes(f))).toEqual(['export.gif_large', 'export.gif_difference']);
    expect(PLAN_FEATURES.pro).toEqual([...FEATURES]);
  });

  it('is idempotent and keeps stored plans in step with the code', async () => {
    const { plans } = collections(mongo.db);
    expect(await migrate(mongo.db)).toMatchObject({ plansInserted: 0, plansUpdated: 0 });
    // A plan edited (or seeded by an older release) in the database is brought back.
    await plans.updateOne({ _id: 'free' }, { $set: { features: [...FEATURES], name: 'Free (edited)' } });
    expect(await migrate(mongo.db)).toMatchObject({ plansInserted: 0, plansUpdated: 1 });
    expect(await plans.findOne({ _id: 'free' })).toMatchObject({ name: 'Free', features: PLAN_FEATURES.free });
    expect(await plans.countDocuments()).toBe(2);
  });

  it('puts accounts from before plans existed on Free, and leaves assigned plans alone', async () => {
    const { users } = collections(mongo.db);
    const legacy = new ObjectId();
    const pro = new ObjectId();
    const base = { name: 'L', emailVerified: true, createdAt: new Date(), updatedAt: new Date(), role: 'user' as const, status: 'active' as const, marketingConsent: false };
    await users.insertMany([
      { _id: legacy, email: 'legacy@example.com', ...base },
      { _id: pro, email: 'assigned-pro@example.com', plan: 'pro', ...base },
    ]);
    expect((await migrate(mongo.db)).usersBackfilled).toBe(1);
    expect((await users.findOne({ _id: legacy }))?.plan).toBe('free');
    expect((await users.findOne({ _id: pro }))?.plan).toBe('pro');
    expect((await migrate(mongo.db)).usersBackfilled).toBe(0);
  });

  it('expires sessions by their expiresAt', async () => {
    const ttl = (await mongo.db.collection('sessions').listIndexes().toArray()).find((i) => i.name === 'session_expiry_ttl');
    expect(ttl?.expireAfterSeconds).toBe(0);
  });
});

describe('unique constraints', () => {
  it('allows only one account per Google identity', async () => {
    const accounts = collections(mongo.db).accounts;
    const identity = { providerId: 'google', accountId: '1234567890' };
    const now = new Date();
    await accounts.insertOne({ _id: new ObjectId(), userId: new ObjectId(), ...identity, createdAt: now, updatedAt: now });
    const duplicate = accounts.insertOne({ _id: new ObjectId(), userId: new ObjectId(), ...identity, createdAt: now, updatedAt: now });
    await expect(duplicate).rejects.toSatisfy(isDuplicateKeyError);
  });

  it('allows only one record per payment-provider event', async () => {
    const events = collections(mongo.db).paymentEvents;
    const event = { provider: 'test', eventId: 'evt_1', type: 'x', status: 'processed' as const, receivedAt: new Date(), processedAt: null, error: null };
    await events.insertOne({ ...event });
    await expect(events.insertOne({ ...event })).rejects.toSatisfy(isDuplicateKeyError);
  });
});

describe('usage', () => {
  it('counts concurrent uses exactly, in a single document per month', async () => {
    const userId = new ObjectId();
    await Promise.all(Array.from({ length: 25 }, () => recordUsage(mongo.db, userId, 'export.gif')));
    expect(await getUsage(mongo.db, userId)).toEqual({ 'export.gif': 25 });
    expect(await collections(mongo.db).usage.countDocuments({ userId })).toBe(1);
  });

  it('starts a new count each calendar month (UTC)', async () => {
    const userId = new ObjectId();
    await recordUsage(mongo.db, userId, 'tool.compare', 1, new Date('2026-10-31T23:59:59Z'));
    await recordUsage(mongo.db, userId, 'tool.compare', 1, new Date('2026-11-01T00:00:00Z'));
    expect(await getUsage(mongo.db, userId, '2026-10')).toEqual({ 'tool.compare': 1 });
    expect(await getUsage(mongo.db, userId, '2026-11')).toEqual({ 'tool.compare': 1 });
    expect(usagePeriod(new Date('2026-11-09T12:00:00Z'))).toBe('2026-11');
  });
});

describe('connection lifecycle', () => {
  it('keeps data across an app restart (new client, same database)', async () => {
    process.env.MONGODB_URI = mongo.uri;
    process.env.MONGODB_DB = mongo.db.databaseName;
    const userId = new ObjectId();
    await recordUsage(getDb(), userId, 'tool.grid');
    await closeMongo(); // what a restart does to the pool
    expect(await getUsage(getDb(), userId)).toEqual({ 'tool.grid': 1 });
  });

  it('reports an unreachable database as not ready, without hanging', async () => {
    const dead = new MongoClient('mongodb://127.0.0.1:1/?directConnection=true', { serverSelectionTimeoutMS: 300 });
    const started = Date.now();
    expect(await pingDb(dead.db('x'), 500)).toBe(false);
    expect(Date.now() - started).toBeLessThan(5_000);
    await dead.close();
    expect(await pingDb(mongo.db)).toBe(true);
  });

  it('fails with a clear message when the database is not configured', async () => {
    await closeMongo();
    const saved = process.env.MONGODB_URI;
    delete process.env.MONGODB_URI;
    expect(() => getDb()).toThrow('[config] database: MONGODB_URI is not set');
    process.env.MONGODB_URI = saved;
  });
});

describe('ids', () => {
  it('accepts only well-formed ObjectIds from untrusted input', () => {
    expect(toObjectId('507f1f77bcf86cd799439011')?.toHexString()).toBe('507f1f77bcf86cd799439011');
    for (const bad of ['', 'abc', '507f1f77bcf86cd79943901z', '{"$ne":null}', null, undefined]) {
      expect(toObjectId(bad as string)).toBeNull();
    }
  });
});
