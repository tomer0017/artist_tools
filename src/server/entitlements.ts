import 'server-only';
import type { Db, ObjectId } from 'mongodb';
import { FEATURES, betterPlan, isPlanId } from '@/lib/plans';
import {
  collections,
  type AccountStatus,
  type FeatureId,
  type PlanDoc,
  type PlanId,
  type SubscriptionDoc,
  type SubscriptionStatus,
  type UserRole,
} from '@/server/db/collections';
import { activeGrant } from '@/server/grants';
import { countUsage, getUsage, giveBackUsage, takeUsage, usageDay, usagePeriod } from '@/server/usage';

// ─── Entitlements ──────────────────────────────────────────────────────────────
// The single place that decides what an account may use. Inputs come only from
// the database (user status, role and assigned plan, server-written
// subscriptions, plans, usage); nothing the browser sends — a plan name, a
// payment status, a counter — is ever an input. UI may hide or show things
// from a read-only copy of the result, but that is presentation, not
// protection.
//
// Role and plan are independent: admins get every feature whatever their plan
// or subscription, and no plan ever grants the admin role. The plan in force
// is the best of three: the plan an admin assigned, an active subscription,
// and a live time-limited grant (src/server/grants.ts).

/** Days a subscription keeps its plan after its period ends while renewal or a failed payment resolves. */
export const GRACE_DAYS = 3;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface Entitlements {
  authenticated: boolean;
  accountActive: boolean;
  /** What decided the features: the admin role, the plan in force, or nothing (signed out or suspended). */
  access: 'admin' | PlanId | 'none';
  role: UserRole;
  /** The plan an administrator assigned to the account. */
  assignedPlan: PlanId;
  /** The plan in force: the best of the assigned plan, an active subscription and a live grant. */
  planId: PlanId;
  /** A live time-limited grant, if one is in force. */
  grant: { planId: PlanId; endsAt: Date } | null;
  subscriptionStatus: SubscriptionStatus | null;
  subscriptionActive: boolean;
  features: FeatureId[];
  /** Monthly caps; a feature not listed is unlimited. */
  limits: Partial<Record<FeatureId, number>>;
  usage: Partial<Record<FeatureId, number>>;
  /** Daily caps (UTC day) and today's use. */
  dailyLimits: Partial<Record<FeatureId, number>>;
  dailyUsage: Partial<Record<FeatureId, number>>;
}

type SubscriptionState = Pick<SubscriptionDoc, 'planId' | 'status' | 'currentPeriodEnd'>;
type PlanState = Pick<PlanDoc, 'active' | 'features' | 'limits' | 'dailyLimits'>;
type UserState = { status: AccountStatus; role?: unknown; plan?: unknown };

/** Whether a subscription currently grants its plan. */
export function subscriptionGrantsPlan(subscription: SubscriptionState | null, now: Date): boolean {
  if (!subscription) return false;
  const end = subscription.currentPeriodEnd?.getTime() ?? null;
  const graceEnd = end === null ? null : end + GRACE_DAYS * DAY_MS;
  switch (subscription.status) {
    case 'active':
    case 'trialing':
      return graceEnd === null || now.getTime() < graceEnd;
    case 'past_due':
      return graceEnd !== null && now.getTime() < graceEnd;
    case 'canceled':
      // Paid until the end of the period, then nothing.
      return end !== null && now.getTime() < end;
    default:
      return false;
  }
}

/** The plan an administrator assigned; anything unexpected in the document counts as Free. */
export function assignedPlanOf(user: { plan?: unknown } | null): PlanId {
  const plan = user?.plan;
  return isPlanId(plan) ? plan : 'free';
}

/** The plan in force: the best of the assigned plan, an active subscription's plan and a live grant's. */
export function effectivePlan(
  user: { plan?: unknown },
  subscription: SubscriptionState | null,
  now: Date,
  grant: { planId: PlanId; endsAt: Date } | null = null,
): PlanId {
  const fromSubscription = betterPlan(assignedPlanOf(user), subscriptionGrantsPlan(subscription, now) ? subscription!.planId : null);
  return betterPlan(fromSubscription, grant && grant.endsAt.getTime() > now.getTime() ? grant.planId : null);
}

export function computeEntitlements(input: {
  user: UserState | null;
  subscription: SubscriptionState | null;
  plans: Partial<Record<PlanId, PlanState>>;
  usage: Partial<Record<FeatureId, number>>;
  dailyUsage?: Partial<Record<FeatureId, number>>;
  now: Date;
  grant?: { planId: PlanId; endsAt: Date } | null;
}): Entitlements {
  const grant = input.grant && input.grant.endsAt.getTime() > input.now.getTime() ? input.grant : null;
  const role: UserRole = input.user?.role === 'admin' ? 'admin' : 'user';
  const none: Entitlements = {
    authenticated: input.user !== null,
    accountActive: false,
    access: 'none',
    role,
    assignedPlan: assignedPlanOf(input.user),
    planId: 'free',
    subscriptionStatus: input.subscription?.status ?? null,
    subscriptionActive: false,
    grant: null,
    features: [],
    limits: {},
    usage: input.usage,
    dailyLimits: {},
    dailyUsage: input.dailyUsage ?? {},
  };
  if (!input.user || input.user.status !== 'active') return none;

  const subscriptionActive = subscriptionGrantsPlan(input.subscription, input.now);
  const wanted = effectivePlan(input.user, input.subscription, input.now, grant);
  const planId: PlanId = input.plans[wanted]?.active ? wanted : 'free';
  const plan = input.plans[planId];

  // Administrators can use everything, on any plan, paid or not.
  if (role === 'admin') {
    return { ...none, accountActive: true, access: 'admin', planId, subscriptionActive, grant, features: [...FEATURES] };
  }
  if (!plan?.active) return { ...none, accountActive: true, planId, subscriptionActive, grant };

  return {
    ...none,
    accountActive: true,
    access: planId,
    planId,
    subscriptionActive,
    grant,
    features: [...plan.features],
    limits: { ...plan.limits },
    dailyLimits: { ...(plan.dailyLimits ?? {}) },
  };
}

/** Whether the plan includes a feature at all (ignoring quotas). */
export const includes = (entitlements: Entitlements, feature: FeatureId): boolean => entitlements.accountActive && entitlements.features.includes(feature);

/** Whether the account may use a feature right now (included and under its monthly and daily caps). */
export function canUse(entitlements: Entitlements, feature: FeatureId): boolean {
  return includes(entitlements, feature) && remaining(entitlements, feature) !== 0;
}

/** Uses left right now (the tighter of the monthly and daily caps); null means unlimited, 0 means none. */
export function remaining(entitlements: Entitlements, feature: FeatureId): number | null {
  if (!includes(entitlements, feature)) return 0;
  const left = [
    entitlements.limits[feature] === undefined ? null : entitlements.limits[feature]! - (entitlements.usage[feature] ?? 0),
    entitlements.dailyLimits[feature] === undefined ? null : entitlements.dailyLimits[feature]! - (entitlements.dailyUsage[feature] ?? 0),
  ].filter((n): n is number => n !== null);
  return left.length === 0 ? null : Math.max(0, Math.min(...left));
}

// Plans change rarely; keep them for a minute instead of reading them on every request.
let planCache: { at: number; plans: Partial<Record<PlanId, PlanState>> } | null = null;
const PLAN_CACHE_MS = 60_000;

async function loadPlans(db: Db, now: number): Promise<Partial<Record<PlanId, PlanState>>> {
  if (planCache && now - planCache.at < PLAN_CACHE_MS) return planCache.plans;
  const docs = await collections(db).plans.find({}, { projection: { active: 1, features: 1, limits: 1, dailyLimits: 1 } }).toArray();
  const plans = Object.fromEntries(docs.map((p) => [p._id, p])) as Partial<Record<PlanId, PlanState>>;
  planCache = { at: now, plans };
  return plans;
}

/** Forget cached plans (after editing them, and in tests). */
export const clearPlanCache = () => {
  planCache = null;
};

/** Entitlements of an account, read entirely from the database. */
export async function getEntitlements(db: Db, userId: ObjectId, now = new Date()): Promise<Entitlements> {
  const { users, subscriptions } = collections(db);
  const [user, subscription, plans, usage, dailyUsage, grant] = await Promise.all([
    users.findOne({ _id: userId }, { projection: { status: 1, role: 1, plan: 1 } }),
    subscriptions.findOne({ userId }, { sort: { updatedAt: -1 }, projection: { planId: 1, status: 1, currentPeriodEnd: 1 } }),
    loadPlans(db, now.getTime()),
    getUsage(db, userId, usagePeriod(now)),
    getUsage(db, userId, usageDay(now)),
    activeGrant(db, userId, now),
  ]);
  return computeEntitlements({
    user: user ? { status: user.status ?? 'active', role: user.role, plan: user.plan } : null,
    subscription,
    plans,
    usage,
    dailyUsage,
    now,
    grant,
  });
}

export type FeatureUseResult = { status: 'recorded' } | { status: 'denied'; reason: 'not_included' | 'limit_reached'; missing: FeatureId[] };

/**
 * Authorize one use of `features` right now and count it (a large GIF needs
 * 'export.gif' and 'export.gif_large'). Decided from the database only.
 * Capped features are taken atomically (check and count in one update) and
 * handed back if another feature of the same request is refused, so a cap
 * can never be exceeded, even by simultaneous requests.
 */
export async function authorizeFeatureUse(db: Db, userId: ObjectId, features: FeatureId[], now = new Date()): Promise<FeatureUseResult> {
  const entitlements = await getEntitlements(db, userId, now);
  const wanted = [...new Set(features)];
  const notIncluded = wanted.filter((feature) => !includes(entitlements, feature));
  if (notIncluded.length > 0) return { status: 'denied', reason: 'not_included', missing: notIncluded };

  const taken: { feature: FeatureId; period: string }[] = [];
  const giveBack = () => Promise.all(taken.map((t) => giveBackUsage(db, userId, t.feature, t.period)));
  for (const feature of wanted) {
    const caps: [string, number | undefined][] = [
      [usageDay(now), entitlements.dailyLimits[feature]],
      [usagePeriod(now), entitlements.limits[feature]],
    ];
    for (const [period, limit] of caps) {
      if (limit === undefined || entitlements.access === 'admin') continue;
      if (!(await takeUsage(db, userId, feature, period, limit, now))) {
        await giveBack();
        return { status: 'denied', reason: 'limit_reached', missing: [feature] };
      }
      taken.push({ feature, period });
    }
  }
  // Uncapped periods are simply counted (admins included: they are never capped).
  for (const feature of wanted) {
    for (const period of [usageDay(now), usagePeriod(now)]) {
      if (!taken.some((t) => t.feature === feature && t.period === period)) {
        await countUsage(db, userId, feature, period, 1, now);
      }
    }
  }
  return { status: 'recorded' };
}
