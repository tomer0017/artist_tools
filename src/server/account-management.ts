import 'server-only';
import type { Db, ObjectId } from 'mongodb';
import { isCurrency, isLocale, type Currency, type Locale } from '@/lib/locale';
import { describeUserAgent, maskIp, parseUserAgent } from '@/lib/user-agent';
import { recordAudit } from '@/server/audit';
import { collections } from '@/server/db/collections';

// ─── Self-service account management ──────────────────────────────────────────
// What a signed-in person can do to their own account: see and end their
// sessions, edit their profile and preferences, choose marketing email,
// download their data and delete the account. Every function takes the
// caller's own user id, which the route or action took from the verified
// session — never from the request — and every change is audited (ids and
// field names only, never values).

export interface DeviceSession {
  id: string;
  current: boolean;
  /** "Safari on iPhone", in English; `browser` and `system` let the page word it in its language. */
  device: string;
  browser: string | null;
  system: string | null;
  /** Partly hidden, e.g. 203.0.113.x. */
  network: string | null;
  signedInAt: string;
  lastActiveAt: string;
}

/** The person's live sessions, newest activity first. Tokens never leave the server. */
export async function listDeviceSessions(db: Db, userId: ObjectId, currentToken: string, now = new Date()): Promise<DeviceSession[]> {
  const sessions = await collections(db)
    .sessions.find({ userId, expiresAt: { $gt: now } }, { sort: { updatedAt: -1 }, projection: { token: 1, userAgent: 1, ipAddress: 1, createdAt: 1, updatedAt: 1 } })
    .toArray();
  return sessions.map((s) => ({
    id: s._id.toHexString(),
    current: s.token === currentToken,
    device: describeUserAgent(s.userAgent),
    ...parseUserAgent(s.userAgent),
    network: maskIp(s.ipAddress),
    signedInAt: s.createdAt.toISOString(),
    lastActiveAt: (s.updatedAt ?? s.createdAt).toISOString(),
  }));
}

/** End one of the person's own sessions (not the one they are using: that is "Sign out"). */
export async function revokeDeviceSession(db: Db, userId: ObjectId, sessionId: ObjectId, currentToken: string): Promise<'revoked' | 'not_found' | 'current'> {
  const { sessions } = collections(db);
  const target = await sessions.findOne({ _id: sessionId, userId }, { projection: { token: 1 } });
  if (!target) return 'not_found';
  if (target.token === currentToken) return 'current';
  await sessions.deleteOne({ _id: sessionId, userId });
  await recordAudit(db, { type: 'user.session_revoked', userId, actor: `user:${userId}`, metadata: { sessionId: sessionId.toHexString() } });
  return 'revoked';
}

/** End every session but the current one; returns how many ended. */
export async function revokeOtherSessions(db: Db, userId: ObjectId, currentToken: string): Promise<number> {
  const { deletedCount } = await collections(db).sessions.deleteMany({ userId, token: { $ne: currentToken } });
  if (deletedCount > 0) await recordAudit(db, { type: 'user.sessions_revoked', userId, actor: `user:${userId}`, metadata: { count: deletedCount } });
  return deletedCount;
}

export interface ProfileChange {
  name?: string;
  locale?: Locale;
  currency?: Currency;
  /** Stop showing the profile photo (Google's picture); initials are shown instead. */
  removeImage?: boolean;
}

/** A display name: trimmed, inner whitespace collapsed, no control characters, 1–80 characters. */
export function cleanDisplayName(input: string): string | null {
  // Control characters, zero-width characters and bidirectional overrides, which could hide or reorder text.
  // eslint-disable-next-line no-control-regex
  const name = input.replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2066-\u2069]/g, '').replace(/\s+/g, ' ').trim();
  return name.length >= 1 && [...name].length <= 80 ? name : null;
}

export async function updateProfile(db: Db, userId: ObjectId, change: ProfileChange, now = new Date()): Promise<'updated' | 'unchanged' | 'invalid' | 'not_found'> {
  const { users } = collections(db);
  const user = await users.findOne({ _id: userId }, { projection: { name: 1, locale: 1, currency: 1, image: 1 } });
  if (!user) return 'not_found';
  const set: Record<string, unknown> = {};
  if (change.name !== undefined) {
    const name = cleanDisplayName(change.name);
    if (!name) return 'invalid';
    if (name !== user.name) set.name = name;
  }
  if (change.locale !== undefined) {
    if (!isLocale(change.locale)) return 'invalid';
    if (change.locale !== user.locale) set.locale = change.locale;
  }
  if (change.currency !== undefined) {
    if (!isCurrency(change.currency)) return 'invalid';
    if (change.currency !== user.currency) set.currency = change.currency;
  }
  if (change.removeImage && user.image) set.image = null;
  const fields = Object.keys(set);
  if (fields.length === 0) return 'unchanged';
  await users.updateOne({ _id: userId }, { $set: { ...set, updatedAt: now } });
  await recordAudit(db, { type: 'user.profile_updated', userId, actor: `user:${userId}`, metadata: { fields: fields.join(',') } });
  return 'updated';
}

/** Marketing email: off unless the person turns it on; each change is kept in `consent_events`. */
export async function setMarketingConsent(db: Db, userId: ObjectId, granted: boolean, source: string, now = new Date()): Promise<'updated' | 'unchanged' | 'not_found'> {
  const { users, consentEvents } = collections(db);
  const user = await users.findOne({ _id: userId }, { projection: { marketingConsent: 1 } });
  if (!user) return 'not_found';
  if ((user.marketingConsent === true) === granted) return 'unchanged';
  await users.updateOne({ _id: userId }, { $set: { marketingConsent: granted, marketingConsentAt: now, marketingConsentSource: source, updatedAt: now } });
  await consentEvents.insertOne({ userId, purpose: 'marketing_email', granted, source, at: now });
  await recordAudit(db, { type: 'user.consent_changed', userId, actor: `user:${userId}`, metadata: { purpose: 'marketing_email', granted } });
  return 'updated';
}

/** Which ways the person can sign in. */
export async function signInMethods(db: Db, userId: ObjectId) {
  const accounts = await collections(db).accounts.find({ userId }, { projection: { providerId: 1, createdAt: 1 } }).toArray();
  const google = accounts.find((a) => a.providerId === 'google');
  const password = accounts.find((a) => a.providerId === 'credential');
  return {
    google: google ? { connectedAt: google.createdAt.toISOString() } : null,
    password: password ? { setAt: password.createdAt.toISOString() } : null,
  };
}

const iso = (date: Date | null | undefined) => (date ? date.toISOString() : null);

/**
 * Everything the service keeps about the person, as one JSON document. Never
 * included: session tokens, password hashes, provider account ids, other
 * people's data. Artwork is not here because it never leaves the device.
 */
export async function exportAccountData(db: Db, userId: ObjectId, now = new Date()) {
  const c = collections(db);
  const user = await c.users.findOne({ _id: userId });
  if (!user) return null;
  const [accounts, sessions, consents, usage, subscriptions, audit, analytics] = await Promise.all([
    c.accounts.find({ userId }, { projection: { providerId: 1, createdAt: 1 } }).toArray(),
    c.sessions.find({ userId }, { projection: { userAgent: 1, ipAddress: 1, createdAt: 1, updatedAt: 1, expiresAt: 1 } }).toArray(),
    c.consentEvents.find({ userId }, { sort: { at: 1 } }).toArray(),
    c.usage.find({ userId }, { sort: { period: 1 } }).toArray(),
    c.subscriptions.find({ userId }).toArray(),
    c.auditEvents.find({ userId }, { sort: { at: 1 } }).toArray(),
    c.analyticsEvents.find({ userId }, { sort: { at: 1 } }).toArray(),
  ]);
  return {
    format: 'studio-companion-account-export',
    version: 1,
    generatedAt: now.toISOString(),
    note: 'Images you work on are kept only on your devices, so they are not part of this file.',
    account: {
      id: user._id.toHexString(),
      name: user.name,
      email: user.email,
      emailVerified: user.emailVerified === true,
      profileImage: user.image ?? null,
      createdAt: iso(user.createdAt),
      updatedAt: iso(user.updatedAt),
      lastLoginAt: iso(user.lastLoginAt),
      role: user.role ?? 'user',
      status: user.status ?? 'active',
      plan: user.plan ?? 'free',
      language: user.locale ?? null,
      currency: user.currency ?? null,
      toolIntroductionsSeen: user.introsSeen ?? [],
    },
    marketingEmail: {
      consent: user.marketingConsent === true,
      changedAt: iso(user.marketingConsentAt),
      history: consents.map((e) => ({ granted: e.granted, source: e.source, at: iso(e.at) })),
    },
    signInMethods: accounts.map((a) => ({ method: a.providerId === 'credential' ? 'password' : a.providerId, addedAt: iso(a.createdAt) })),
    sessions: sessions.map((s) => ({
      device: describeUserAgent(s.userAgent),
      userAgent: s.userAgent ?? null,
      ipAddress: s.ipAddress || null,
      signedInAt: iso(s.createdAt),
      lastActiveAt: iso(s.updatedAt),
      expiresAt: iso(s.expiresAt),
    })),
    subscriptions: subscriptions.map((s) => ({
      plan: s.planId,
      status: s.status,
      provider: s.provider,
      currentPeriodStart: iso(s.currentPeriodStart),
      currentPeriodEnd: iso(s.currentPeriodEnd),
      cancelAtPeriodEnd: s.cancelAtPeriodEnd,
    })),
    featureUsage: usage.map((u) => ({ feature: u.feature, month: u.period, count: u.quantity })),
    activity: audit.map((e) => ({ event: e.type, at: iso(e.at), by: e.actor.split(':')[0], details: e.metadata })),
    productEvents: analytics.map((e) => ({ event: e.name, at: iso(e.at), details: e.props })),
  };
}

export type DeletionResult =
  | { status: 'deleted'; email: string; name: string; locale: string | null }
  | { status: 'last_admin' }
  | { status: 'active_subscription' }
  | { status: 'not_found' };

/**
 * Delete the account and the personal data kept with it (ADR-0010). The audit
 * trail keeps the bare id (no name or email) plus an `account.deleted` entry,
 * so the security history survives without identifying anyone. Refused for
 * the last active administrator and while a paid subscription is running.
 */
export async function deleteAccount(db: Db, userId: ObjectId): Promise<DeletionResult> {
  const c = collections(db);
  const user = await c.users.findOne({ _id: userId }, { projection: { email: 1, name: 1, role: 1, locale: 1 } });
  if (!user) return { status: 'not_found' };
  if (user.role === 'admin' && (await c.users.countDocuments({ _id: { $ne: userId }, role: 'admin', status: { $ne: 'suspended' } })) === 0) {
    return { status: 'last_admin' };
  }
  // A paid plan is cancelled first (once billing exists); its records are kept for accounting.
  if ((await c.subscriptions.countDocuments({ userId, status: { $in: ['active', 'trialing', 'past_due'] } })) > 0) {
    return { status: 'active_subscription' };
  }
  await recordAudit(db, { type: 'account.deleted', userId, actor: `user:${userId}`, metadata: { role: user.role === 'admin' ? 'admin' : 'user' } });
  await removeUserData(db, userId, user.email);
  return { status: 'deleted', email: user.email, name: user.name, locale: user.locale ?? null };
}

/** Remove a user and everything personal kept with them; audit events keep only the bare id. */
export async function removeUserData(db: Db, userId: ObjectId, email: string): Promise<void> {
  const c = collections(db);
  await Promise.all([
    c.sessions.deleteMany({ userId }),
    c.accounts.deleteMany({ userId }),
    c.verifications.deleteMany({ value: userId.toHexString() }),
    c.consentEvents.deleteMany({ userId }),
    c.usage.deleteMany({ userId }),
    c.analyticsEvents.deleteMany({ userId }),
    c.mailOutbox.deleteMany({ $or: [{ userId }, { to: email }] }),
    c.accessGrants.deleteMany({ userId }),
    c.adminMfa.deleteMany({ _id: userId }),
    c.adminMfaSessions.deleteMany({ userId }),
  ]);
  await c.users.deleteOne({ _id: userId });
}
