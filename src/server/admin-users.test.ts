// @vitest-environment node
import { GRACE_DAYS } from '@/server/entitlements';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ObjectId, type Db } from 'mongodb';
import { MONGO_STARTUP_TIMEOUT, startTestMongo, type TestMongo } from '@/test/mongo';
import { migrate } from '@/server/db/migrate';
import { collections } from '@/server/db/collections';
import { accessSourcesOf, getUserDetail, listAuditEvents, listUsers, mayChangeRoles, ownerProtection, setOwner, setTestAccount, setUserPlan, setUserRole, setUserStatus, userStats } from './admin';
import type { SubscriptionStatus } from '@/server/db/collections';
import { computeEntitlements, getEntitlements } from './entitlements';
import { MAX_GRANT_DAYS, activeGrant, createGrant, extendGrant, revokeGrant } from './grants';
import { PLAN_FEATURES } from '@/lib/plans';

// Commercial admin operations against a real database: manual Pro (for a
// time: given, extended, ended, expiring; with no end date: the assigned
// plan), its isolation from billing, nobody changing their own access, where
// access comes from, suspension, test accounts, list filters and the audit
// filters.

let mongo: TestMongo;
let db: Db;

beforeAll(async () => {
  mongo = await startTestMongo();
  db = mongo.db;
  await migrate(db);
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

    for (const bad of [{ days: 0 }, { days: 400 }, { days: 2.5 }, { reason: 'because' }, { planId: 'gold' }, { planId: 'free' }]) {
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

/** One grant, or the test fails here. */
async function given(input: Parameters<typeof createGrant>[1], now?: Date) {
  const result = await createGrant(db, input, now);
  if (result.status !== 'created') throw new Error(`grant not created: ${result.status}`);
  return result;
}

describe('manual Pro for a time: extending, expiry and ending', () => {
  it('extends from its current end, not from today, audited, and the account is Pro exactly until the new end', async () => {
    const person = await seedUser();
    const now = new Date();
    const grant = await given({ userId: person, planId: 'pro', days: 30, reason: 'trial', actor: 'admin:abc' }, now);
    const tenDaysIn = new Date(now.getTime() + 10 * DAY);
    expect(await extendGrant(db, { userId: person, grantId: grant.grantId, days: 30, actor: 'admin:abc' }, tenDaysIn)).toEqual({ status: 'extended', endsAt: new Date(now.getTime() + 60 * DAY) });

    expect(await collections(db).accessGrants.findOne({ userId: person })).toMatchObject({ startsAt: now, endsAt: new Date(now.getTime() + 60 * DAY), extendedAt: tenDaysIn, extendedBy: 'admin:abc', revokedAt: null });
    expect(await collections(db).auditEvents.findOne({ userId: person, type: 'admin.grant_extended' })).toMatchObject({
      actor: 'admin:abc',
      metadata: { grantId: grant.grantId, planId: 'pro', days: 30, from: new Date(now.getTime() + 30 * DAY).toISOString(), to: new Date(now.getTime() + 60 * DAY).toISOString() },
    });
    expect((await getEntitlements(db, person, new Date(now.getTime() + 60 * DAY - 1))).planId).toBe('pro');
    expect((await getEntitlements(db, person, new Date(now.getTime() + 60 * DAY))).planId).toBe('free');
    // The assigned plan is untouched.
    expect((await collections(db).users.findOne({ _id: person }))!.plan).toBe('free');
  });

  it('never ends more than a year from today, also after an extension, and older 14- and 365-day grants keep working', async () => {
    const person = await seedUser();
    const now = new Date();
    // Lengths the dashboard used to offer, still valid on the server.
    const year = await given({ userId: person, planId: 'pro', days: 365, reason: 'promotion', actor: 'admin:abc' }, now);
    const fortnight = await given({ userId: person, planId: 'pro', days: 14, reason: 'support', actor: 'admin:abc' }, now);
    expect(await extendGrant(db, { userId: person, grantId: year.grantId, days: 7, actor: 'admin:abc' }, now)).toEqual({
      status: 'too_long',
      latest: new Date(now.getTime() + MAX_GRANT_DAYS * DAY),
    });
    expect((await collections(db).accessGrants.findOne({ _id: new ObjectId(year.grantId) }))!.endsAt).toEqual(year.endsAt);
    expect((await extendGrant(db, { userId: person, grantId: year.grantId, days: 1, actor: 'admin:abc' }, now)).status).toBe('extended');
    expect(await extendGrant(db, { userId: person, grantId: fortnight.grantId, days: 90, actor: 'admin:abc' }, now)).toEqual({ status: 'extended', endsAt: new Date(now.getTime() + 104 * DAY) });
    expect(await collections(db).auditEvents.countDocuments({ userId: person, type: 'admin.grant_extended' })).toBe(2);
    const detail = await getUserDetail(db, person, now);
    expect(detail!.grants.map((g) => [g.live, g.extendedAt !== null])).toEqual([
      [true, true],
      [true, true],
    ]);
  });

  it("never extends access that has ended, was ended early or is someone else's, nor by days that are not whole", async () => {
    const person = await seedUser();
    const other = await seedUser();
    const ended = await given({ userId: person, planId: 'pro', days: 30, reason: 'trial', actor: 'admin:abc' }, new Date(Date.now() - 40 * DAY));
    const endedEarly = await given({ userId: person, planId: 'pro', days: 30, reason: 'trial', actor: 'admin:abc' });
    expect(await revokeGrant(db, { userId: person, grantId: endedEarly.grantId, actor: 'admin:abc' })).toBe('revoked');
    const theirs = await given({ userId: other, planId: 'pro', days: 30, reason: 'trial', actor: 'admin:abc' });
    for (const grantId of [ended.grantId, endedEarly.grantId, theirs.grantId, 'not-an-id', new ObjectId().toHexString()]) {
      expect(await extendGrant(db, { userId: person, grantId, days: 30, actor: 'admin:abc' })).toEqual({ status: 'not_found' });
    }
    for (const days of [0, -7, 2.5, 400, Number.NaN]) {
      expect(await extendGrant(db, { userId: other, grantId: theirs.grantId, days, actor: 'admin:abc' })).toEqual({ status: 'invalid' });
    }
    expect(await collections(db).auditEvents.countDocuments({ userId: { $in: [person, other] }, type: 'admin.grant_extended' })).toBe(0);
    expect((await activeGrant(db, other))?.endsAt).toEqual(theirs.endsAt);
  });

  it('ends on its own: the list, its filter and the account page stop showing it the moment it ends', async () => {
    const person = await seedUser();
    const search = person.toHexString();
    const now = new Date();
    await given({ userId: person, planId: 'pro', days: 7, reason: 'trial', actor: 'admin:abc' }, now);
    const during = new Date(now.getTime() + 7 * DAY - 1);
    const after = new Date(now.getTime() + 7 * DAY);
    const row = async (at: Date) => (await listUsers(db, { search }, at)).rows[0];
    expect(await row(during)).toMatchObject({ effectivePlan: 'pro', sources: [{ kind: 'given', until: new Date(now.getTime() + 7 * DAY), reason: 'trial' }] });
    expect(await row(after)).toMatchObject({ effectivePlan: 'free', sources: [], grant: null });
    expect((await listUsers(db, { search, given: true }, during)).total).toBe(1);
    expect((await listUsers(db, { search, given: true }, after)).total).toBe(0);
    expect((await listUsers(db, { search, given: false }, after)).total).toBe(1);
    const detail = await getUserDetail(db, person, after);
    expect(detail!.grants[0]).toMatchObject({ live: false, revokedAt: null });
    expect(detail!.sources).toEqual([]);
    expect(detail!.entitlements.planId).toBe('free');
  });

  it('ending one manual Pro leaves the others, Pro with no end date and the rest exactly as they were', async () => {
    const person = await seedUser({ plan: 'pro' });
    const first = await given({ userId: person, planId: 'pro', days: 30, reason: 'trial', actor: 'admin:abc' });
    const second = await given({ userId: person, planId: 'pro', days: 90, reason: 'support', actor: 'admin:abc' });
    expect(await revokeGrant(db, { userId: person, grantId: first.grantId, actor: 'admin:abc' })).toBe('revoked');
    expect((await activeGrant(db, person))?.endsAt).toEqual(second.endsAt);
    expect((await collections(db).users.findOne({ _id: person }))!.plan).toBe('pro');

    // Ending Pro with no end date (the assigned plan) leaves the grant still in force.
    expect(await setUserPlan(db, { userId: person, plan: 'free', actor: 'admin:abc' })).toEqual({ status: 'updated', from: 'pro', to: 'free' });
    expect((await getEntitlements(db, person)).planId).toBe('pro');
    expect((await getUserDetail(db, person))!.sources).toEqual([{ kind: 'given', until: second.endsAt, reason: 'support' }]);
    expect(await collections(db).accessGrants.countDocuments({ userId: person, revokedAt: null })).toBe(1);
  });
});

describe('manual Pro and billing', () => {
  async function seedBilling(userId: ObjectId, status: SubscriptionStatus, periodEndsInDays: number) {
    const now = new Date();
    await collections(db).subscriptions.insertOne({
      userId, planId: 'pro', provider: 'test', providerCustomerId: `cus_${userId}`, providerSubscriptionId: `sub_${userId}`, status,
      currentPeriodStart: new Date(now.getTime() - 10 * DAY), currentPeriodEnd: new Date(now.getTime() + periodEndsInDays * DAY),
      cancelAtPeriodEnd: status === 'canceled', canceledAt: status === 'canceled' ? now : null, createdAt: now, updatedAt: now,
      interval: 'month', currency: 'USD', amountMinor: 990,
    });
    await collections(db).payments.insertOne({
      provider: 'test', providerPaymentId: `pay_${userId}`, userId, providerSubscriptionId: `sub_${userId}`, kind: 'charge', status: 'succeeded',
      amountMinor: 990, currency: 'USD', occurredAt: new Date(now.getTime() - 10 * DAY), receiptUrl: 'https://example.com/receipt', createdAt: now,
    });
    await collections(db).billingCustomers.insertOne({ userId, provider: 'test', providerCustomerId: `cus_${userId}`, createdAt: now });
  }
  const billingOf = async (userId: ObjectId) => ({
    subscriptions: await collections(db).subscriptions.find({ userId }).toArray(),
    payments: await collections(db).payments.find({ userId }).toArray(),
    customers: await collections(db).billingCustomers.find({ userId }).toArray(),
    providerEvents: await collections(db).paymentEvents.countDocuments(),
  });

  it('giving, extending and ending Pro, for a time or with no end date, never touches subscriptions, payments or customers', async () => {
    const person = await seedUser();
    await seedBilling(person, 'active', 20);
    const before = await billingOf(person);

    const grant = await given({ userId: person, planId: 'pro', days: 30, reason: 'support', actor: 'admin:abc' });
    expect((await extendGrant(db, { userId: person, grantId: grant.grantId, days: 30, actor: 'admin:abc' })).status).toBe('extended');
    expect((await setUserPlan(db, { userId: person, plan: 'pro', reason: 'support', actor: 'admin:abc' })).status).toBe('updated');
    expect(await revokeGrant(db, { userId: person, grantId: grant.grantId, actor: 'admin:abc' })).toBe('revoked');
    expect((await setUserPlan(db, { userId: person, plan: 'free', actor: 'admin:abc' })).status).toBe('updated');
    expect(await billingOf(person)).toEqual(before);

    // The paid subscription still gives Pro on its own, and is named as the reason.
    expect((await getEntitlements(db, person)).planId).toBe('pro');
    const detail = await getUserDetail(db, person);
    expect(detail!.sources).toEqual([{ kind: 'paid', status: 'active', periodEnd: before.subscriptions[0].currentPeriodEnd, cancelAtPeriodEnd: false }]);
    expect(detail!.subscription).toMatchObject({ status: 'active', planId: 'pro', provider: 'test', interval: 'month', amountMinor: 990, currency: 'USD', cancelAtPeriodEnd: false });
    expect(detail!.payments).toEqual([expect.objectContaining({ kind: 'charge', status: 'succeeded', amountMinor: 990, currency: 'USD', receiptUrl: 'https://example.com/receipt' })]);
    expect(await collections(db).auditEvents.findOne({ userId: person, type: 'admin.plan_changed', 'metadata.to': 'pro' })).toMatchObject({ metadata: { from: 'free', to: 'pro', reason: 'support' } });
  });

  it('keeps a lapsed subscription as billing reported it while manual Pro decides access, and ending manual Pro leaves Free', async () => {
    const person = await seedUser();
    await seedBilling(person, 'canceled', -2);
    const before = await billingOf(person);
    expect((await getEntitlements(db, person)).planId).toBe('free');

    const grant = await given({ userId: person, planId: 'pro', days: 7, reason: 'support', actor: 'admin:abc' });
    expect((await getEntitlements(db, person)).planId).toBe('pro');
    expect((await listUsers(db, { search: person.toHexString() })).rows[0]).toMatchObject({ effectivePlan: 'pro', subscriptionStatus: 'canceled', sources: [{ kind: 'given' }] });

    expect(await revokeGrant(db, { userId: person, grantId: grant.grantId, actor: 'admin:abc' })).toBe('revoked');
    expect((await getEntitlements(db, person)).planId).toBe('free');
    expect((await getUserDetail(db, person))!.subscription).toMatchObject({ status: 'canceled' });
    expect(await billingOf(person)).toEqual(before);
  });
});

describe('changing your own access', () => {
  it('is refused for giving, extending and ending Pro and for the assigned plan, and nothing is written', async () => {
    const admin = await seedUser({ role: 'admin' });
    const actor = `admin:${admin.toHexString()}`;
    // Pro on the admin's own account, given from the server command line.
    const fromCli = await given({ userId: admin, planId: 'pro', days: 30, reason: 'test', actor: 'cli' });
    const auditBefore = await collections(db).auditEvents.countDocuments({ userId: admin });

    expect(await createGrant(db, { userId: admin, planId: 'pro', days: 30, reason: 'promotion', actor, actorUserId: admin })).toEqual({ status: 'self' });
    expect(await extendGrant(db, { userId: admin, grantId: fromCli.grantId, days: 30, actor, actorUserId: admin })).toEqual({ status: 'self' });
    expect(await revokeGrant(db, { userId: admin, grantId: fromCli.grantId, actor, actorUserId: admin })).toBe('self');
    expect(await setUserPlan(db, { userId: admin, plan: 'pro', actor, actorUserId: admin })).toEqual({ status: 'self' });

    expect(await collections(db).accessGrants.find({ userId: admin }).toArray()).toEqual([expect.objectContaining({ endsAt: fromCli.endsAt, revokedAt: null })]);
    expect((await collections(db).users.findOne({ _id: admin }))!.plan).toBe('free');
    expect(await collections(db).auditEvents.countDocuments({ userId: admin })).toBe(auditBefore);

    // Another admin, or the server command line, still can.
    const other = await seedUser({ role: 'admin' });
    expect((await createGrant(db, { userId: admin, planId: 'pro', days: 7, reason: 'test', actor: `admin:${other.toHexString()}`, actorUserId: other })).status).toBe('created');
    expect((await setUserPlan(db, { userId: admin, plan: 'pro', actor: 'cli' })).status).toBe('updated');
  });
});

describe('where access comes from', () => {
  it('names every source that gives Pro right now, in order, and nothing else', () => {
    const now = new Date('2026-11-22T12:00:00Z');
    const soon = new Date(now.getTime() + 3 * DAY);
    const sub = (status: SubscriptionStatus, currentPeriodEnd: Date, cancelAtPeriodEnd = false) => ({ planId: 'pro' as const, status, currentPeriodEnd, cancelAtPeriodEnd });

    expect(accessSourcesOf({ role: 'user', plan: 'free', subscription: null, grants: [] }, now)).toEqual([]);
    expect(
      accessSourcesOf({ role: 'admin', plan: 'pro', subscription: sub('active', soon), grants: [{ planId: 'pro', endsAt: soon, reason: 'trial' }] }, now).map((s) => s.kind),
    ).toEqual(['admin', 'paid', 'given', 'assigned']);
    // A cancelled subscription gives Pro until its period ends; past due only within the grace days; expired never.
    expect(accessSourcesOf({ subscription: sub('canceled', soon, true), grants: [] }, now)).toEqual([{ kind: 'paid', status: 'canceled', periodEnd: soon, cancelAtPeriodEnd: true }]);
    expect(accessSourcesOf({ subscription: sub('canceled', new Date(now.getTime() - 1)), grants: [] }, now)).toEqual([]);
    expect(accessSourcesOf({ subscription: sub('past_due', new Date(now.getTime() - DAY)), grants: [] }, now).map((s) => s.kind)).toEqual(['paid']);
    expect(accessSourcesOf({ subscription: sub('past_due', new Date(now.getTime() - (GRACE_DAYS + 1) * DAY)), grants: [] }, now)).toEqual([]);
    expect(accessSourcesOf({ subscription: sub('expired', soon), grants: [] }, now)).toEqual([]);
    // Ended grants and anything that is not Pro are not sources; an unknown plan counts as Free.
    expect(accessSourcesOf({ plan: 'gold', subscription: { ...sub('active', soon), planId: 'free' }, grants: [{ planId: 'pro', endsAt: now }, { planId: 'free', endsAt: soon }] }, now)).toEqual([]);
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

describe('the owner', () => {
  // Owners are rare and unique: each test leaves nobody marked as the owner.
  const clearOwner = () => collections(db).users.updateMany({ owner: true }, { $unset: { owner: '' } });

  it('is set only for an active admin with a Google sign-in, moves on request, and is never two accounts', async () => {
    await clearOwner();
    const first = await seedUser({ role: 'admin' });
    const second = await seedUser({ role: 'admin' });
    const member = await seedUser();
    const suspended = await seedUser({ role: 'admin', status: 'suspended' });
    const tester = await seedUser({ role: 'admin', username: `owner_${new ObjectId().toHexString().slice(-6)}` }, ['credential']);

    expect(await setOwner(db, new ObjectId())).toEqual({ status: 'not_found' });
    expect(await setOwner(db, member)).toEqual({ status: 'not_admin' });
    expect(await setOwner(db, suspended)).toEqual({ status: 'not_admin' });
    expect(await setOwner(db, tester)).toEqual({ status: 'username_account' });

    expect(await setOwner(db, first)).toEqual({ status: 'set', previous: null });
    expect(await setOwner(db, first)).toEqual({ status: 'unchanged' });
    const moved = await setOwner(db, second);
    expect(moved.status).toBe('set');
    expect(moved.status === 'set' && moved.previous?.equals(first)).toBe(true);
    expect(await collections(db).users.countDocuments({ owner: true })).toBe(1);
    expect((await collections(db).users.findOne({ _id: second }))?.owner).toBe(true);
    expect(await collections(db).auditEvents.findOne({ userId: second, type: 'admin.owner_set' })).toMatchObject({ actor: 'cli', metadata: { previous: first.toHexString() } });

    // Whatever races: the database refuses a second owner.
    await expect(collections(db).users.updateOne({ _id: first }, { $set: { owner: true } })).rejects.toMatchObject({ code: 11000 });
    await clearOwner();
  });

  it("keeps other admins away from the owner's account and from roles; while no owner is set, admins work as before", async () => {
    await clearOwner();
    const owner = await seedUser({ role: 'admin' });
    const helper = await seedUser({ role: 'admin' });
    const member = await seedUser();

    // Before the owner is set: any admin may change roles, and no account is protected.
    expect(await mayChangeRoles(db, helper)).toBe(true);
    expect(await ownerProtection(db, { actorUserId: helper, userId: owner })).toBeNull();

    await setOwner(db, owner);
    expect(await ownerProtection(db, { actorUserId: helper, userId: owner })).toBe('owner');
    expect(await ownerProtection(db, { actorUserId: owner, userId: owner })).toBeNull(); // their own rules (self) apply instead
    expect(await ownerProtection(db, { actorUserId: helper, userId: member })).toBeNull();
    expect(await mayChangeRoles(db, owner)).toBe(true);
    expect(await mayChangeRoles(db, helper)).toBe(false);

    // Lists and the account page say who the owner is.
    const rows = (await listUsers(db, { pageSize: 200 })).rows;
    expect(rows.find((r) => r.id === owner.toHexString())?.owner).toBe(true);
    expect(rows.find((r) => r.id === helper.toHexString())?.owner).toBe(false);
    expect((await getUserDetail(db, owner))?.owner).toBe(true);
    await clearOwner();
  });

  it('stops being the owner when the server command line removes their admin role, with their 2FA trust', async () => {
    await clearOwner();
    const owner = await seedUser({ role: 'admin' });
    await seedUser({ role: 'admin' }); // someone else stays admin
    await setOwner(db, owner);
    await collections(db).adminMfaSessions.insertOne({ _id: `s-${owner}`, userId: owner, method: 'totp', verifiedAt: new Date(), expiresAt: new Date(Date.now() + DAY) });
    await collections(db).adminTrustedDevices.insertOne({
      _id: new ObjectId(), userId: owner, tokenHash: owner.toHexString().padEnd(64, '0'), label: 'Chrome on macOS',
      createdAt: new Date(), verifiedAt: new Date(), lastUsedAt: new Date(), expiresAt: new Date(Date.now() + 30 * DAY),
    });

    expect(await setUserRole(db, { userId: owner, role: 'user', actor: 'cli' })).toBe('updated');
    const after = await collections(db).users.findOne({ _id: owner });
    expect(after).toMatchObject({ role: 'user' });
    expect(after?.owner).toBeUndefined();
    expect(await collections(db).adminMfaSessions.countDocuments({ userId: owner })).toBe(0);
    expect(await collections(db).adminTrustedDevices.countDocuments({ userId: owner })).toBe(0);
    await clearOwner();
  });

  it('shows when an account was last active: its last sign-in or its latest session renewal', async () => {
    const person = await seedUser({ lastLoginAt: new Date(Date.now() - 10 * DAY) });
    const renewed = new Date(Date.now() - 2 * DAY);
    await collections(db).sessions.insertOne({ _id: new ObjectId(), userId: person, token: `t-${person}`, expiresAt: new Date(Date.now() + 20 * DAY), createdAt: new Date(Date.now() - 10 * DAY), updatedAt: renewed } as never);
    const row = (await listUsers(db, { pageSize: 200 })).rows.find((r) => r.id === person.toHexString());
    expect(row?.lastActiveAt).toEqual(renewed);
    const quiet = await seedUser({ lastLoginAt: new Date(Date.now() - 3 * DAY) });
    expect((await listUsers(db, { pageSize: 200 })).rows.find((r) => r.id === quiet.toHexString())?.lastActiveAt).toEqual((await collections(db).users.findOne({ _id: quiet }))?.lastLoginAt);
  });
});

