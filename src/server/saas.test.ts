// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ObjectId } from 'mongodb';
import { MONGO_STARTUP_TIMEOUT, startTestMongo, type TestMongo } from '@/test/mongo';
import { FEATURES, collections } from '@/server/db/collections';
import { migrate } from '@/server/db/migrate';
import { processPaymentEvent } from '@/server/billing/process';
import type { VerifiedPaymentEvent } from '@/server/billing/provider';
import { getEntitlements, clearPlanCache } from '@/server/entitlements';
import { trackEvent } from '@/server/analytics';
import { findUserByEmail, getUserDetail, listAuditEvents, listUsers, setUserPlan, setUserRole } from '@/server/admin';
import { recordAudit } from '@/server/audit';
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
  const db = () => mongo.db;

  it('lists users newest first with role, plan, Google link, sign-ins and GIFs this month', async () => {
    const older = await newUser('older@example.com', new Date('2026-01-01'));
    const newer = await newUser('newer@example.com', new Date('2026-11-01'));
    await collections(db()).accounts.insertOne({ _id: new ObjectId(), userId: newer, providerId: 'google', accountId: '109876543210987654321', createdAt: new Date(), updatedAt: new Date() });
    await recordAudit(db(), { type: 'user.login', userId: newer, actor: `user:${newer}` });
    await recordAudit(db(), { type: 'user.login', userId: newer, actor: `user:${newer}` });
    await recordUsage(db(), newer, 'export.gif', 4);
    await recordUsage(db(), newer, 'export.gif_large', 1); // part of one of those GIFs, not another GIF
    const { rows, total } = await listUsers(db(), { pageSize: 200 });
    const emails = rows.map((r) => r.email);
    expect(emails.indexOf('newer@example.com')).toBeLessThan(emails.indexOf('older@example.com'));
    expect(total).toBe(rows.length);
    const row = rows.find((r) => r.id === newer.toHexString())!;
    expect(row).toMatchObject({
      role: 'user', status: 'active', plan: 'free', effectivePlan: 'free', subscriptionStatus: null,
      gifsThisMonth: 4, logins: 2, google: { linked: true, idHint: '…4321' }, password: false, testAccount: false, grant: null,
    });
    // Google's full account id never leaves the server.
    expect(JSON.stringify(row)).not.toContain('109876543210987654321');
    expect(Object.keys(row).sort()).toEqual(
      ['createdAt', 'effectivePlan', 'email', 'emailVerified', 'gifsThisMonth', 'google', 'grant', 'id', 'image', 'lastLoginAt', 'logins', 'name', 'password', 'plan', 'role', 'status', 'subscriptionStatus', 'testAccount'],
    );
    expect(rows.find((r) => r.id === older.toHexString())).toMatchObject({ google: { linked: false, idHint: null }, logins: 0 });
  });

  it('searches by part of an email, treating the search as plain text', async () => {
    await newUser('a.b+c@example.com');
    expect((await listUsers(db(), { search: ' B+C@ ' })).rows.map((r) => r.email)).toEqual(['a.b+c@example.com']);
    expect((await listUsers(db(), { search: '.*' })).total).toBe(0);
    expect((await listUsers(db(), { search: 'nobody-here' })).rows).toEqual([]);
  });

  it('pages through users and clamps out-of-range pages', async () => {
    const all = await listUsers(db(), { page: 1, pageSize: 2 });
    expect(all.rows).toHaveLength(2);
    expect((await listUsers(db(), { page: 999, pageSize: 2 })).page).toBe(all.pages);
    expect((await listUsers(db(), { page: -5, pageSize: 2 })).page).toBe(1);
  });

  it('assigns plans by user id with an audit trail, and a plan never changes the role', async () => {
    const userId = await newUser('plan.change@example.com');
    clearPlanCache();
    expect(await setUserPlan(db(), { userId, plan: 'pro', actor: 'admin:tester' })).toEqual({ status: 'updated', from: 'free', to: 'pro' });
    expect(await setUserPlan(db(), { userId, plan: 'pro', actor: 'admin:tester' })).toEqual({ status: 'unchanged', plan: 'pro' });
    expect(await collections(db()).users.findOne({ _id: userId })).toMatchObject({ plan: 'pro', role: 'user', planUpdatedBy: 'admin:tester' });
    const pro = await getEntitlements(db(), userId);
    expect(pro).toMatchObject({ planId: 'pro', role: 'user', access: 'pro', subscriptionStatus: null });
    expect(pro.features).toContain('export.gif_large');

    expect(await setUserPlan(db(), { userId, plan: 'free', actor: 'cli' })).toEqual({ status: 'updated', from: 'pro', to: 'free' });
    expect((await getEntitlements(db(), userId)).features).not.toContain('export.gif_large');
    expect(await setUserPlan(db(), { userId: new ObjectId(), plan: 'pro', actor: 'cli' })).toEqual({ status: 'not_found' });
    await expect(setUserPlan(db(), { userId, plan: 'enterprise' as never, actor: 'cli' })).rejects.toThrow();

    const audit = await collections(db()).auditEvents.find({ userId, type: 'admin.plan_changed' }).sort({ _id: 1 }).toArray();
    expect(audit.map((a) => [a.actor, a.metadata.from, a.metadata.to])).toEqual([['admin:tester', 'free', 'pro'], ['cli', 'pro', 'free']]);
  });

  it('grants and revokes admin by user id, with an audit trail', async () => {
    const keeper = await newUser('keeper@example.com');
    expect(await setUserRole(db(), { userId: keeper, role: 'admin', actor: 'cli' })).toBe('updated');
    const userId = await newUser('Future.Admin@Example.com'.toLowerCase());
    expect(await findUserByEmail(db(), ' FUTURE.admin@example.com ')).toMatchObject({ email: 'future.admin@example.com' });
    expect(await setUserRole(db(), { userId, role: 'admin', actor: 'cli' })).toBe('updated');
    expect(await setUserRole(db(), { userId, role: 'admin', actor: 'cli' })).toBe('unchanged');
    expect((await collections(db()).users.findOne({ _id: userId }))?.role).toBe('admin');
    // Admin access gives every feature, whatever the plan.
    const admin = await getEntitlements(db(), userId);
    expect(admin).toMatchObject({ access: 'admin', role: 'admin', planId: 'free' });
    expect(admin.features).toEqual([...FEATURES]);

    expect(await setUserRole(db(), { userId, role: 'user', actor: `admin:${keeper}`, actorUserId: keeper })).toBe('updated');
    expect(await setUserRole(db(), { userId: new ObjectId(), role: 'admin', actor: 'cli' })).toBe('not_found');
    const types = (await collections(db()).auditEvents.find({ userId }).sort({ _id: 1 }).toArray()).map((a) => a.type);
    expect(types).toEqual(['admin.role_granted', 'admin.role_revoked']);
    const events = await listAuditEvents(db(), { userId });
    expect(events[0]).toMatchObject({ type: 'admin.role_revoked', actor: { kind: 'admin', email: 'keeper@example.com' }, subject: { email: 'future.admin@example.com' } });
  });

  it('never removes the last admin, and admins cannot remove their own access', async () => {
    const { users } = collections(db());
    await users.updateMany({ role: 'admin' }, { $set: { role: 'user' } });
    const solo = await newUser('solo.admin@example.com');
    await users.updateOne({ _id: solo }, { $set: { role: 'admin' } });

    expect(await setUserRole(db(), { userId: solo, role: 'user', actor: 'cli' })).toBe('last_admin');
    expect((await users.findOne({ _id: solo }))?.role).toBe('admin');
    // A suspended admin does not count as the one who stays.
    const suspended = await newUser('suspended.admin@example.com');
    await users.updateOne({ _id: suspended }, { $set: { role: 'admin', status: 'suspended' } });
    expect(await setUserRole(db(), { userId: solo, role: 'user', actor: 'cli' })).toBe('last_admin');

    const other = await newUser('other.admin@example.com');
    expect(await setUserRole(db(), { userId: other, role: 'admin', actor: `admin:${solo}`, actorUserId: solo })).toBe('updated');
    expect(await setUserRole(db(), { userId: other, role: 'user', actor: `admin:${other}`, actorUserId: other })).toBe('self');
    expect((await users.findOne({ _id: other }))?.role).toBe('admin');
    expect(await setUserRole(db(), { userId: other, role: 'user', actor: `admin:${solo}`, actorUserId: solo })).toBe('updated');
    expect(await collections(db()).auditEvents.countDocuments({ userId: solo, type: 'admin.role_revoked' })).toBe(0);
  });

  it('describes one account for support without tokens or provider ids', async () => {
    const userId = await newUser('detail@example.com');
    const { accounts, sessions } = collections(db());
    await accounts.insertOne({ _id: new ObjectId(), userId, providerId: 'google', accountId: '555544443333222211110', createdAt: new Date(), updatedAt: new Date() });
    await sessions.insertOne({ _id: new ObjectId(), userId, token: 'secret-session-token', expiresAt: new Date(Date.now() + 86_400_000), createdAt: new Date(), updatedAt: new Date() });
    await sessions.insertOne({ _id: new ObjectId(), userId, token: 'expired-session-token', expiresAt: new Date(Date.now() - 1000), createdAt: new Date(), updatedAt: new Date() });
    await recordUsage(db(), userId, 'export.gif', 3);

    const detail = await getUserDetail(db(), userId);
    expect(detail).toMatchObject({ email: 'detail@example.com', plan: 'free', role: 'user', google: { linked: true, idHint: '…1110' }, sessions: { active: 1 }, usageThisMonth: { 'export.gif': 3 } });
    const text = JSON.stringify(detail);
    for (const secret of ['secret-session-token', 'expired-session-token', '555544443333222211110']) expect(text).not.toContain(secret);
    expect(await getUserDetail(db(), new ObjectId())).toBeNull();
  });
});
