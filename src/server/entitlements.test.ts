// @vitest-environment node
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ObjectId } from 'mongodb';
import { MONGO_STARTUP_TIMEOUT, startTestMongo, type TestMongo } from '@/test/mongo';
import { FEATURES, collections, type PlanDoc, type PlanId, type SubscriptionDoc } from '@/server/db/collections';
import { migrate } from '@/server/db/migrate';
import { recordUsage } from '@/server/usage';
import { canUse, clearPlanCache, computeEntitlements, getEntitlements, remaining, subscriptionGrantsPlan, GRACE_DAYS } from './entitlements';

const NOW = new Date('2026-11-09T12:00:00Z');
const day = (n: number) => new Date(NOW.getTime() + n * 24 * 60 * 60 * 1000);
const plan = (features = [...FEATURES], limits: PlanDoc['limits'] = {}) => ({ active: true, features, limits });
const PLANS: Partial<Record<PlanId, ReturnType<typeof plan>>> = { free: plan(['tool.measure', 'tool.grid'], { 'export.gif': 3 }), pro: plan() };
const sub = (status: SubscriptionDoc['status'], end: Date | null, planId: PlanId = 'pro') => ({ planId, status, currentPeriodEnd: end });

describe('subscriptionGrantsPlan', () => {
  it('follows the subscription lifecycle', () => {
    expect(subscriptionGrantsPlan(null, NOW)).toBe(false);
    expect(subscriptionGrantsPlan(sub('active', day(10)), NOW)).toBe(true);
    expect(subscriptionGrantsPlan(sub('trialing', day(5)), NOW)).toBe(true);
    // Renewal webhook late: a short grace period, then no plan.
    expect(subscriptionGrantsPlan(sub('active', day(-1)), NOW)).toBe(true);
    expect(subscriptionGrantsPlan(sub('active', day(-GRACE_DAYS - 1)), NOW)).toBe(false);
    // Failed payment: grace, then no plan.
    expect(subscriptionGrantsPlan(sub('past_due', day(-1)), NOW)).toBe(true);
    expect(subscriptionGrantsPlan(sub('past_due', day(-GRACE_DAYS - 1)), NOW)).toBe(false);
    // Cancelled: paid time is honoured to the day, no grace.
    expect(subscriptionGrantsPlan(sub('canceled', day(2)), NOW)).toBe(true);
    expect(subscriptionGrantsPlan(sub('canceled', day(-1)), NOW)).toBe(false);
    expect(subscriptionGrantsPlan(sub('incomplete', day(30)), NOW)).toBe(false);
    expect(subscriptionGrantsPlan(sub('expired', day(30)), NOW)).toBe(false);
  });
});

describe('computeEntitlements', () => {
  const active = { status: 'active' as const };

  it('gives nothing to visitors who are not signed in', () => {
    const e = computeEntitlements({ user: null, subscription: null, plans: PLANS, usage: {}, now: NOW });
    expect(e).toMatchObject({ authenticated: false, accountActive: false, features: [] });
    expect(canUse(e, 'tool.measure')).toBe(false);
  });

  it('gives nothing to suspended accounts, whatever they pay', () => {
    const e = computeEntitlements({ user: { status: 'suspended' }, subscription: sub('active', day(10)), plans: PLANS, usage: {}, now: NOW });
    expect(e).toMatchObject({ authenticated: true, accountActive: false, features: [] });
  });

  it('puts accounts without an active subscription on Free', () => {
    const e = computeEntitlements({ user: active, subscription: null, plans: PLANS, usage: {}, now: NOW });
    expect(e.planId).toBe('free');
    expect(canUse(e, 'tool.measure')).toBe(true);
    expect(canUse(e, 'tool.compare')).toBe(false);
  });

  it('gives Pro while the subscription is active, and Free again once it lapses', () => {
    expect(computeEntitlements({ user: active, subscription: sub('active', day(10)), plans: PLANS, usage: {}, now: NOW }).planId).toBe('pro');
    expect(computeEntitlements({ user: active, subscription: sub('canceled', day(-1)), plans: PLANS, usage: {}, now: NOW }).planId).toBe('free');
  });

  it('falls back to Free when the subscribed plan has been retired', () => {
    const plans = { ...PLANS, pro: { ...plan(), active: false } };
    expect(computeEntitlements({ user: active, subscription: sub('active', day(10)), plans, usage: {}, now: NOW }).planId).toBe('free');
  });

  it('enforces monthly limits and reports what is left', () => {
    const e = (used: number) => computeEntitlements({ user: active, subscription: null, plans: { free: plan([...FEATURES], { 'export.gif': 3 }) }, usage: { 'export.gif': used }, now: NOW });
    expect(remaining(e(1), 'export.gif')).toBe(2);
    expect(canUse(e(2), 'export.gif')).toBe(true);
    expect(canUse(e(3), 'export.gif')).toBe(false);
    expect(remaining(e(5), 'export.gif')).toBe(0);
    expect(remaining(e(5), 'tool.grid')).toBeNull(); // unlimited
  });
});

describe('getEntitlements (from the database only)', () => {
  let mongo: TestMongo;

  beforeAll(async () => {
    mongo = await startTestMongo();
    await migrate(mongo.db);
  }, MONGO_STARTUP_TIMEOUT);
  beforeEach(() => clearPlanCache());
  afterAll(async () => mongo?.stop());

  async function newUser(extra: Record<string, unknown> = {}) {
    const _id = new ObjectId();
    await mongo.db.collection('users').insertOne({ _id, name: 'T', email: `${_id}@t.test`, emailVerified: true, createdAt: NOW, updatedAt: NOW, role: 'user', status: 'active', marketingConsent: false, ...extra });
    return _id;
  }

  it('gives a new account the Free plan with every current tool', async () => {
    const e = await getEntitlements(mongo.db, await newUser(), NOW);
    expect(e).toMatchObject({ authenticated: true, accountActive: true, planId: 'free', subscriptionActive: false });
    expect(e.features).toEqual([...FEATURES]);
  });

  it('ignores plan or payment claims stored anywhere but a server-written subscription', async () => {
    // As if a client had smuggled these fields into the user document.
    const userId = await newUser({ plan: 'pro', planId: 'pro', subscriptionStatus: 'active', isPro: true });
    expect((await getEntitlements(mongo.db, userId, NOW)).planId).toBe('free');
  });

  it('reflects subscription changes written by the server', async () => {
    const userId = await newUser();
    const { subscriptions } = collections(mongo.db);
    const base = { userId, provider: 'test', providerCustomerId: 'c', providerSubscriptionId: `s_${userId}`, currentPeriodStart: NOW, cancelAtPeriodEnd: false, canceledAt: null, createdAt: NOW };
    await subscriptions.insertOne({ ...base, planId: 'pro', status: 'active', currentPeriodEnd: day(30), updatedAt: NOW });
    expect((await getEntitlements(mongo.db, userId, NOW)).planId).toBe('pro');

    await subscriptions.updateOne({ userId }, { $set: { status: 'expired', updatedAt: day(1) } });
    expect((await getEntitlements(mongo.db, userId, NOW)).planId).toBe('free');
  });

  it('counts real usage against limits', async () => {
    const userId = await newUser();
    await collections(mongo.db).plans.updateOne({ _id: 'free' }, { $set: { limits: { 'export.gif': 2 } } });
    clearPlanCache();
    await recordUsage(mongo.db, userId, 'export.gif', 2);
    const e = await getEntitlements(mongo.db, userId);
    expect(canUse(e, 'export.gif')).toBe(false);
    await collections(mongo.db).plans.updateOne({ _id: 'free' }, { $set: { limits: {} } });
  });

  it('gives nothing to an account that does not exist', async () => {
    const e = await getEntitlements(mongo.db, new ObjectId(), NOW);
    expect(e).toMatchObject({ authenticated: false, accountActive: false, features: [] });
  });
});
