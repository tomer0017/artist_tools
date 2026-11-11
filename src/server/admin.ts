import 'server-only';
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
  type SubscriptionStatus,
  type SuspendReason,
  type UserDoc,
  type UserRole,
} from '@/server/db/collections';
import { activeGrant, listGrants } from '@/server/grants';
import { assignedPlanOf, effectivePlan, getEntitlements, type Entitlements } from '@/server/entitlements';
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

export interface AdminUserRow {
  id: string;
  name: string;
  email: string;
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
  logins: number;
  /** GIFs exported this calendar month (UTC), as counted by the server. */
  gifsThisMonth: number;
}

interface RawUserRow {
  _id: ObjectId;
  name: string;
  email: string;
  emailVerified?: boolean;
  image?: string | null;
  createdAt: Date;
  lastLoginAt?: Date | null;
  status?: AccountStatus;
  role?: UserRole;
  plan?: unknown;
  testAccount?: boolean;
  subscription: { planId: PlanId; status: SubscriptionStatus; currentPeriodEnd: Date | null }[];
  usage: { total: number }[];
  google: { accountId: string }[];
  password: { n: number }[];
  grants: { planId: PlanId; endsAt: Date }[];
  logins: { n: number }[];
}

export interface UserListQuery {
  page?: number;
  pageSize?: number;
  /** Part of an email address. */
  search?: string;
  role?: UserRole;
  plan?: PlanId;
  status?: AccountStatus;
  verified?: boolean;
  /** Accounts that can sign in this way. */
  method?: 'google' | 'password';
  test?: boolean;
  /** Registered on or after / before these instants. */
  createdFrom?: Date;
  createdBefore?: Date;
}

/** The MongoDB filter for a user list query (filters combine with AND). */
export async function userFilter(db: Db, query: UserListQuery): Promise<Filter<UserDoc>> {
  const filter: Filter<UserDoc> = {};
  const search = (query.search ?? '').trim().slice(0, 100);
  if (search) filter.email = { $regex: escapeRegExp(search), $options: 'i' };
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
    filter._id = { $in: ids };
  }
  return filter;
}

export async function listUsers(db: Db, query: UserListQuery = {}, now = new Date()) {
  const { users } = collections(db);
  const pageSize = Math.min(Math.max(1, Math.floor(query.pageSize ?? 50) || 50), 200);
  const search = (query.search ?? '').trim().slice(0, 100);
  const filter = await userFilter(db, query);
  const total = await users.countDocuments(filter);
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(Math.max(1, Math.floor(query.page ?? 1) || 1), pages);

  const raw = await users
    .aggregate<RawUserRow>([
      { $match: filter },
      { $sort: { createdAt: -1, _id: -1 } },
      { $skip: (page - 1) * pageSize },
      { $limit: pageSize },
      byUser('subscriptions', [], [{ $sort: { updatedAt: -1 } }, { $limit: 1 }, { $project: { _id: 0, planId: 1, status: 1, currentPeriodEnd: 1 } }], 'subscription'),
      byUser('usage', [{ $eq: ['$period', usagePeriod(now)] }, { $eq: ['$feature', 'export.gif'] }], [{ $group: { _id: null, total: { $sum: '$quantity' } } }]),
      byUser('accounts', [{ $eq: ['$providerId', 'google'] }], [{ $sort: { createdAt: 1 } }, { $limit: 1 }, { $project: { _id: 0, accountId: 1 } }], 'google'),
      byUser('accounts', [{ $eq: ['$providerId', 'credential'] }], [{ $count: 'n' }], 'password'),
      byUser(
        'access_grants',
        [{ $eq: ['$revokedAt', null] }, { $lte: ['$startsAt', now] }, { $gt: ['$endsAt', now] }],
        [{ $sort: { endsAt: -1 } }, { $project: { _id: 0, planId: 1, endsAt: 1 } }],
        'grants',
      ),
      byUser('audit_events', [{ $eq: ['$type', 'user.login'] }], [{ $count: 'n' }], 'logins'),
      {
        $project: {
          name: 1, email: 1, emailVerified: 1, image: 1, createdAt: 1, lastLoginAt: 1, status: 1, role: 1, plan: 1, testAccount: 1,
          subscription: 1, usage: 1, google: 1, password: 1, grants: 1, logins: 1,
        },
      },
    ])
    .toArray();

  const rows: AdminUserRow[] = raw.map((u) => {
    const subscription = u.subscription[0] ?? null;
    const grant = u.grants.find((g) => g.planId === 'pro') ?? u.grants[0] ?? null;
    return {
      id: u._id.toHexString(),
      name: u.name,
      email: u.email,
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
      logins: u.logins[0]?.n ?? 0,
      gifsThisMonth: u.usage[0]?.total ?? 0,
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
    .find({ _id: { $in: [...ids].map((id) => toObjectId(id)!).filter(Boolean) } }, { projection: { email: 1 } })
    .toArray();
  const emails = new Map(people.map((p) => [p._id.toHexString(), p.email]));
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
  emailVerified: boolean;
  image: string | null;
  createdAt: Date;
  lastLoginAt: Date | null;
  status: AccountStatus;
  role: UserRole;
  plan: PlanId;
  planUpdatedAt: Date | null;
  testAccount: boolean;
  suspension: { at: Date | null; reason: SuspendReason | null } | null;
  google: { linked: boolean; idHint: string | null; linkedAt: Date | null };
  password: { setAt: Date } | null;
  grants: { id: string; planId: PlanId; startsAt: Date; endsAt: Date; reason: string; grantedBy: string; revokedAt: Date | null; live: boolean }[];
  sessions: { active: number; lastActiveAt: Date | null };
  subscription: { status: SubscriptionStatus; planId: PlanId; currentPeriodEnd: Date | null } | null;
  entitlements: Entitlements;
  usageThisMonth: Partial<Record<FeatureId, number>>;
  logins: number;
  events: AdminAuditEvent[];
}

export async function getUserDetail(db: Db, userId: ObjectId, now = new Date()): Promise<AdminUserDetail | null> {
  const { users, accounts, sessions, subscriptions, auditEvents } = collections(db);
  const user = await users.findOne({ _id: userId });
  if (!user) return null;
  const [google, password, grants, activeSessions, lastSession, subscription, entitlements, usageThisMonth, logins, events] = await Promise.all([
    accounts.findOne({ userId, providerId: 'google' }, { sort: { createdAt: 1 }, projection: { accountId: 1, createdAt: 1 } }),
    accounts.findOne({ userId, providerId: 'credential' }, { projection: { createdAt: 1 } }),
    listGrants(db, userId),
    sessions.countDocuments({ userId, expiresAt: { $gt: now } }),
    sessions.findOne({ userId }, { sort: { updatedAt: -1 }, projection: { updatedAt: 1 } }),
    subscriptions.findOne({ userId }, { sort: { updatedAt: -1 }, projection: { status: 1, planId: 1, currentPeriodEnd: 1 } }),
    getEntitlements(db, userId, now),
    getUsage(db, userId, usagePeriod(now)),
    auditEvents.countDocuments({ userId, type: 'user.login' }),
    listAuditEvents(db, { userId, limit: 50 }),
  ]);
  return {
    id: user._id.toHexString(),
    name: user.name,
    email: user.email,
    emailVerified: user.emailVerified === true,
    image: user.image ?? null,
    createdAt: user.createdAt,
    lastLoginAt: user.lastLoginAt ?? null,
    status: user.status ?? 'active',
    role: user.role === 'admin' ? 'admin' : 'user',
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
      live: g.revokedAt === null && g.startsAt <= now && g.endsAt > now,
    })),
    sessions: { active: activeSessions, lastActiveAt: lastSession?.updatedAt ?? null },
    subscription: subscription ? { status: subscription.status, planId: subscription.planId, currentPeriodEnd: subscription.currentPeriodEnd } : null,
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

export type PlanChange = { status: 'updated'; from: PlanId; to: PlanId } | { status: 'unchanged'; plan: PlanId } | { status: 'not_found' };

/** Assign an account's plan by user id (staging: Free ↔ Pro without billing); audited. */
export async function setUserPlan(db: Db, change: { userId: ObjectId; plan: PlanId; actor: string }, now = new Date()): Promise<PlanChange> {
  if (!isPlanId(change.plan)) throw new Error(`Unknown plan: ${String(change.plan)}`);
  const { users } = collections(db);
  const user = await users.findOne({ _id: change.userId }, { projection: { plan: 1 } });
  if (!user) return { status: 'not_found' };
  const from = assignedPlanOf(user);
  if (from === change.plan) return { status: 'unchanged', plan: from };
  await users.updateOne(
    { _id: change.userId },
    { $set: { plan: change.plan, planUpdatedAt: now, planUpdatedBy: change.actor, updatedAt: now } },
  );
  await recordAudit(db, { type: 'admin.plan_changed', userId: change.userId, actor: change.actor, metadata: { from, to: change.plan } });
  return { status: 'updated', from, to: change.plan };
}

/**
 * 'self': admins cannot take away their own admin role (from the dashboard);
 * 'last_admin': the last active admin always stays one.
 */
export type RoleChange = 'updated' | 'unchanged' | 'not_found' | 'self' | 'last_admin';

/** Grant or revoke the admin role by user id; audited. */
export async function setUserRole(
  db: Db,
  change: { userId: ObjectId; role: UserRole; actor: string; actorUserId?: ObjectId | null },
): Promise<RoleChange> {
  const { users } = collections(db);
  const target = await users.findOne({ _id: change.userId }, { projection: { role: 1 } });
  if (!target) return 'not_found';
  if ((target.role === 'admin' ? 'admin' : 'user') === change.role) return 'unchanged';

  if (change.role === 'admin') {
    await users.updateOne({ _id: change.userId }, { $set: { role: 'admin', updatedAt: new Date() } });
  } else {
    if (change.actorUserId?.equals(change.userId)) return 'self';
    const demoted = await users.updateOne({ _id: change.userId, role: 'admin' }, { $set: { role: 'user', updatedAt: new Date() } });
    if (demoted.modifiedCount === 0) return 'unchanged';
    // Checked after the write, so two admins demoting each other at the same
    // moment both see that nobody would be left, and both changes are undone.
    if ((await users.countDocuments({ role: 'admin', status: { $ne: 'suspended' } })) === 0) {
      await users.updateOne({ _id: change.userId }, { $set: { role: 'admin' } });
      return 'last_admin';
    }
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
