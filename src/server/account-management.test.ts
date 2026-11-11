// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ObjectId, type Db } from 'mongodb';
import { MONGO_STARTUP_TIMEOUT, startTestMongo, type TestMongo } from '@/test/mongo';
import { migrate } from '@/server/db/migrate';
import { collections } from '@/server/db/collections';
import { getAccountSummary } from './account';
import {
  cleanDisplayName,
  deleteAccount,
  exportAccountData,
  listDeviceSessions,
  revokeDeviceSession,
  revokeOtherSessions,
  setMarketingConsent,
  updateProfile,
} from './account-management';
import { monthsBefore, runMaintenance } from './maintenance';

// Self-service account management against a real database: every function
// acts on the caller's own account only, is audited, and never hands out
// tokens or secrets.

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
    name: 'Ada Artist',
    email: `${_id.toHexString()}@example.com`,
    emailVerified: true,
    image: 'https://example.com/ada.png',
    createdAt: now,
    updatedAt: now,
    role: 'user',
    status: 'active',
    plan: 'free',
    marketingConsent: false,
    locale: 'en',
    currency: 'USD',
    ...overrides,
  } as never);
  for (const providerId of methods) {
    await collections(db).accounts.insertOne({
      _id: new ObjectId(),
      userId: _id,
      providerId,
      accountId: providerId === 'credential' ? _id.toHexString() : `google-sub-${_id.toHexString()}`,
      ...(providerId === 'credential' ? { password: 'salt:hash-never-exported' } : {}),
      createdAt: now,
      updatedAt: now,
    });
  }
  return _id;
}

async function seedSession(userId: ObjectId, token: string, extra: Record<string, unknown> = {}) {
  const now = new Date();
  const _id = new ObjectId();
  await collections(db).sessions.insertOne({
    _id,
    userId,
    token,
    expiresAt: new Date(Date.now() + 7 * DAY),
    createdAt: now,
    updatedAt: now,
    ipAddress: '203.0.113.42',
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
    ...extra,
  });
  return _id;
}

describe('signed-in devices', () => {
  it('lists only the person’s own live sessions, without tokens, and marks this device', async () => {
    const me = await seedUser();
    const other = await seedUser();
    await seedSession(me, 'token-me-current');
    await seedSession(me, 'token-me-laptop', { userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36', ipAddress: '2001:db8:85a3::8a2e:370:7334' });
    await seedSession(me, 'token-me-expired', { expiresAt: new Date(Date.now() - DAY) });
    await seedSession(other, 'token-someone-else');

    const sessions = await listDeviceSessions(db, me, 'token-me-current');
    expect(sessions).toHaveLength(2);
    expect(sessions.find((s) => s.current)).toMatchObject({ device: 'Safari on iPhone', network: '203.0.113.x' });
    expect(sessions.find((s) => !s.current)).toMatchObject({ device: 'Chrome on Mac', network: '2001:db8:85a3:…' });
    expect(JSON.stringify(sessions)).not.toContain('token-');
  });

  it('signs out one other device, never this one and never someone else’s', async () => {
    const me = await seedUser();
    const other = await seedUser();
    await seedSession(me, 'mine-current');
    const laptop = await seedSession(me, 'mine-laptop');
    const theirs = await seedSession(other, 'theirs');

    expect(await revokeDeviceSession(db, me, theirs, 'mine-current')).toBe('not_found');
    expect(await collections(db).sessions.countDocuments({ _id: theirs })).toBe(1);
    const current = (await collections(db).sessions.findOne({ token: 'mine-current' }))!._id;
    expect(await revokeDeviceSession(db, me, current, 'mine-current')).toBe('current');
    expect(await revokeDeviceSession(db, me, laptop, 'mine-current')).toBe('revoked');
    expect(await collections(db).sessions.countDocuments({ userId: me })).toBe(1);
    expect(await collections(db).auditEvents.countDocuments({ userId: me, type: 'user.session_revoked' })).toBe(1);
  });

  it('signs out every other device at once', async () => {
    const me = await seedUser();
    await seedSession(me, 'keep-this');
    await seedSession(me, 'drop-1');
    await seedSession(me, 'drop-2');
    expect(await revokeOtherSessions(db, me, 'keep-this')).toBe(2);
    expect((await collections(db).sessions.find({ userId: me }).toArray()).map((s) => s.token)).toEqual(['keep-this']);
    expect(await collections(db).auditEvents.findOne({ userId: me, type: 'user.sessions_revoked' })).toMatchObject({ metadata: { count: 2 } });
  });
});

describe('profile and preferences', () => {
  it('cleans display names and refuses empty or overlong ones', () => {
    expect(cleanDisplayName('  Ada \n  Lovelace\u202e ')).toBe('Ada Lovelace');
    expect(cleanDisplayName('   ')).toBeNull();
    expect(cleanDisplayName('x'.repeat(81))).toBeNull();
    expect(cleanDisplayName('אדה לאבלייס')).toBe('אדה לאבלייס');
  });

  it('saves name, language, currency and photo removal, and audits field names only', async () => {
    const me = await seedUser();
    expect(await updateProfile(db, me, { name: 'Ada L.', locale: 'he', currency: 'ILS', removeImage: true })).toBe('updated');
    expect(await collections(db).users.findOne({ _id: me })).toMatchObject({ name: 'Ada L.', locale: 'he', currency: 'ILS', image: null });
    const event = await collections(db).auditEvents.findOne({ userId: me, type: 'user.profile_updated' });
    expect(event!.metadata).toEqual({ fields: 'name,locale,currency,image' });
    expect(await updateProfile(db, me, { name: 'Ada L.', locale: 'he' })).toBe('unchanged');
    expect(await updateProfile(db, me, { locale: 'fr' as never })).toBe('invalid');
    expect(await updateProfile(db, me, { name: '' })).toBe('invalid');
    expect(await updateProfile(db, new ObjectId(), { name: 'Nobody' })).toBe('not_found');
  });

  it('keeps marketing email off by default and records every change', async () => {
    const me = await seedUser();
    expect(await setMarketingConsent(db, me, false, 'profile')).toBe('unchanged');
    expect(await setMarketingConsent(db, me, true, 'profile')).toBe('updated');
    expect(await setMarketingConsent(db, me, true, 'profile')).toBe('unchanged');
    expect(await setMarketingConsent(db, me, false, 'profile')).toBe('updated');
    const history = await collections(db).consentEvents.find({ userId: me }, { sort: { at: 1 } }).toArray();
    expect(history.map((e) => [e.purpose, e.granted, e.source])).toEqual([
      ['marketing_email', true, 'profile'],
      ['marketing_email', false, 'profile'],
    ]);
    expect(await collections(db).users.findOne({ _id: me })).toMatchObject({ marketingConsent: false, marketingConsentSource: 'profile' });
  });

  it('tells the studio how the person signs in and what they chose', async () => {
    const both = await seedUser({ locale: 'he', currency: 'ILS', marketingConsent: true }, ['google', 'credential']);
    const summary = await getAccountSummary(db, both, { emailPasswordEnabled: true });
    expect(summary!.account).toMatchObject({
      locale: 'he',
      currency: 'ILS',
      marketingConsent: true,
      methods: { google: true, password: true },
      emailPasswordEnabled: true,
    });
    const legacy = await seedUser({ locale: undefined, currency: 'XYZ' });
    expect((await getAccountSummary(db, legacy))!.account).toMatchObject({ locale: 'en', currency: 'USD', methods: { google: true, password: false }, emailPasswordEnabled: false });
  });
});

describe('downloading your data', () => {
  it('includes the person’s own data and never tokens, password hashes or provider ids', async () => {
    const me = await seedUser({}, ['google', 'credential']);
    const other = await seedUser();
    await seedSession(me, 'secret-session-token');
    await seedSession(other, 'other-person-token');
    await setMarketingConsent(db, me, true, 'profile');
    await collections(db).usage.insertOne({ userId: me, feature: 'export.gif', period: '2026-11', quantity: 3, firstAt: new Date(), lastAt: new Date() });

    const data = (await exportAccountData(db, me))!;
    expect(data.account).toMatchObject({ id: me.toHexString(), name: 'Ada Artist', plan: 'free', language: 'en', currency: 'USD' });
    expect(data.signInMethods.map((m) => m.method).sort()).toEqual(['google', 'password']);
    expect(data.sessions).toHaveLength(1);
    expect(data.marketingEmail).toMatchObject({ consent: true });
    expect(data.marketingEmail.history).toHaveLength(1);
    expect(data.featureUsage).toEqual([{ feature: 'export.gif', month: '2026-11', count: 3 }]);
    expect(data.activity.some((e) => e.event === 'user.consent_changed')).toBe(true);

    const text = JSON.stringify(data);
    for (const secret of ['secret-session-token', 'hash-never-exported', `google-sub-${me.toHexString()}`, 'other-person-token', other.toHexString()]) {
      expect(text).not.toContain(secret);
    }
    expect(await exportAccountData(db, new ObjectId())).toBeNull();
  });
});

describe('deleting the account', () => {
  it('removes the person and their personal data, keeps a bare audit trail, and leaves others alone', async () => {
    const me = await seedUser({}, ['google', 'credential']);
    const other = await seedUser();
    await seedSession(me, 'deleting-session');
    await seedSession(other, 'unrelated-session');
    await setMarketingConsent(db, me, true, 'profile');
    await collections(db).usage.insertOne({ userId: me, feature: 'export.gif', period: '2026-11', quantity: 1, firstAt: new Date(), lastAt: new Date() });
    await collections(db).verifications.insertOne({ _id: new ObjectId(), identifier: 'hashed-reset', value: me.toHexString(), expiresAt: new Date(Date.now() + DAY) });
    await collections(db).analyticsEvents.insertOne({ name: 'login_succeeded', at: new Date(), userId: me, anonymousId: null, dedupeKey: null, campaign: null, props: {} });
    await collections(db).accessGrants.insertOne({ userId: me, planId: 'pro', startsAt: new Date(), endsAt: new Date(Date.now() + DAY), reason: 'promotion', grantedBy: 'cli', createdAt: new Date(), revokedAt: null, revokedBy: null });

    const result = await deleteAccount(db, me);
    expect(result).toMatchObject({ status: 'deleted', name: 'Ada Artist' });
    const c = collections(db);
    expect(await c.users.countDocuments({ _id: me })).toBe(0);
    for (const collection of [c.accounts, c.sessions, c.consentEvents, c.usage, c.analyticsEvents, c.accessGrants]) {
      expect(await (collection as typeof c.sessions).countDocuments({ userId: me })).toBe(0);
    }
    expect(await c.verifications.countDocuments({ value: me.toHexString() })).toBe(0);
    // The audit trail survives, with nothing but the id.
    const trail = await c.auditEvents.find({ userId: me }).toArray();
    expect(trail.map((e) => e.type)).toContain('account.deleted');
    expect(JSON.stringify(trail)).not.toContain('@example.com');
    // Someone else's account is untouched.
    expect(await c.users.countDocuments({ _id: other })).toBe(1);
    expect(await c.sessions.countDocuments({ userId: other })).toBe(1);
  });

  it('refuses the last administrator and an account with a running subscription', async () => {
    await collections(db).users.updateMany({ role: 'admin' }, { $set: { role: 'user' } });
    const admin = await seedUser({ role: 'admin' });
    expect(await deleteAccount(db, admin)).toEqual({ status: 'last_admin' });
    const second = await seedUser({ role: 'admin' });
    expect((await deleteAccount(db, admin)).status).toBe('deleted');
    expect(await deleteAccount(db, second)).toEqual({ status: 'last_admin' });

    const subscriber = await seedUser();
    await collections(db).subscriptions.insertOne({
      userId: subscriber, planId: 'pro', provider: 'mock', providerCustomerId: 'c', providerSubscriptionId: `s-${subscriber.toHexString()}`, status: 'active',
      currentPeriodStart: new Date(), currentPeriodEnd: new Date(Date.now() + 30 * DAY), cancelAtPeriodEnd: false, canceledAt: null, createdAt: new Date(), updatedAt: new Date(),
    });
    expect(await deleteAccount(db, subscriber)).toEqual({ status: 'active_subscription' });
    expect(await deleteAccount(db, new ObjectId())).toEqual({ status: 'not_found' });
  });
});

describe('nightly maintenance', () => {
  it('removes password sign-ups never confirmed within 24 hours, and nothing else', async () => {
    const old = new Date(Date.now() - 2 * DAY);
    const stale = await seedUser({ emailVerified: false, createdAt: old }, ['credential']);
    const recent = await seedUser({ emailVerified: false }, ['credential']);
    const verified = await seedUser({ createdAt: old }, ['credential']);
    const google = await seedUser({ emailVerified: false, createdAt: old }, ['google']);
    await collections(db).rateLimits.insertMany([
      { _id: new ObjectId(), key: 'idle', count: 3, lastRequest: Date.now() - 2 * DAY },
      { _id: new ObjectId(), key: 'busy', count: 3, lastRequest: Date.now() },
    ]);

    const report = await runMaintenance(db);
    expect(report.unverifiedRemoved).toBe(1);
    expect(report.rateLimitsPruned).toBe(1);
    const users = collections(db).users;
    expect(await users.countDocuments({ _id: stale })).toBe(0);
    expect(await collections(db).accounts.countDocuments({ userId: stale })).toBe(0);
    for (const kept of [recent, verified, google]) expect(await users.countDocuments({ _id: kept })).toBe(1);
    expect(await collections(db).auditEvents.findOne({ userId: stale, type: 'account.deleted' })).toMatchObject({ actor: 'system', metadata: { reason: 'never_verified' } });
    expect((await runMaintenance(db)).unverifiedRemoved).toBe(0);
  });

  it('deletes analytics events after 13 months and audit events after 24, and nothing newer', async () => {
    // Relative to now: the other tests' events (written just now) must survive.
    const now = new Date();
    const userId = new ObjectId();
    const around = (cutoff: Date) => [new Date(cutoff.getTime() - 1000), new Date(cutoff.getTime() + 1000)];
    const [analyticsOld, analyticsNew] = around(monthsBefore(now, 13));
    const [auditOld, auditNew] = around(monthsBefore(now, 24));
    await collections(db).analyticsEvents.insertMany(
      [analyticsOld, analyticsNew].map((at) => ({ name: 'active_day' as const, userId, anonymousId: null, dedupeKey: null, campaign: null, at, props: {} })),
    );
    await collections(db).auditEvents.insertMany(
      [auditOld, auditNew].map((at) => ({ type: 'user.login' as const, userId, actor: `user:${userId}`, at, metadata: {} })),
    );

    const report = await runMaintenance(db, now);
    expect(report).toMatchObject({ analyticsPruned: 1, auditPruned: 1 });
    expect((await collections(db).analyticsEvents.find({ userId }).toArray()).map((e) => e.at)).toEqual([analyticsNew]);
    expect((await collections(db).auditEvents.find({ userId }).toArray()).map((e) => e.at)).toEqual([auditNew]);
    // Calendar months, clamped to shorter months (not JavaScript's overflow into the next month).
    expect(monthsBefore(new Date('2026-03-31T08:00:00Z'), 1).toISOString()).toBe('2026-02-28T08:00:00.000Z');
    expect(monthsBefore(new Date('2028-03-31T08:00:00Z'), 13).toISOString()).toBe('2027-02-28T08:00:00.000Z');
    expect(monthsBefore(new Date('2028-02-29T08:00:00Z'), 24).toISOString()).toBe('2026-02-28T08:00:00.000Z');
  });
});
