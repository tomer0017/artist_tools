// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ObjectId, type Db } from 'mongodb';
import { MONGO_STARTUP_TIMEOUT, startTestMongo, type TestMongo } from '@/test/mongo';
import { PLAN_FEATURES } from '@/lib/plans';
import { formatMoney, toMinor } from '@/lib/money';
import { migrate } from '@/server/db/migrate';
import { collections } from '@/server/db/collections';
import { analyticsReport } from './analytics-report';
import { recordActiveDay, recordToolOpen } from './analytics';
import { catalogSpec, defaultCatalog, describeCatalogChanges } from './config/catalog';
import { pricingSpec } from './config/pricing';
import { discardDraft, getPublished, listVersions, publishDraft, publishedDocument, restoreAsDraft, saveDraft } from './config/versions';
import { checkCoupon, createCoupon, discountedAmount, setCouponStatus } from './coupons';
import { authorizeFeatureUse, clearPlanCache, getEntitlements } from './entitlements';

// Versioned configuration, quotas, prices, coupons and analytics against a
// real database.

let mongo: TestMongo;
let db: Db;
const DAY = 86_400_000;

beforeAll(async () => {
  mongo = await startTestMongo();
  db = mongo.db;
  await migrate(db);
  clearPlanCache();
}, MONGO_STARTUP_TIMEOUT);

afterAll(async () => mongo?.stop());

async function seedUser(overrides: Record<string, unknown> = {}) {
  const _id = new ObjectId();
  await collections(db).users.insertOne({
    _id, name: 'P', email: `${_id.toHexString()}@example.com`, emailVerified: true, createdAt: new Date(), updatedAt: new Date(),
    role: 'user', status: 'active', plan: 'free', marketingConsent: false, ...overrides,
  } as never);
  return _id;
}

describe('versioned configuration', () => {
  it('starts as the code defaults (version 1), so a deploy changes nothing', async () => {
    const catalog = await getPublished(db, catalogSpec);
    expect(catalog).toMatchObject({ version: 1, status: 'published', publishedBy: 'system' });
    expect(catalog!.document).toEqual(defaultCatalog());
    expect((await getPublished(db, pricingSpec))!.document).toEqual({ prices: [] });
    // A second migration seeds nothing more.
    expect((await migrate(db)).configSeeded).toBe(0);
  });

  it('validates drafts, publishes them (archiving the previous), and restores old versions', async () => {
    expect(await saveDraft(db, catalogSpec, { plans: { free: { features: ['nope'] } } }, 'admin:a')).toMatchObject({ status: 'invalid' });
    const next = defaultCatalog();
    next.plans.free.quotas['export.gif'] = { limit: 3, period: 'month' };
    expect(await saveDraft(db, catalogSpec, next, 'admin:a', 'Three GIFs a month on Free')).toEqual({ status: 'saved', version: 2 });
    // Saving again updates the same draft.
    expect(await saveDraft(db, catalogSpec, next, 'admin:a')).toEqual({ status: 'saved', version: 2 });
    expect(describeCatalogChanges(defaultCatalog(), next)).toEqual(['Free: GIFs unlimited → 3 per month']);

    expect(await publishDraft(db, catalogSpec, 'admin:a')).toEqual({ status: 'published', version: 2 });
    expect((await listVersions(db, 'catalog')).map((v) => [v.version, v.status])).toEqual([[2, 'published'], [1, 'archived']]);
    expect(await collections(db).plans.findOne({ _id: 'free' })).toMatchObject({ limits: { 'export.gif': 3 } });
    expect(await publishDraft(db, catalogSpec, 'admin:a')).toEqual({ status: 'no_draft' });

    // A later deploy keeps what the admin published.
    await migrate(db);
    expect(await collections(db).plans.findOne({ _id: 'free' })).toMatchObject({ limits: { 'export.gif': 3 } });

    // Going back is publishing version 1's content again (as version 3).
    expect(await restoreAsDraft(db, catalogSpec, 1, 'admin:a')).toEqual({ status: 'saved', version: 3 });
    await publishDraft(db, catalogSpec, 'admin:a');
    expect(await publishedDocument(db, catalogSpec)).toEqual(defaultCatalog());
    expect((await collections(db).plans.findOne({ _id: 'free' }))!.limits).toEqual({});
    expect(await restoreAsDraft(db, catalogSpec, 99, 'admin:a')).toEqual({ status: 'not_found' });

    const audit = await collections(db).auditEvents.find({ type: 'admin.config_published' }, { sort: { at: 1, _id: 1 } }).toArray();
    expect(audit.map((e) => e.metadata)).toEqual([
      { kind: 'catalog', version: 2, previous: 1 },
      { kind: 'catalog', version: 3, previous: 2 },
    ]);
  });

  it('can discard a draft, and switches features off for everyone but admins', async () => {
    const off = defaultCatalog();
    off.disabled = ['export.gif_difference'];
    await saveDraft(db, catalogSpec, off, 'admin:a');
    expect(await discardDraft(db, 'catalog', 'admin:a')).toBe(true);
    expect(await discardDraft(db, 'catalog', 'admin:a')).toBe(false);

    await saveDraft(db, catalogSpec, off, 'admin:a');
    await publishDraft(db, catalogSpec, 'admin:a');
    const pro = await seedUser({ plan: 'pro' });
    const admin = await seedUser({ role: 'admin' });
    expect((await getEntitlements(db, pro)).features).not.toContain('export.gif_difference');
    expect((await getEntitlements(db, admin)).features).toContain('export.gif_difference');
    // Back to the defaults for the following tests.
    await saveDraft(db, catalogSpec, defaultCatalog(), 'admin:a');
    await publishDraft(db, catalogSpec, 'admin:a');
    expect((await getEntitlements(db, pro)).features).toEqual(PLAN_FEATURES.pro);
  });
});

describe('quotas', () => {
  async function withFreeQuota(quota: { limit: number; period: 'day' | 'month' }) {
    const catalog = defaultCatalog();
    catalog.plans.free.quotas['export.gif'] = quota;
    await saveDraft(db, catalogSpec, catalog, 'admin:a');
    await publishDraft(db, catalogSpec, 'admin:a');
  }

  it('never lets simultaneous requests go over a monthly quota', async () => {
    await withFreeQuota({ limit: 5, period: 'month' });
    const person = await seedUser();
    const results = await Promise.all(Array.from({ length: 20 }, () => authorizeFeatureUse(db, person, ['export.gif'])));
    expect(results.filter((r) => r.status === 'recorded')).toHaveLength(5);
    expect(results.find((r) => r.status === 'denied')).toEqual({ status: 'denied', reason: 'limit_reached', missing: ['export.gif'] });
    expect((await getEntitlements(db, person)).usage['export.gif']).toBe(5);
  });

  it('counts daily quotas per UTC day, and gives a unit back when another feature of the request is refused', async () => {
    await withFreeQuota({ limit: 2, period: 'day' });
    const person = await seedUser();
    const monday = new Date('2026-11-16T09:00:00Z');
    expect((await authorizeFeatureUse(db, person, ['export.gif'], monday)).status).toBe('recorded');
    // Not included: refused before anything is counted.
    expect(await authorizeFeatureUse(db, person, ['export.gif', 'export.gif_large'], monday)).toMatchObject({ reason: 'not_included' });
    expect((await authorizeFeatureUse(db, person, ['export.gif'], monday)).status).toBe('recorded');
    expect((await authorizeFeatureUse(db, person, ['export.gif'], monday)).status).toBe('denied');
    // A new UTC day starts again.
    expect((await authorizeFeatureUse(db, person, ['export.gif'], new Date('2026-11-17T00:00:01Z'))).status).toBe('recorded');
    // Admins are never capped.
    const admin = await seedUser({ role: 'admin' });
    for (let i = 0; i < 4; i++) expect((await authorizeFeatureUse(db, admin, ['export.gif'], monday)).status).toBe('recorded');
    await saveDraft(db, catalogSpec, defaultCatalog(), 'admin:a');
    await publishDraft(db, catalogSpec, 'admin:a');
  });
});

describe('prices and money', () => {
  it('keeps exact minor units and refuses two active prices for the same slot', async () => {
    expect(toMinor('9.90', 'USD')).toBe(990);
    expect(toMinor('39', 'ILS')).toBe(3900);
    expect(toMinor('1,5', 'ILS')).toBe(150);
    expect(toMinor('9.999', 'USD')).toBeNull();
    expect(toMinor('-1', 'USD')).toBeNull();
    expect(formatMoney(990, 'USD')).toBe('$9.90');
    expect(formatMoney(3900, 'ILS')).toMatch(/39\.00/);

    const price = { id: 'pro-month-usd', planId: 'pro', interval: 'month', currency: 'USD', amountMinor: 990, trialDays: 7, active: true, providerRefs: {} };
    expect(await saveDraft(db, pricingSpec, { prices: [price, { ...price, id: 'pro-month-usd-2' }] }, 'admin:a')).toMatchObject({ status: 'invalid' });
    expect(await saveDraft(db, pricingSpec, { prices: [price, { ...price, id: 'pro-month-usd-2', active: false }] }, 'admin:a')).toMatchObject({ status: 'saved' });
    expect(await saveDraft(db, pricingSpec, { prices: [{ ...price, amountMinor: 9.9 }] }, 'admin:a')).toMatchObject({ status: 'invalid' });
    await discardDraft(db, 'pricing', 'admin:a');
  });
});

describe('coupons', () => {
  const base = { kind: 'percent', percentOff: 20, amountOffMinor: null, currency: null, appliesTo: ['pro:year'], startsAt: new Date(Date.now() - DAY), endsAt: null, maxRedemptions: 2, maxPerUser: 1, note: null };

  it('validates and stores coupons, upper-casing codes, never twice', async () => {
    expect(await createCoupon(db, { ...base, code: 'spring-art' }, 'admin:a')).toMatchObject({ status: 'created' });
    expect(await createCoupon(db, { ...base, code: 'SPRING-ART' }, 'admin:a')).toEqual({ status: 'duplicate' });
    expect(await createCoupon(db, { ...base, code: 'X' }, 'admin:a')).toMatchObject({ status: 'invalid' });
    expect(await createCoupon(db, { ...base, code: 'FIXED-NO-CURRENCY', kind: 'fixed', percentOff: null, amountOffMinor: 500 }, 'admin:a')).toMatchObject({ status: 'invalid' });
    expect(await createCoupon(db, { ...base, code: 'BACKWARDS', endsAt: new Date(Date.now() - 2 * DAY) }, 'admin:a')).toMatchObject({ status: 'invalid' });
  });

  it('checks eligibility, dates and limits for checkout, and computes the discount', async () => {
    const person = await seedUser();
    const use = { userId: person, target: 'pro:year', currency: 'USD' as const };
    const ok = await checkCoupon(db, ' spring-art ', use);
    expect(ok.ok).toBe(true);
    expect(await checkCoupon(db, 'NOPE', use)).toEqual({ ok: false, reason: 'unknown' });
    expect(await checkCoupon(db, 'SPRING-ART', { ...use, target: 'pro:month' })).toEqual({ ok: false, reason: 'not_eligible' });

    const coupon = (await collections(db).coupons.findOne({ code: 'SPRING-ART' }))!;
    await collections(db).couponRedemptions.insertOne({ couponId: coupon._id!, userId: person, subscriptionId: null, at: new Date() });
    expect(await checkCoupon(db, 'SPRING-ART', use)).toEqual({ ok: false, reason: 'already_used' });
    await collections(db).couponRedemptions.insertOne({ couponId: coupon._id!, userId: new ObjectId(), subscriptionId: null, at: new Date() });
    expect(await checkCoupon(db, 'SPRING-ART', { ...use, userId: new ObjectId() })).toEqual({ ok: false, reason: 'used_up' });

    expect(await setCouponStatus(db, coupon._id!, 'disabled', 'admin:a')).toBe(true);
    expect(await checkCoupon(db, 'SPRING-ART', use)).toEqual({ ok: false, reason: 'disabled' });
    expect(discountedAmount(9900, { kind: 'percent', percentOff: 20, amountOffMinor: null })).toBe(7920);
    expect(discountedAmount(500, { kind: 'fixed', percentOff: null, amountOffMinor: 900 })).toBe(0);
    expect(await collections(db).auditEvents.countDocuments({ type: { $in: ['admin.coupon_created', 'admin.coupon_status_changed'] } })).toBe(2);
  });
});

describe('analytics', () => {
  it('counts registrations, active accounts, tools and retention, leaving test accounts out', async () => {
    await collections(db).users.deleteMany({});
    await collections(db).analyticsEvents.deleteMany({});
    const now = new Date('2026-11-18T12:00:00Z');
    const lastWeek = new Date(now.getTime() - 7 * DAY);
    const a = await seedUser({ createdAt: lastWeek });
    const b = await seedUser({ createdAt: lastWeek, emailVerified: false });
    const tester = await seedUser({ createdAt: now, testAccount: true });
    for (const user of [a, b, tester]) await recordActiveDay(db, user, lastWeek);
    await recordActiveDay(db, a, now);
    await recordActiveDay(db, a, now); // the same day counts once
    await recordToolOpen(db, a, 'compare', now);
    await recordToolOpen(db, tester, 'compare', now);
    await recordToolOpen(db, b, 'measure', lastWeek);

    const r = await analyticsReport(db, now);
    expect(r.accounts).toMatchObject({ total: 2, verified: 1, testExcluded: 1, last30: 2 });
    expect(r.active).toMatchObject({ today: 1, last7: 1, last30: 2 });
    expect(r.registrations.at(-8)).toEqual({ day: '2026-11-11', value: 2 });
    expect(r.tools.find((t) => t.tool === 'compare')).toEqual({ tool: 'compare', users: 1, opens: 1 });
    expect(r.tools.find((t) => t.tool === 'measure')).toEqual({ tool: 'measure', users: 1, opens: 1 });
    // Last week's cohort (2 accounts): 1 came back the following week.
    const cohort = r.retention.find((c) => c.size === 2)!;
    expect(cohort.weeks[0]).toBe(50);
    expect(r.billing).toMatchObject({ live: false, mrrMinor: {}, arrMinor: {}, cancellations30: 0, churnRate30: null });
  });
});
