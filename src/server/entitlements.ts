import 'server-only';
import type { Db, ObjectId } from 'mongodb';
import {
  collections,
  type AccountStatus,
  type FeatureId,
  type PlanDoc,
  type PlanId,
  type SubscriptionDoc,
  type SubscriptionStatus,
} from '@/server/db/collections';
import { getUsage } from '@/server/usage';

// ─── Entitlements ──────────────────────────────────────────────────────────────
// The single place that decides what an account may use. Inputs come only from
// the database (user status, server-written subscriptions, plans, usage);
// nothing the browser sends — a plan name, a payment status, a counter — is
// ever an input. UI may hide or show things from a read-only copy of the
// result, but that is presentation, not protection.

/** Days a subscription keeps its plan after its period ends while renewal or a failed payment resolves. */
export const GRACE_DAYS = 3;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface Entitlements {
  authenticated: boolean;
  accountActive: boolean;
  planId: PlanId;
  subscriptionStatus: SubscriptionStatus | null;
  subscriptionActive: boolean;
  features: FeatureId[];
  /** Monthly caps; a feature not listed is unlimited. */
  limits: Partial<Record<FeatureId, number>>;
  usage: Partial<Record<FeatureId, number>>;
}

type SubscriptionState = Pick<SubscriptionDoc, 'planId' | 'status' | 'currentPeriodEnd'>;
type PlanState = Pick<PlanDoc, 'active' | 'features' | 'limits'>;

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

export function computeEntitlements(input: {
  user: { status: AccountStatus } | null;
  subscription: SubscriptionState | null;
  plans: Partial<Record<PlanId, PlanState>>;
  usage: Partial<Record<FeatureId, number>>;
  now: Date;
}): Entitlements {
  const none: Entitlements = {
    authenticated: input.user !== null,
    accountActive: false,
    planId: 'free',
    subscriptionStatus: input.subscription?.status ?? null,
    subscriptionActive: false,
    features: [],
    limits: {},
    usage: input.usage,
  };
  if (!input.user || input.user.status !== 'active') return none;

  const subscriptionActive = subscriptionGrantsPlan(input.subscription, input.now);
  const wanted: PlanId = subscriptionActive ? input.subscription!.planId : 'free';
  const planId: PlanId = input.plans[wanted]?.active ? wanted : 'free';
  const plan = input.plans[planId];
  if (!plan?.active) return { ...none, accountActive: true, subscriptionActive };

  return {
    ...none,
    accountActive: true,
    planId,
    subscriptionActive,
    features: [...plan.features],
    limits: { ...plan.limits },
  };
}

/** Whether the account may use a feature right now (included and under its cap). */
export function canUse(entitlements: Entitlements, feature: FeatureId): boolean {
  if (!entitlements.accountActive || !entitlements.features.includes(feature)) return false;
  const limit = entitlements.limits[feature];
  return limit === undefined || (entitlements.usage[feature] ?? 0) < limit;
}

/** Uses left this month; null means unlimited, 0 means none. */
export function remaining(entitlements: Entitlements, feature: FeatureId): number | null {
  if (!canUse(entitlements, feature)) return 0;
  const limit = entitlements.limits[feature];
  return limit === undefined ? null : Math.max(0, limit - (entitlements.usage[feature] ?? 0));
}

// Plans change rarely; keep them for a minute instead of reading them on every request.
let planCache: { at: number; plans: Partial<Record<PlanId, PlanState>> } | null = null;
const PLAN_CACHE_MS = 60_000;

async function loadPlans(db: Db, now: number): Promise<Partial<Record<PlanId, PlanState>>> {
  if (planCache && now - planCache.at < PLAN_CACHE_MS) return planCache.plans;
  const docs = await collections(db).plans.find({}, { projection: { active: 1, features: 1, limits: 1 } }).toArray();
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
  const [user, subscription, plans, usage] = await Promise.all([
    users.findOne({ _id: userId }, { projection: { status: 1 } }),
    subscriptions.findOne({ userId }, { sort: { updatedAt: -1 }, projection: { planId: 1, status: 1, currentPeriodEnd: 1 } }),
    loadPlans(db, now.getTime()),
    getUsage(db, userId),
  ]);
  return computeEntitlements({
    user: user ? { status: user.status ?? 'active' } : null,
    subscription,
    plans,
    usage,
    now,
  });
}
