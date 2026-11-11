// @vitest-environment node
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ObjectId } from 'mongodb';
import { MONGO_STARTUP_TIMEOUT, startTestMongo, type TestMongo } from '@/test/mongo';
import { FEATURES, collections, type PlanDoc, type PlanId, type SubscriptionDoc } from '@/server/db/collections';
import { migrate } from '@/server/db/migrate';
import { recordUsage } from '@/server/usage';
import { PLAN_FEATURES } from '@/lib/plans';
import { authorizeFeatureUse, canUse, clearPlanCache, computeEntitlements, getEntitlements, remaining, subscriptionGrantsPlan, GRACE_DAYS } from './entitlements';
import { getUsage } from '@/server/usage';

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

  it('gives administrators every feature, whatever their plan or subscription', () => {
    for (const subscription of [null, sub('expired', day(-30))]) {
      const e = computeEntitlements({ user: { status: 'active', role: 'admin', plan: 'free' }, subscription, plans: PLANS, usage: {}, now: NOW });
      expect(e).toMatchObject({ access: 'admin', role: 'admin', accountActive: true, planId: 'free' });
      expect(e.features).toEqual([...FEATURES]);
      expect(e.limits).toEqual({});
    }
    // …but a suspended admin gets nothing.
    const suspended = computeEntitlements({ user: { status: 'suspended', role: 'admin' }, subscription: null, plans: PLANS, usage: {}, now: NOW });
    expect(suspended).toMatchObject({ access: 'none', features: [] });
  });

  it('honours a plan assigned by an administrator, without any subscription', () => {
    const e = computeEntitlements({ user: { status: 'active', plan: 'pro' }, subscription: null, plans: PLANS, usage: {}, now: NOW });
    expect(e).toMatchObject({ assignedPlan: 'pro', planId: 'pro', access: 'pro', subscriptionActive: false, subscriptionStatus: null });
    expect(canUse(e, 'tool.compare')).toBe(true);
  });

  it('uses the better of the assigned plan and an active subscription', () => {
    const subscribed = computeEntitlements({ user: { status: 'active', plan: 'free' }, subscription: sub('active', day(10)), plans: PLANS, usage: {}, now: NOW });
    expect(subscribed).toMatchObject({ assignedPlan: 'free', planId: 'pro', subscriptionActive: true });
    const lapsed = computeEntitlements({ user: { status: 'active', plan: 'pro' }, subscription: sub('expired', day(-1)), plans: PLANS, usage: {}, now: NOW });
    expect(lapsed.planId).toBe('pro');
  });

  it('never makes anyone an admin through a plan, and ignores unknown plan or role values', () => {
    const e = computeEntitlements({ user: { status: 'active', plan: 'pro', role: 'superuser' }, subscription: sub('active', day(10)), plans: PLANS, usage: {}, now: NOW });
    expect(e).toMatchObject({ role: 'user', access: 'pro' });
    const odd = computeEntitlements({ user: { status: 'active', plan: 'enterprise' }, subscription: null, plans: PLANS, usage: {}, now: NOW });
    expect(odd).toMatchObject({ assignedPlan: 'free', planId: 'free' });
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

  it('gives a new account the Free plan with every tool, and Pro features only on Pro', async () => {
    const e = await getEntitlements(mongo.db, await newUser({ plan: 'free' }), NOW);
    expect(e).toMatchObject({ authenticated: true, accountActive: true, access: 'free', planId: 'free', subscriptionActive: false });
    expect(e.features).toEqual(PLAN_FEATURES.free);
    for (const tool of ['tool.measure', 'tool.study', 'tool.color', 'tool.grid', 'tool.compare'] as const) expect(canUse(e, tool)).toBe(true);
    expect(canUse(e, 'export.gif_large')).toBe(false);
    const pro = await getEntitlements(mongo.db, await newUser({ plan: 'pro' }), NOW);
    expect(pro.features).toEqual(PLAN_FEATURES.pro);
  });

  it('ignores plan or payment claims stored anywhere but the server-owned fields', async () => {
    // As if these had been smuggled into the user document; only `plan` (written
    // by admins through the server) and server-written subscriptions count.
    const userId = await newUser({ planId: 'pro', subscriptionStatus: 'active', isPro: true, plan: 'PRO' });
    expect(await getEntitlements(mongo.db, userId, NOW)).toMatchObject({ planId: 'free', role: 'user' });
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

  it('authorizes a feature use on the server and counts it, refusing what the plan lacks', async () => {
    const free = await newUser({ plan: 'free' });
    expect(await authorizeFeatureUse(mongo.db, free, ['export.gif'], NOW)).toEqual({ status: 'recorded' });
    expect(await authorizeFeatureUse(mongo.db, free, ['export.gif', 'export.gif_large'], NOW)).toEqual({ status: 'denied', reason: 'not_included', missing: ['export.gif_large'] });
    expect(await getUsage(mongo.db, free, '2026-11')).toEqual({ 'export.gif': 1 });

    const admin = await newUser({ role: 'admin', plan: 'free' });
    expect(await authorizeFeatureUse(mongo.db, admin, ['export.gif', 'export.gif_difference'], NOW)).toEqual({ status: 'recorded' });
    const suspended = await newUser({ status: 'suspended', plan: 'pro' });
    expect((await authorizeFeatureUse(mongo.db, suspended, ['export.gif'], NOW)).status).toBe('denied');
    expect((await authorizeFeatureUse(mongo.db, new ObjectId(), ['export.gif'], NOW)).status).toBe('denied');
  });

  it('gives nothing to an account that does not exist', async () => {
    const e = await getEntitlements(mongo.db, new ObjectId(), NOW);
    expect(e).toMatchObject({ authenticated: false, accountActive: false, features: [] });
  });
});
