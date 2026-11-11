// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ObjectId, type Db } from 'mongodb';
import { MONGO_STARTUP_TIMEOUT, startTestMongo, type TestMongo } from '@/test/mongo';
import { migrate } from '@/server/db/migrate';
import { collections } from '@/server/db/collections';
import { listAuditEvents, listUsers, setTestAccount, setUserStatus, userStats } from './admin';
import { clearPlanCache, computeEntitlements, getEntitlements } from './entitlements';
import { activeGrant, createGrant, revokeGrant } from './grants';
import { PLAN_FEATURES } from '@/lib/plans';

// Commercial admin operations against a real database: promotional access,
// suspension, test accounts, list filters and the audit filters.

let mongo: TestMongo;
let db: Db;

beforeAll(async () => {
  mongo = await startTestMongo();
  db = mongo.db;
  await migrate(db);
  clearPlanCache();
}, MONGO_STARTUP_TIMEOUT);

afterAll(async () => mongo?.stop());

const DAY = 24 * 60 * 60 * 1000;

async function seedUser(overrides: Record<string, unknown> = {}, methods: string[] = ['google']) {
  const _id = new ObjectId();
  const now = new Date();
  await collections(db).users.insertOne({
    _id,
    name: 'Test Person',
    email: `${_id.toHexString()}@example.com`,
    emailVerified: true,
    createdAt: now,
    updatedAt: now,
    role: 'user',
    status: 'active',
    plan: 'free',
    marketingConsent: false,
    ...overrides,
  } as never);
  for (const providerId of methods) {
    await collections(db).accounts.insertOne({ _id: new ObjectId(), userId: _id, providerId, accountId: `${providerId}-${_id.toHexString()}`, createdAt: now, updatedAt: now });
  }
  return _id;
}

describe('promotional access', () => {
  it('gives a plan for a limited time without touching the assigned plan, and ends on its own', async () => {
    const person = await seedUser();
    const result = await createGrant(db, { userId: person, planId: 'pro', days: 30, reason: 'promotion', actor: 'admin:abc' });
    expect(result.status).toBe('created');

    const now = new Date();
    const during = await getEntitlements(db, person, now);
    expect(during).toMatchObject({ planId: 'pro', assignedPlan: 'free', access: 'pro' });
    expect(during.grant?.planId).toBe('pro');
    expect(during.features).toEqual(PLAN_FEATURES.pro);
    expect((await collections(db).users.findOne({ _id: person }))!.plan).toBe('free');

    const after = await getEntitlements(db, person, new Date(now.getTime() + 31 * DAY));
    expect(after).toMatchObject({ planId: 'free', grant: null });
    expect(await collections(db).auditEvents.findOne({ userId: person, type: 'admin.grant_created' })).toMatchObject({
      actor: 'admin:abc',
      metadata: { planId: 'pro', days: 30, reason: 'promotion' },
    });
  });

  it('can be ended early, and refuses nonsense', async () => {
    const person = await seedUser();
    const created = await createGrant(db, { userId: person, planId: 'pro', days: 7, reason: 'trial', actor: 'admin:abc' });
    if (created.status !== 'created') throw new Error('not created');
    expect(await revokeGrant(db, { userId: person, grantId: created.grantId, actor: 'admin:abc' })).toBe('revoked');
    expect(await revokeGrant(db, { userId: person, grantId: created.grantId, actor: 'admin:abc' })).toBe('not_found');
    expect(await activeGrant(db, person)).toBeNull();
    // Another person's grant id cannot be ended through this account.
    const other = await seedUser();
    const theirs = await createGrant(db, { userId: other, planId: 'pro', days: 7, reason: 'support', actor: 'admin:abc' });
    if (theirs.status !== 'created') throw new Error('not created');
    expect(await revokeGrant(db, { userId: person, grantId: theirs.grantId, actor: 'admin:abc' })).toBe('not_found');
    expect((await activeGrant(db, other))?.planId).toBe('pro');

    for (const bad of [{ days: 0 }, { days: 400 }, { days: 2.5 }, { reason: 'because' }, { planId: 'gold' }]) {
      expect((await createGrant(db, { userId: person, planId: 'pro', days: 30, reason: 'promotion', actor: 'admin:abc', ...bad } as never)).status).toBe('invalid');
    }
    expect((await createGrant(db, { userId: new ObjectId(), planId: 'pro', days: 30, reason: 'promotion', actor: 'admin:abc' })).status).toBe('not_found');
  });

  it('counts in the pure entitlement calculation only while it lasts, and never makes anyone an admin', () => {
    const plans = { free: { active: true, features: [...PLAN_FEATURES.free], limits: {} }, pro: { active: true, features: [...PLAN_FEATURES.pro], limits: {} } };
    const now = new Date('2026-11-11T12:00:00Z');
    const live = computeEntitlements({ user: { status: 'active', plan: 'free' }, subscription: null, plans, usage: {}, now, grant: { planId: 'pro', endsAt: new Date(now.getTime() + DAY) } });
    expect(live).toMatchObject({ planId: 'pro', role: 'user', access: 'pro' });
    const ended = computeEntitlements({ user: { status: 'active', plan: 'free' }, subscription: null, plans, usage: {}, now, grant: { planId: 'pro', endsAt: new Date(now.getTime() - 1) } });
    expect(ended).toMatchObject({ planId: 'free', grant: null });
    const suspended = computeEntitlements({ user: { status: 'suspended', plan: 'free' }, subscription: null, plans, usage: {}, now, grant: { planId: 'pro', endsAt: new Date(now.getTime() + DAY) } });
    expect(suspended).toMatchObject({ access: 'none', features: [] });
  });
});

describe('suspending accounts', () => {
  it('needs a reason, signs the account out everywhere, and can be undone', async () => {
    const admin = await seedUser({ role: 'admin' });
    const person = await seedUser();
    await collections(db).sessions.insertMany([
      { _id: new ObjectId(), userId: person, token: 'a', expiresAt: new Date(Date.now() + DAY), createdAt: new Date(), updatedAt: new Date() },
      { _id: new ObjectId(), userId: person, token: 'b', expiresAt: new Date(Date.now() + DAY), createdAt: new Date(), updatedAt: new Date() },
    ]);
    expect(await setUserStatus(db, { userId: person, status: 'suspended', actor: `admin:${admin}`, actorUserId: admin })).toBe('invalid');
    expect(await setUserStatus(db, { userId: person, status: 'suspended', reason: 'abuse', actor: `admin:${admin}`, actorUserId: admin })).toBe('updated');
    expect(await collections(db).sessions.countDocuments({ userId: person })).toBe(0);
    expect(await collections(db).users.findOne({ _id: person })).toMatchObject({ status: 'suspended', suspendReason: 'abuse' });
    expect((await getEntitlements(db, person)).access).toBe('none');
    expect(await collections(db).auditEvents.findOne({ userId: person, type: 'admin.account_suspended' })).toMatchObject({ metadata: { reason: 'abuse', sessionsEnded: 2 } });
    expect(await setUserStatus(db, { userId: person, status: 'suspended', reason: 'abuse', actor: `admin:${admin}`, actorUserId: admin })).toBe('unchanged');

    expect(await setUserStatus(db, { userId: person, status: 'active', actor: `admin:${admin}`, actorUserId: admin })).toBe('updated');
    const back = await collections(db).users.findOne({ _id: person });
    expect(back).toMatchObject({ status: 'active' });
    expect(back!.suspendReason).toBeUndefined();
    expect(await collections(db).auditEvents.countDocuments({ userId: person, type: 'admin.account_reactivated' })).toBe(1);
  });

  it('never suspends yourself or the last active admin', async () => {
    await collections(db).users.updateMany({ role: 'admin' }, { $set: { role: 'user' } });
    const only = await seedUser({ role: 'admin' });
    expect(await setUserStatus(db, { userId: only, status: 'suspended', reason: 'security', actor: `admin:${only}`, actorUserId: only })).toBe('self');
    expect(await setUserStatus(db, { userId: only, status: 'suspended', reason: 'security', actor: 'cli' })).toBe('last_admin');
    const second = await seedUser({ role: 'admin' });
    expect(await setUserStatus(db, { userId: only, status: 'suspended', reason: 'security', actor: `admin:${second}`, actorUserId: second })).toBe('updated');
    expect(await setUserStatus(db, { userId: second, status: 'suspended', reason: 'security', actor: 'cli' })).toBe('last_admin');
    expect(await setUserStatus(db, { userId: new ObjectId(), status: 'suspended', reason: 'security', actor: 'cli' })).toBe('not_found');
  });
});

describe('finding accounts', () => {
  it('filters by role, plan, status, verification, sign-in method, test flag and registration date', async () => {
    await collections(db).users.deleteMany({});
    await collections(db).accounts.deleteMany({});
    await collections(db).accessGrants.deleteMany({});
    const old = new Date('2026-01-15T00:00:00Z');
    const admin = await seedUser({ role: 'admin', createdAt: old });
    const pro = await seedUser({ plan: 'pro' });
    const suspended = await seedUser({ status: 'suspended' });
    const password = await seedUser({ emailVerified: false }, ['credential']);
    const both = await seedUser({}, ['google', 'credential']);
    const test = await seedUser({ testAccount: true });
    await createGrant(db, { userId: suspended, planId: 'pro', days: 5, reason: 'support', actor: 'cli' });

    const ids = async (query: Parameters<typeof listUsers>[1]) => (await listUsers(db, query)).rows.map((r) => r.id).sort();
    const hex = (...list: ObjectId[]) => list.map((id) => id.toHexString()).sort();
    expect(await ids({ role: 'admin' })).toEqual(hex(admin));
    expect(await ids({ plan: 'pro' })).toEqual(hex(pro));
    expect((await ids({ plan: 'free' })).length).toBe(5);
    expect(await ids({ status: 'suspended' })).toEqual(hex(suspended));
    expect(await ids({ verified: false })).toEqual(hex(password));
    expect(await ids({ method: 'password' })).toEqual(hex(password, both));
    expect((await ids({ method: 'google' })).length).toBe(5);
    expect(await ids({ test: true })).toEqual(hex(test));
    expect((await ids({ test: false })).length).toBe(5);
    expect(await ids({ createdBefore: new Date('2026-02-01T00:00:00Z') })).toEqual(hex(admin));
    expect(await ids({ createdFrom: new Date('2026-02-01T00:00:00Z'), method: 'password', verified: true })).toEqual(hex(both));

    const rows = (await listUsers(db, {})).rows;
    expect(rows.find((r) => r.id === suspended.toHexString())).toMatchObject({ effectivePlan: 'pro', plan: 'free' });
    expect(rows.find((r) => r.id === both.toHexString())).toMatchObject({ password: true, google: { linked: true } });
    expect(rows.find((r) => r.id === test.toHexString())).toMatchObject({ testAccount: true });
    expect(await userStats(db)).toMatchObject({ total: 6, admins: 1, pro: 1, suspended: 1, test: 1, granted: 1 });
  });

  it('marks test accounts, audited', async () => {
    const person = await seedUser();
    expect(await setTestAccount(db, { userId: person, test: true, actor: 'admin:abc' })).toBe('updated');
    expect(await setTestAccount(db, { userId: person, test: true, actor: 'admin:abc' })).toBe('unchanged');
    expect(await collections(db).auditEvents.findOne({ userId: person, type: 'admin.test_flag_changed' })).toMatchObject({ metadata: { test: true } });
  });

  it('filters the audit log by kind, actor and date', async () => {
    const person = await seedUser();
    const at = (iso: string) => new Date(iso);
    await collections(db).auditEvents.insertMany([
      { type: 'user.login', userId: person, actor: `user:${person}`, at: at('2026-03-01T10:00:00Z'), metadata: {} },
      { type: 'admin.plan_changed', userId: person, actor: 'admin:abc', at: at('2026-03-02T10:00:00Z'), metadata: { from: 'free', to: 'pro' } },
      { type: 'auth.throttled', userId: null, actor: 'system', at: at('2026-03-03T10:00:00Z'), metadata: { purpose: 'sign_in' } },
    ]);
    const types = async (query: Parameters<typeof listAuditEvents>[1]) => (await listAuditEvents(db, { ...query, from: at('2026-03-01T00:00:00Z'), before: at('2026-03-04T00:00:00Z') })).map((e) => e.type);
    expect(await types({})).toEqual(['auth.throttled', 'admin.plan_changed', 'user.login']);
    expect(await types({ types: ['user.login'] })).toEqual(['user.login']);
    expect(await types({ actorKind: 'admin' })).toEqual(['admin.plan_changed']);
    expect(await types({ actorKind: 'system' })).toEqual(['auth.throttled']);
    expect(await types({ userId: person })).toEqual(['admin.plan_changed', 'user.login']);
    expect(await listAuditEvents(db, { from: at('2026-03-02T00:00:00Z'), before: at('2026-03-03T00:00:00Z') })).toHaveLength(1);
  });
});
