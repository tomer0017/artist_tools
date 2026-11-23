import 'server-only';
import { forgetAdminVerification } from '@/server/admin-mfa';
import type { Db, Filter, ObjectId } from 'mongodb';
import { isPlanId, type FeatureId, type PlanId } from '@/lib/plans';
import { recordAudit } from '@/server/audit';
import {
  SUSPEND_REASONS,
  collections,
  toObjectId,
  type AccountStatus,
  type AuditEventDoc,
  type AuditEventType,
  type AuditMetadata,
  type GrantReason,
  type PaymentDoc,
  type SubscriptionDoc,
  type SubscriptionStatus,
  type SuspendReason,
  type UserDoc,
  type UserRole,
} from '@/server/db/collections';
import { GRANT_REASONS, activeGrant, listGrants, liveGrantFilter } from '@/server/grants';
import { assignedPlanOf, currentSubscription, effectivePlan, getEntitlements, subscriptionGrantsPlan, SUBSCRIPTIONS_READ, type Entitlements } from '@/server/entitlements';
import { pendingInitialPassword } from '@/server/password-accounts';
import { getUsage, usagePeriod } from '@/server/usage';

// Read models and operations for application administrators. Everything here
// is called only after the caller was verified as an admin from the database
// (pages: requireAdmin(), server actions: currentAdmin()) or from the operator
// CLI. What it returns is what an admin needs to support an account — never
// tokens, session secrets or Google's full account id.

/** The end of a provider account id: enough to tell two accounts apart, useless on its own. */
export const idHint = (accountId: string | null | undefined): string | null => (accountId ? `…${accountId.slice(-4)}` : null);

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const byUser = (collection: string, match: Record<string, unknown>[] = [], extra: Record<string, unknown>[] = [], as = collection) => ({
  $lookup: {
    from: collection,
    let: { uid: '$_id' },
    pipeline: [{ $match: { $expr: { $and: [{ $eq: ['$userId', '$$uid'] }, ...match] } } }, ...extra],
    as,
  },
});

const latest = (a: Date | null, b: Date | null) => (a && b ? (a > b ? a : b) : (a ?? b));

/** How an account is named in admin screens: its username (username accounts have no real email), else its email. */
export const identityOf = (user: { email: string; username?: string | null; displayUsername?: string | null }) =>
  user.username ? (user.displayUsername || user.username) : user.email;

/**
 * Why an account has more than Free right now, one entry per reason: the
 * admin role (every feature), a paid subscription, Pro given for a time, Pro
 * with no end date (the assigned plan). Billing and manual Pro are listed
 * separately because they are separate: neither ever changes the other.
 */
export type AccessSource =
  | { kind: 'admin' }
  | { kind: 'paid'; status: SubscriptionStatus; periodEnd: Date | null; cancelAtPeriodEnd: boolean }
  | { kind: 'given'; until: Date; reason: string | null }
  | { kind: 'assigned' };

type SourceSubscription = Pick<SubscriptionDoc, 'planId' | 'status' | 'currentPeriodEnd'> & { cancelAtPeriodEnd?: boolean };

/**
 * The sources of an account's access, for admin screens only. It reads the
 * same inputs as src/server/entitlements.ts, which alone decides what applies;
 * this only says where it comes from.
 */
export function accessSourcesOf(
  input: { role?: unknown; plan?: unknown; subscription: SourceSubscription | null; grants: { planId: PlanId; endsAt: Date; reason?: string | null }[] },
  now = new Date(),
): AccessSource[] {
  const sources: AccessSource[] = [];
  if (input.role === 'admin') sources.push({ kind: 'admin' });
  const sub = input.subscription;
  if (sub?.planId === 'pro' && subscriptionGrantsPlan(sub, now)) {
    sources.push({ kind: 'paid', status: sub.status, periodEnd: sub.currentPeriodEnd, cancelAtPeriodEnd: sub.cancelAtPeriodEnd === true });
  }
  for (const grant of input.grants) {
    if (grant.planId === 'pro' && grant.endsAt.getTime() > now.getTime()) sources.push({ kind: 'given', until: grant.endsAt, reason: grant.reason ?? null });
  }
  if (assignedPlanOf(input) === 'pro') sources.push({ kind: 'assigned' });
  return sources;
}

export interface AdminUserRow {
  id: string;
  name: string;
  email: string;
  /** Username accounts (ADR-0012): the username as given; their `email` is only a placeholder. */
  username: string | null;
  emailVerified: boolean;
  image: string | null;
  createdAt: Date;
  lastLoginAt: Date | null;
  status: AccountStatus;
  role: UserRole;
  /** Assigned by an administrator. */
  plan: PlanId;
  /** In force: the assigned plan or an active subscription's, whichever is better. */
  effectivePlan: PlanId;
  subscriptionStatus: SubscriptionStatus | null;
  google: { linked: boolean; idHint: string | null };
  /** Whether the account can sign in with a password. */
  password: boolean;
  testAccount: boolean;
  /** A live time-limited grant, if any. */
  grant: { planId: PlanId; endsAt: Date } | null;
  /** Why the account has more than Free (accessSourcesOf); empty for Free. */
  sources: AccessSource[];
  logins: number;
  /** GIFs exported this calendar month (UTC), as counted by the server. */
  gifsThisMonth: number;
  /** The owner (set only from the server command line). */
  owner: boolean;
  /** The latest of the last sign-in and the last renewal of any of its sessions (renewed at most daily). */
  lastActiveAt: Date | null;
}

interface RawUserRow {
  _id: ObjectId;
  name: string;
  email: string;
  username?: string | null;
  displayUsername?: string | null;
  emailVerified?: boolean;
  image?: string | null;
  createdAt: Date;
  lastLoginAt?: Date | null;
  status?: AccountStatus;
  role?: UserRole;
  plan?: unknown;
  testAccount?: boolean;
  subscription: { planId: PlanId; status: SubscriptionStatus; currentPeriodEnd: Date | null; cancelAtPeriodEnd?: boolean }[];
  usage: { total: number }[];
  google: { accountId: string }[];
  password: { n: number }[];
  grants: { planId: PlanId; endsAt: Date; reason?: string }[];
  logins: { n: number }[];
  owner?: boolean;
  lastSession: { updatedAt: Date }[];
}

export interface UserListQuery {
  page?: number;
  pageSize?: number;
  /** Part of an email address or a username. */
  search?: string;
  role?: UserRole;
  plan?: PlanId;
  status?: AccountStatus;
  verified?: boolean;
  /** Accounts that can sign in this way. */
  method?: 'google' | 'password';
  test?: boolean;
  /** With (true) or without (false) Pro given for a time that is in force now. */
  given?: boolean;
  /** Registered on or after / before these instants. */
  createdFrom?: Date;
  createdBefore?: Date;
}

/** The MongoDB filter for a user list query (filters combine with AND). */
export async function userFilter(db: Db, query: UserListQuery, now = new Date()): Promise<Filter<UserDoc>> {
  const filter: Filter<UserDoc> = {};
  const byId: Filter<UserDoc>[] = [];
  const search = (query.search ?? '').trim().slice(0, 100);
  if (search) filter.$or = [{ email: { $regex: escapeRegExp(search), $options: 'i' } }, { username: { $regex: escapeRegExp(search.toLowerCase()) } }];
  if (query.role) filter.role = query.role === 'admin' ? 'admin' : { $ne: 'admin' };
  // A missing plan is Free; a missing status is active.
  if (query.plan) filter.plan = query.plan === 'pro' ? 'pro' : { $ne: 'pro' };
  if (query.status) filter.status = query.status === 'suspended' ? 'suspended' : { $ne: 'suspended' };
  if (query.verified !== undefined) filter.emailVerified = query.verified ? true : { $ne: true };
  if (query.test !== undefined) filter.testAccount = query.test ? true : { $ne: true };
  if (query.createdFrom || query.createdBefore) {
    filter.createdAt = { ...(query.createdFrom ? { $gte: query.createdFrom } : {}), ...(query.createdBefore ? { $lt: query.createdBefore } : {}) };
  }
  if (query.method) {
    const ids = await collections(db).accounts.distinct('userId', { providerId: query.method === 'google' ? 'google' : 'credential' });
    byId.push({ _id: { $in: ids } });
  }
  if (query.given !== undefined) {
    const ids = await collections(db).accessGrants.distinct('userId', liveGrantFilter(now));
    byId.push({ _id: query.given ? { $in: ids } : { $nin: ids } });
  }
  if (byId.length === 1) Object.assign(filter, byId[0]);
  if (byId.length > 1) filter.$and = byId;
  return filter;
}

export async function listUsers(db: Db, query: UserListQuery = {}, now = new Date()) {
  const { users } = collections(db);
  const pageSize = Math.min(Math.max(1, Math.floor(query.pageSize ?? 50) || 50), 200);
  const search = (query.search ?? '').trim().slice(0, 100);
  const filter = await userFilter(db, query, now);
  const total = await users.countDocuments(filter);
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(Math.max(1, Math.floor(query.page ?? 1) || 1), pages);

  const raw = await users
    .aggregate<RawUserRow>([
      { $match: filter },
      { $sort: { createdAt: -1, _id: -1 } },
      { $skip: (page - 1) * pageSize },
      { $limit: pageSize },
      byUser('subscriptions', [], [{ $sort: { updatedAt: -1 } }, { $limit: SUBSCRIPTIONS_READ }, { $project: { _id: 0, planId: 1, status: 1, currentPeriodEnd: 1, cancelAtPeriodEnd: 1 } }], 'subscription'),
      byUser('usage', [{ $eq: ['$period', usagePeriod(now)] }, { $eq: ['$feature', 'export.gif'] }], [{ $group: { _id: null, total: { $sum: '$quantity' } } }]),
      byUser('accounts', [{ $eq: ['$providerId', 'google'] }], [{ $sort: { createdAt: 1 } }, { $limit: 1 }, { $project: { _id: 0, accountId: 1 } }], 'google'),
      byUser('accounts', [{ $eq: ['$providerId', 'credential'] }], [{ $count: 'n' }], 'password'),
      byUser(
        'access_grants',
        [{ $eq: ['$revokedAt', null] }, { $lte: ['$startsAt', now] }, { $gt: ['$endsAt', now] }],
        [{ $sort: { endsAt: -1 } }, { $project: { _id: 0, planId: 1, endsAt: 1, reason: 1 } }],
        'grants',
      ),
      byUser('audit_events', [{ $eq: ['$type', 'user.login'] }], [{ $count: 'n' }], 'logins'),
      byUser('sessions', [], [{ $sort: { updatedAt: -1 } }, { $limit: 1 }, { $project: { _id: 0, updatedAt: 1 } }], 'lastSession'),
      {
        $project: {
          name: 1, email: 1, username: 1, displayUsername: 1, emailVerified: 1, image: 1, createdAt: 1, lastLoginAt: 1, status: 1, role: 1, plan: 1, testAccount: 1,
          owner: 1, subscription: 1, usage: 1, google: 1, password: 1, grants: 1, logins: 1, lastSession: 1,
        },
      },
    ])
    .toArray();

  const rows: AdminUserRow[] = raw.map((u) => {
    // The same subscription access is decided by (src/server/entitlements.ts).
    const subscription = currentSubscription(u.subscription, now);
    const best = u.grants.find((g) => g.planId === 'pro') ?? u.grants[0] ?? null;
    const grant = best ? { planId: best.planId, endsAt: best.endsAt } : null;
    return {
      id: u._id.toHexString(),
      name: u.name,
      email: u.email,
      username: u.username ? (u.displayUsername || u.username) : null,
      emailVerified: u.emailVerified === true,
      image: u.image ?? null,
      createdAt: u.createdAt,
      lastLoginAt: u.lastLoginAt ?? null,
      status: u.status ?? 'active',
      role: u.role === 'admin' ? 'admin' : 'user',
      plan: assignedPlanOf(u),
      effectivePlan: effectivePlan(u, subscription, now, grant),
      subscriptionStatus: subscription?.status ?? null,
      google: { linked: u.google.length > 0, idHint: idHint(u.google[0]?.accountId) },
      password: (u.password[0]?.n ?? 0) > 0,
      testAccount: u.testAccount === true,
      grant,
      sources: accessSourcesOf({ role: u.role, plan: u.plan, subscription, grants: u.grants }, now),
      logins: u.logins[0]?.n ?? 0,
      gifsThisMonth: u.usage[0]?.total ?? 0,
      owner: u.owner === true,
      lastActiveAt: latest(u.lastLoginAt ?? null, u.lastSession[0]?.updatedAt ?? null),
    };
  });
  return { rows, total, page, pages, search };
}

/** Headline counts for the dashboard. */
export async function userStats(db: Db, now = new Date()) {
  const { users, accessGrants } = collections(db);
  const [total, admins, pro, suspended, test, granted] = await Promise.all([
    users.countDocuments(),
    users.countDocuments({ role: 'admin' }),
    users.countDocuments({ plan: 'pro' }),
    users.countDocuments({ status: 'suspended' }),
    users.countDocuments({ testAccount: true }),
    accessGrants.distinct('userId', { revokedAt: null, startsAt: { $lte: now }, endsAt: { $gt: now } }),
  ]);
  return { total, admins, pro, suspended, test, granted: granted.length };
}

export interface AdminAuditEvent {
  id: string;
  type: AuditEventType;
  at: Date;
  /** Who caused it. */
  actor: { kind: 'admin' | 'user' | 'cli' | 'system' | 'webhook'; id: string | null; email: string | null };
  /** The account it is about. */
  subject: { id: string; email: string | null } | null;
  metadata: AuditMetadata;
}

export interface AuditQuery {
  userId?: ObjectId;
  types?: AuditEventType[];
  actorKind?: AdminAuditEvent['actor']['kind'];
  from?: Date;
  before?: Date;
  limit?: number;
}

function auditFilter(query: AuditQuery): Filter<AuditEventDoc> {
  const filter: Filter<AuditEventDoc> = {};
  if (query.userId) filter.userId = query.userId;
  if (query.types?.length) filter.type = { $in: query.types };
  if (query.actorKind) filter.actor = query.actorKind === 'cli' || query.actorKind === 'system' ? query.actorKind : { $regex: `^${query.actorKind}:` };
  if (query.from || query.before) filter.at = { ...(query.from ? { $gte: query.from } : {}), ...(query.before ? { $lt: query.before } : {}) };
  return filter;
}

/** Most recent audit events (filtered), with the people involved resolved to emails. */
export async function listAuditEvents(db: Db, query: AuditQuery = {}): Promise<AdminAuditEvent[]> {
  const { auditEvents, users } = collections(db);
  const limit = Math.min(Math.max(1, query.limit ?? 30), 5000);
  const events = await auditEvents.find(auditFilter(query), { sort: { at: -1, _id: -1 }, limit }).toArray();

  const actorOf = (actor: string): AdminAuditEvent['actor'] => {
    const [kind, id] = actor.split(':');
    if (kind === 'admin' || kind === 'user') return { kind, id: id ?? null, email: null };
    if (kind === 'webhook') return { kind, id: null, email: null };
    return { kind: kind === 'cli' ? 'cli' : 'system', id: null, email: null };
  };
  const shaped = events.map((e) => ({
    id: e._id!.toHexString(),
    type: e.type,
    at: e.at,
    actor: actorOf(e.actor),
    subject: e.userId ? { id: e.userId.toHexString(), email: null as string | null } : null,
    metadata: e.metadata ?? {},
  }));

  const ids = new Set<string>();
  for (const e of shaped) {
    if (e.subject) ids.add(e.subject.id);
    if (e.actor.id) ids.add(e.actor.id);
  }
  const people = await users
    .find({ _id: { $in: [...ids].map((id) => toObjectId(id)!).filter(Boolean) } }, { projection: { email: 1, username: 1, displayUsername: 1 } })
    .toArray();
  // Username accounts are named by their username (their address is a placeholder).
  const emails = new Map(people.map((p) => [p._id.toHexString(), identityOf(p)]));
  for (const e of shaped) {
    if (e.subject) e.subject.email = emails.get(e.subject.id) ?? null;
    if (e.actor.id) e.actor.email = emails.get(e.actor.id) ?? null;
  }
  return shaped;
}

export interface AdminUserDetail {
  id: string;
  name: string;
  email: string;
  /** Username accounts (ADR-0012): the username as given. */
  username: string | null;
  /** An initial password from the CLI waiting to be revealed once, and until when. */
  initialPassword: { expiresAt: Date } | null;
  emailVerified: boolean;
  image: string | null;
  createdAt: Date;
  lastLoginAt: Date | null;
  status: AccountStatus;
  role: UserRole;
  /** The owner (set only from the server command line): other admins cannot change this account. */
  owner: boolean;
  plan: PlanId;
  planUpdatedAt: Date | null;
  testAccount: boolean;
  suspension: { at: Date | null; reason: SuspendReason | null } | null;
  google: { linked: boolean; idHint: string | null; linkedAt: Date | null };
  password: { setAt: Date } | null;
  grants: { id: string; planId: PlanId; startsAt: Date; endsAt: Date; reason: string; grantedBy: string; revokedAt: Date | null; extendedAt: Date | null; live: boolean }[];
  sessions: { active: number; lastActiveAt: Date | null };
  /** The subscription deciding paid access (else the latest one), read-only, exactly as verified provider events wrote it. */
  subscription: AdminSubscriptionView | null;
  /** The latest payments, refunds and disputes (read-only, newest first). */
  payments: AdminPaymentView[];
  /** Why the account has more than Free (accessSourcesOf); empty for Free. */
  sources: AccessSource[];
  entitlements: Entitlements;
  usageThisMonth: Partial<Record<FeatureId, number>>;
  logins: number;
  events: AdminAuditEvent[];
}

export interface AdminSubscriptionView {
  status: SubscriptionStatus;
  planId: PlanId;
  provider: string;
  interval: 'month' | 'year' | null;
  amountMinor: number | null;
  currency: string | null;
  currentPeriodEnd: Date | null;
  cancelAtPeriodEnd: boolean;
  trialEndsAt: Date | null;
  endedAt: Date | null;
}

export type AdminPaymentView = Pick<PaymentDoc, 'kind' | 'status' | 'amountMinor' | 'currency' | 'occurredAt' | 'receiptUrl' | 'provider'> & { id: string };

/** How many payments an account page shows; the Billing page lists them all. */
export const ACCOUNT_PAYMENTS_SHOWN = 10;

export async function getUserDetail(db: Db, userId: ObjectId, now = new Date()): Promise<AdminUserDetail | null> {
  const { users, accounts, sessions, subscriptions, payments: paymentDocs, auditEvents } = collections(db);
  const user = await users.findOne({ _id: userId });
  if (!user) return null;
  const [google, password, grants, activeSessions, lastSession, subscriptionDocs, payments, entitlements, usageThisMonth, logins, events, initialPassword] = await Promise.all([
    accounts.findOne({ userId, providerId: 'google' }, { sort: { createdAt: 1 }, projection: { accountId: 1, createdAt: 1 } }),
    accounts.findOne({ userId, providerId: 'credential' }, { projection: { createdAt: 1 } }),
    listGrants(db, userId),
    sessions.countDocuments({ userId, expiresAt: { $gt: now } }),
    sessions.findOne({ userId }, { sort: { updatedAt: -1 }, projection: { updatedAt: 1 } }),
    subscriptions.find({ userId }, { sort: { updatedAt: -1 }, limit: SUBSCRIPTIONS_READ }).toArray(),
    paymentDocs
      .find({ userId }, { sort: { occurredAt: -1 }, limit: ACCOUNT_PAYMENTS_SHOWN, projection: { kind: 1, status: 1, amountMinor: 1, currency: 1, occurredAt: 1, receiptUrl: 1, provider: 1 } })
      .toArray(),
    getEntitlements(db, userId, now),
    getUsage(db, userId, usagePeriod(now)),
    auditEvents.countDocuments({ userId, type: 'user.login' }),
    listAuditEvents(db, { userId, limit: 50 }),
    pendingInitialPassword(db, userId, now),
  ]);
  const isLive = (g: { revokedAt: Date | null; startsAt: Date; endsAt: Date }) => g.revokedAt === null && g.startsAt <= now && g.endsAt > now;
  // The same subscription access is decided by (src/server/entitlements.ts).
  const subscription = currentSubscription(subscriptionDocs, now);
  return {
    id: user._id.toHexString(),
    name: user.name,
    email: user.email,
    username: user.username ? (user.displayUsername || user.username) : null,
    initialPassword: user.username ? initialPassword : null,
    emailVerified: user.emailVerified === true,
    image: user.image ?? null,
    createdAt: user.createdAt,
    lastLoginAt: user.lastLoginAt ?? null,
    status: user.status ?? 'active',
    role: user.role === 'admin' ? 'admin' : 'user',
    owner: user.owner === true,
    plan: assignedPlanOf(user),
    planUpdatedAt: user.planUpdatedAt ?? null,
    testAccount: user.testAccount === true,
    suspension: user.status === 'suspended' ? { at: user.suspendedAt ?? null, reason: user.suspendReason ?? null } : null,
    google: { linked: google !== null, idHint: idHint(google?.accountId), linkedAt: google?.createdAt ?? null },
    password: password ? { setAt: password.createdAt } : null,
    grants: grants.map((g) => ({
      id: g._id!.toHexString(),
      planId: g.planId,
      startsAt: g.startsAt,
      endsAt: g.endsAt,
      reason: g.reason,
      grantedBy: g.grantedBy,
      revokedAt: g.revokedAt,
      extendedAt: g.extendedAt ?? null,
      live: isLive(g),
    })),
    sessions: { active: activeSessions, lastActiveAt: lastSession?.updatedAt ?? null },
    subscription: subscription
      ? {
          status: subscription.status,
          planId: subscription.planId,
          provider: subscription.provider,
          interval: subscription.interval ?? null,
          amountMinor: subscription.amountMinor ?? null,
          currency: subscription.currency ?? null,
          currentPeriodEnd: subscription.currentPeriodEnd,
          cancelAtPeriodEnd: subscription.cancelAtPeriodEnd === true,
          trialEndsAt: subscription.trialEndsAt ?? null,
          endedAt: subscription.endedAt ?? null,
        }
      : null,
    payments: payments.map((p) => ({
      id: p._id!.toHexString(),
      kind: p.kind,
      status: p.status,
      amountMinor: p.amountMinor,
      currency: p.currency,
      occurredAt: p.occurredAt,
      receiptUrl: p.receiptUrl,
      provider: p.provider,
    })),
    sources: accessSourcesOf({ role: user.role, plan: user.plan, subscription, grants: grants.filter(isLive) }, now),
    entitlements,
    usageThisMonth,
    logins,
    events,
  };
}

/** Look a user up by email (operator CLI only), to find the id to act on. */
export async function findUserByEmail(db: Db, email: string) {
  return collections(db).users.findOne(
    { email: email.trim().toLowerCase() },
    { projection: { name: 1, email: 1, role: 1, status: 1, createdAt: 1 } },
  );
}

/** 'self': from the dashboard, nobody changes their own access (admins already have every feature). */
export type PlanChange = { status: 'updated'; from: PlanId; to: PlanId } | { status: 'unchanged'; plan: PlanId } | { status: 'not_found' } | { status: 'self' };

/**
 * Assign an account's plan by user id; audited. Assigned Pro is Pro with no
 * end date and no payment. It never touches a subscription or a grant: the
 * better of all three applies (src/server/entitlements.ts).
 */
export async function setUserPlan(
  db: Db,
  change: { userId: ObjectId; plan: PlanId; actor: string; actorUserId?: ObjectId | null; reason?: GrantReason },
  now = new Date(),
): Promise<PlanChange> {
  if (!isPlanId(change.plan)) throw new Error(`Unknown plan: ${String(change.plan)}`);
  if (change.reason !== undefined && !GRANT_REASONS.includes(change.reason)) throw new Error(`Unknown reason: ${String(change.reason)}`);
  const { users } = collections(db);
  const user = await users.findOne({ _id: change.userId }, { projection: { plan: 1 } });
  if (!user) return { status: 'not_found' };
  if (change.actorUserId?.equals(change.userId)) return { status: 'self' };
  const from = assignedPlanOf(user);
  if (from === change.plan) return { status: 'unchanged', plan: from };
  await users.updateOne(
    { _id: change.userId },
    { $set: { plan: change.plan, planUpdatedAt: now, planUpdatedBy: change.actor, updatedAt: now } },
  );
  await recordAudit(db, {
    type: 'admin.plan_changed',
    userId: change.userId,
    actor: change.actor,
    metadata: { from, to: change.plan, ...(change.reason ? { reason: change.reason } : {}) },
  });
  return { status: 'updated', from, to: change.plan };
}

/**
 * 'self': admins cannot take away their own admin role (from the dashboard);
 * 'last_admin': the last active admin always stays one;
 * 'username_account': an account that signs in with a username and a
 * password an administrator handed out never becomes an admin (ADR-0012).
 */
export type RoleChange = 'updated' | 'unchanged' | 'not_found' | 'self' | 'last_admin' | 'username_account';

/** Grant or revoke the admin role by user id; audited. */
export async function setUserRole(
  db: Db,
  change: { userId: ObjectId; role: UserRole; actor: string; actorUserId?: ObjectId | null },
): Promise<RoleChange> {
  const { users } = collections(db);
  const target = await users.findOne({ _id: change.userId }, { projection: { role: 1, username: 1 } });
  if (!target) return 'not_found';
  if ((target.role === 'admin' ? 'admin' : 'user') === change.role) return 'unchanged';

  if (change.role === 'admin') {
    if (target.username) return 'username_account';
    await users.updateOne({ _id: change.userId }, { $set: { role: 'admin', updatedAt: new Date() } });
  } else {
    if (change.actorUserId?.equals(change.userId)) return 'self';
    // An owner who stops being an admin stops being the owner (only the
    // server command line can do that to the owner; the dashboard refuses).
    const wasOwner = (await users.findOne({ _id: change.userId }, { projection: { owner: 1 } }))?.owner === true;
    const demoted = await users.updateOne({ _id: change.userId, role: 'admin' }, { $set: { role: 'user', updatedAt: new Date() }, $unset: { owner: '' } });
    if (demoted.modifiedCount === 0) return 'unchanged';
    // Checked after the write, so two admins demoting each other at the same
    // moment both see that nobody would be left, and both changes are undone.
    if ((await users.countDocuments({ role: 'admin', status: { $ne: 'suspended' } })) === 0) {
      await users.updateOne({ _id: change.userId }, { $set: { role: 'admin', ...(wasOwner ? { owner: true } : {}) } });
      return 'last_admin';
    }
    // A later admin role starts from a code again: no verified session or trusted device carries over.
    await forgetAdminVerification(db, change.userId);
  }
  await recordAudit(db, {
    type: change.role === 'admin' ? 'admin.role_granted' : 'admin.role_revoked',
    userId: change.userId,
    actor: change.actor,
    metadata: { role: change.role },
  });
  return 'updated';
}

/**
 * 'self': admins cannot suspend themselves; 'last_admin': the last active
 * admin can never be suspended.
 */
export type StatusChange = 'updated' | 'unchanged' | 'not_found' | 'self' | 'last_admin' | 'invalid';

/**
 * Suspend or reactivate an account; audited. Suspending signs it out
 * everywhere at once (its sessions are deleted, which getSession checks on
 * every request) and blocks new sign-ins.
 */
export async function setUserStatus(
  db: Db,
  change: { userId: ObjectId; status: AccountStatus; reason?: SuspendReason; actor: string; actorUserId?: ObjectId | null },
  now = new Date(),
): Promise<StatusChange> {
  const { users, sessions } = collections(db);
  const target = await users.findOne({ _id: change.userId }, { projection: { status: 1, role: 1 } });
  if (!target) return 'not_found';
  const current: AccountStatus = target.status === 'suspended' ? 'suspended' : 'active';
  if (current === change.status) return 'unchanged';
  if (change.status === 'suspended') {
    if (!change.reason || !SUSPEND_REASONS.includes(change.reason)) return 'invalid';
    if (change.actorUserId?.equals(change.userId)) return 'self';
    if (target.role === 'admin' && (await users.countDocuments({ _id: { $ne: change.userId }, role: 'admin', status: { $ne: 'suspended' } })) === 0) {
      return 'last_admin';
    }
    await users.updateOne(
      { _id: change.userId },
      { $set: { status: 'suspended', suspendedAt: now, suspendedBy: change.actor, suspendReason: change.reason, updatedAt: now } },
    );
    const { deletedCount } = await sessions.deleteMany({ userId: change.userId });
    await recordAudit(db, { type: 'admin.account_suspended', userId: change.userId, actor: change.actor, metadata: { reason: change.reason, sessionsEnded: deletedCount } });
  } else {
    await users.updateOne({ _id: change.userId }, { $set: { status: 'active', updatedAt: now }, $unset: { suspendedAt: '', suspendedBy: '', suspendReason: '' } });
    await recordAudit(db, { type: 'admin.account_reactivated', userId: change.userId, actor: change.actor, metadata: {} });
  }
  return 'updated';
}

/** Mark or unmark a test account (left out of analytics and revenue); audited. */
export async function setTestAccount(db: Db, change: { userId: ObjectId; test: boolean; actor: string }, now = new Date()): Promise<'updated' | 'unchanged' | 'not_found'> {
  const { users } = collections(db);
  const target = await users.findOne({ _id: change.userId }, { projection: { testAccount: 1 } });
  if (!target) return 'not_found';
  if ((target.testAccount === true) === change.test) return 'unchanged';
  await users.updateOne({ _id: change.userId }, { $set: { testAccount: change.test, updatedAt: now } });
  await recordAudit(db, { type: 'admin.test_flag_changed', userId: change.userId, actor: change.actor, metadata: { test: change.test } });
  return 'updated';
}

/** Re-export for pages that show a single account's live grant. */
export { activeGrant };

// ─── The owner (set only from the server command line) ────────────────────────
// One administrator, marked by `users.owner` (at most one, a unique index).
// From the dashboard, only the owner changes admin roles, and no other admin
// can change the owner's account; the server command line is not limited.
// While no owner is set, admins work as before.

/** 'owner': the account is the owner's and the admin acting is someone else. */
export async function ownerProtection(db: Db, change: { actorUserId: ObjectId; userId: ObjectId }): Promise<'owner' | null> {
  if (change.actorUserId.equals(change.userId)) return null;
  const owner = await collections(db).users.findOne({ _id: change.userId, owner: true }, { projection: { _id: 1 } });
  return owner ? 'owner' : null;
}

/** Whether this admin may change admin roles from the dashboard: the owner, or any admin while no owner is set. */
export async function mayChangeRoles(db: Db, actorUserId: ObjectId): Promise<boolean> {
  const owner = await collections(db).users.findOne({ owner: true }, { projection: { _id: 1 } });
  return !owner || owner._id.equals(actorUserId);
}

export type OwnerResult = { status: 'set'; previous: ObjectId | null } | { status: 'unchanged' } | { status: 'not_found' } | { status: 'not_admin' } | { status: 'username_account' };

/**
 * Make an active admin with a Google sign-in the owner (server command line
 * only); the previous owner, if any, stops being it. Audited.
 */
export async function setOwner(db: Db, userId: ObjectId, actor = 'cli'): Promise<OwnerResult> {
  const { users } = collections(db);
  const target = await users.findOne({ _id: userId }, { projection: { role: 1, status: 1, username: 1, owner: 1 } });
  if (!target) return { status: 'not_found' };
  if (target.username) return { status: 'username_account' };
  if (target.role !== 'admin' || (target.status ?? 'active') !== 'active') return { status: 'not_admin' };
  if (target.owner === true) return { status: 'unchanged' };
  const previous = await users.findOne({ owner: true }, { projection: { _id: 1 } });
  if (previous) await users.updateOne({ _id: previous._id }, { $unset: { owner: '' } });
  await users.updateOne({ _id: userId }, { $set: { owner: true, updatedAt: new Date() } });
  await recordAudit(db, { type: 'admin.owner_set', userId, actor, metadata: { previous: previous?._id.toHexString() ?? null } });
  return { status: 'set', previous: previous?._id ?? null };
}
