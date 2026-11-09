// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ObjectId } from 'mongodb';
import { MONGO_STARTUP_TIMEOUT, startTestMongo, type TestMongo } from '@/test/mongo';
import { collections } from '@/server/db/collections';
import { migrate } from '@/server/db/migrate';
import { processPaymentEvent } from '@/server/billing/process';
import type { VerifiedPaymentEvent } from '@/server/billing/provider';
import { getEntitlements, clearPlanCache } from '@/server/entitlements';
import { trackEvent } from '@/server/analytics';
import { listUsers, setUserRole, findUserByEmail } from '@/server/admin';
import { recordUsage } from '@/server/usage';

let mongo: TestMongo;

beforeAll(async () => {
  mongo = await startTestMongo();
  await migrate(mongo.db);
}, MONGO_STARTUP_TIMEOUT);
afterAll(async () => mongo?.stop());

async function newUser(email: string, createdAt = new Date()) {
  const _id = new ObjectId();
  await collections(mongo.db).users.insertOne({ _id, name: email.split('@')[0], email, emailVerified: true, createdAt, updatedAt: createdAt, role: 'user', status: 'active', marketingConsent: false });
  return _id;
}

const event = (userId: ObjectId, eventId: string, status: 'active' | 'canceled' | 'expired', periodEnd: Date): VerifiedPaymentEvent => ({
  provider: 'test',
  eventId,
  type: `subscription.${status}`,
  subscription: {
    userId: userId.toHexString(),
    planId: 'pro',
    providerCustomerId: 'cus_1',
    providerSubscriptionId: `sub_${userId}`,
    status,
    currentPeriodStart: new Date(),
    currentPeriodEnd: periodEnd,
    cancelAtPeriodEnd: status === 'canceled',
    canceledAt: status === 'canceled' ? new Date() : null,
  },
});

describe('payment events', () => {
  it('apply exactly once, update the subscription server-side, and are audited', async () => {
    clearPlanCache();
    const userId = await newUser('payer@example.com');
    const inAMonth = new Date(Date.now() + 30 * 86_400_000);
    const created = event(userId, 'evt_1', 'active', inAMonth);

    expect(await processPaymentEvent(mongo.db, created)).toBe('processed');
    expect(await processPaymentEvent(mongo.db, created)).toBe('duplicate'); // provider retry
    expect(await collections(mongo.db).subscriptions.countDocuments({ userId })).toBe(1);
    expect((await getEntitlements(mongo.db, userId)).planId).toBe('pro');

    expect(await processPaymentEvent(mongo.db, event(userId, 'evt_2', 'expired', inAMonth))).toBe('processed');
    expect((await getEntitlements(mongo.db, userId)).planId).toBe('free');

    const audit = await collections(mongo.db).auditEvents.find({ userId, type: 'subscription.changed' }).sort({ _id: 1 }).toArray();
    expect(audit.map((a) => a.metadata.status)).toEqual(['active', 'expired']);
    expect(audit.every((a) => a.actor === 'webhook:test')).toBe(true);
  });

  it('ignores events that carry no usable subscription', async () => {
    expect(await processPaymentEvent(mongo.db, { provider: 'test', eventId: 'evt_x', type: 'invoice.created' })).toBe('ignored');
    const badUser = { ...event(new ObjectId(), 'evt_y', 'active', new Date()), subscription: { ...event(new ObjectId(), 'evt_y', 'active', new Date()).subscription!, userId: 'not-an-id' } };
    expect(await processPaymentEvent(mongo.db, badUser)).toBe('ignored');
  });
});

describe('analytics', () => {
  it('records one-off events once, however often they are sent', async () => {
    const userId = new ObjectId();
    const send = () => trackEvent(mongo.db, { name: 'first_export', userId, dedupeKey: `first_export:${userId}` });
    expect(await send()).toBe('recorded');
    expect(await send()).toBe('duplicate');
    expect(await trackEvent(mongo.db, { name: 'tool_use', userId, props: { tool: 'grid' } })).toBe('recorded');
    expect(await trackEvent(mongo.db, { name: 'tool_use', userId, props: { tool: 'grid' } })).toBe('recorded');
    expect(await collections(mongo.db).analyticsEvents.countDocuments({ userId })).toBe(3);
  });
});

describe('admin', () => {
  it('lists users newest first with plan, last login and usage', async () => {
    const older = await newUser('older@example.com', new Date('2026-01-01'));
    const newer = await newUser('newer@example.com', new Date('2026-11-01'));
    await recordUsage(mongo.db, newer, 'tool.grid', 4);
    const { rows, total } = await listUsers(mongo.db, 1, 500);
    const emails = rows.map((r) => r.email);
    expect(emails.indexOf('newer@example.com')).toBeLessThan(emails.indexOf('older@example.com'));
    expect(total).toBe(rows.length);
    const row = rows.find((r) => r.id === newer.toHexString())!;
    expect(row).toMatchObject({ role: 'user', status: 'active', planId: null, usageThisMonth: 4 });
    expect(Object.keys(row).sort()).toEqual(['createdAt', 'email', 'id', 'lastLoginAt', 'name', 'planId', 'role', 'status', 'subscriptionStatus', 'usageThisMonth']);
    expect(rows.find((r) => r.id === older.toHexString())).toBeTruthy();
  });

  it('pages through users and clamps out-of-range pages', async () => {
    const all = await listUsers(mongo.db, 1, 2);
    expect(all.rows).toHaveLength(2);
    expect((await listUsers(mongo.db, 999, 2)).page).toBe(all.pages);
    expect((await listUsers(mongo.db, -5, 2)).page).toBe(1);
  });

  it('grants and revokes admin by user id, with an audit trail', async () => {
    const userId = await newUser('Future.Admin@Example.com'.toLowerCase());
    expect(await findUserByEmail(mongo.db, ' FUTURE.admin@example.com ')).toMatchObject({ email: 'future.admin@example.com' });
    expect(await setUserRole(mongo.db, userId, 'admin', 'cli')).toBe(true);
    expect((await collections(mongo.db).users.findOne({ _id: userId }))?.role).toBe('admin');
    expect(await setUserRole(mongo.db, userId, 'user', 'cli')).toBe(true);
    expect(await setUserRole(mongo.db, new ObjectId(), 'admin', 'cli')).toBe(false);
    const types = (await collections(mongo.db).auditEvents.find({ userId }).sort({ _id: 1 }).toArray()).map((a) => a.type);
    expect(types).toEqual(['admin.role_granted', 'admin.role_revoked']);
  });
});
