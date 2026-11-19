import 'server-only';
import type { Db, ObjectId } from 'mongodb';
import { FEATURES, PLAN_IDS, betterPlan, isPlanId, type ExportFeatureId, type PlanOffer, type ToolFeatureId } from '@/lib/plans';
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
import { ALL_LEARN_ACCESS, NO_LEARN_ACCESS, type LearnAccess } from '@/lib/learn/model';
import { learnAccessOf } from '@/server/config/learn-access';
import { activeGrant } from '@/server/grants';
import { learnItemState } from '@/server/learn/live';
import { log } from '@/server/log';
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
//
// What each plan includes is the published plan catalog, as publishing wrote
// it to `plans` (src/server/config/catalog.ts). It is read on every request:
// a publication applies to everyone's next request, in every process.

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
  /** What each plan includes as published (to explain a lock: "part of Pro", or off for everyone). */
  offer: PlanOffer;
  /** Which Learn items the plan in force opens, and what locked ones show (ADR-0017): decided by src/lib/learn/access.ts. */
  learn: LearnAccess;
}

type SubscriptionState = Pick<SubscriptionDoc, 'planId' | 'status' | 'currentPeriodEnd'>;
export type PlanState = Pick<PlanDoc, 'active' | 'features' | 'limits' | 'dailyLimits'> & { learn?: LearnAccess };

/** What each plan includes, from the plan documents (a plan that is switched off includes nothing). */
export function offerOf(plans: Partial<Record<PlanId, PlanState>>): PlanOffer {
  const features = (planId: PlanId) => (plans[planId]?.active ? FEATURES.filter((f) => plans[planId]!.features.includes(f)) : []);
  return Object.fromEntries(PLAN_IDS.map((planId) => [planId, features(planId)])) as PlanOffer;
}
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
    offer: offerOf(input.plans),
    learn: NO_LEARN_ACCESS(),
  };
  if (!input.user || input.user.status !== 'active') return none;

  const subscriptionActive = subscriptionGrantsPlan(input.subscription, input.now);
  const wanted = effectivePlan(input.user, input.subscription, input.now, grant);
  const planId: PlanId = input.plans[wanted]?.active ? wanted : 'free';
  const plan = input.plans[planId];

  // Administrators can use everything, on any plan, paid or not.
  if (role === 'admin') {
    return { ...none, accountActive: true, access: 'admin', planId, subscriptionActive, grant, features: [...FEATURES], learn: ALL_LEARN_ACCESS() };
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
    learn: plan.learn ? structuredClone(plan.learn) : NO_LEARN_ACCESS(),
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

/** Problems already logged by this process (a malformed plan would otherwise be logged on every request). */
const reported = new Set<string>();
function reportOnce(key: string, fields: Record<string, unknown>) {
  if (reported.has(key)) return;
  reported.add(key);
  log.error('plans.malformed', fields);
}

const isCapMap = (value: unknown) => value === undefined || value === null || (typeof value === 'object' && !Array.isArray(value));

/** Caps of the features this release knows; a cap it cannot read allows no use at all (fail closed). */
function capsOf(value: unknown, planId: string, field: string): Partial<Record<FeatureId, number>> {
  const caps: Partial<Record<FeatureId, number>> = {};
  if (!value) return caps;
  for (const feature of FEATURES) {
    const cap = (value as Record<string, unknown>)[feature];
    if (cap === undefined) continue;
    if (typeof cap === 'number' && Number.isInteger(cap) && cap >= 0) {
      caps[feature] = cap;
    } else {
      caps[feature] = 0;
      reportOnce(`${planId}.${field}.${feature}`, { plan: planId, field, feature });
    }
  }
  return caps;
}

/**
 * A `plans` document as entitlements use it (ADR-0014): only the features
 * this release knows (a newer release's are ignored), and anything malformed
 * counts against access, never for it — a plan without a readable shape
 * includes nothing.
 */
export function planStateOf(doc: { _id: unknown; active?: unknown; features?: unknown; limits?: unknown; dailyLimits?: unknown; learn?: unknown }): PlanState {
  const planId = String(doc._id);
  if (!Array.isArray(doc.features) || !isCapMap(doc.limits) || !isCapMap(doc.dailyLimits)) {
    reportOnce(`${planId}.shape`, { plan: planId });
    return { active: false, features: [], limits: {}, dailyLimits: {}, learn: NO_LEARN_ACCESS() };
  }
  const listed = doc.features as unknown[];
  return {
    active: doc.active === true,
    features: FEATURES.filter((f) => listed.includes(f)),
    limits: capsOf(doc.limits, planId, 'limits'),
    dailyLimits: capsOf(doc.dailyLimits, planId, 'dailyLimits'),
    // Learn access as published; missing (a plan written before M4) or malformed opens nothing.
    learn: learnAccessOf(doc.learn, planId, reportOnce),
  };
}

// Read on every request (two small documents), never cached: a cache here was
// per process, and with Next.js even per bundle layer, so an admin's server
// action could clear one copy while pages and API routes kept answering from
// another for up to a minute after a publication.
async function loadPlans(db: Db): Promise<Partial<Record<PlanId, PlanState>>> {
  const docs = await collections(db).plans.find({}, { projection: { active: 1, features: 1, limits: 1, dailyLimits: 1, learn: 1 } }).toArray();
  return Object.fromEntries(docs.filter((p) => isPlanId(p._id)).map((p) => [p._id, planStateOf(p)])) as Partial<Record<PlanId, PlanState>>;
}

/** The plans in force, as entitlements read them (the admin page shows them when the catalog cannot be read). */
export const getPlanStates = loadPlans;

/** What each plan includes as published, for pages that compare plans (public, no account needed). */
export async function getPlanOffer(db: Db): Promise<PlanOffer> {
  return offerOf(await loadPlans(db));
}

/**
 * The same for public pages that only describe the plans (landing, sign-in,
 * pricing): null when the database cannot be read, and the page then uses
 * wording that holds whatever the plans are, rather than failing.
 */
export async function describablePlanOffer(db: () => Db): Promise<PlanOffer | null> {
  try {
    return await getPlanOffer(db());
  } catch (error) {
    log.warn('plans.offer_unavailable', { error });
    return null;
  }
}

/** Entitlements of an account, read entirely from the database. */
export async function getEntitlements(db: Db, userId: ObjectId, now = new Date()): Promise<Entitlements> {
  const { users, subscriptions } = collections(db);
  const [user, subscription, plans, usage, dailyUsage, grant] = await Promise.all([
    users.findOne({ _id: userId }, { projection: { status: 1, role: 1, plan: 1 } }),
    subscriptions.findOne({ userId }, { sort: { updatedAt: -1 }, projection: { planId: 1, status: 1, currentPeriodEnd: 1 } }),
    loadPlans(db),
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

export type FeatureUseResult =
  | { status: 'recorded' }
  | {
      status: 'denied';
      reason: 'not_included' | 'limit_reached';
      missing: FeatureId[];
      /** An export from a Learn item the account may not open (ADR-0017). */
      learnItem?: { id: string; reason: 'module_off' | 'not_in_plan' | 'unavailable' };
    };

/**
 * Authorize one use of `features` right now and count it (a large GIF needs
 * 'export.gif' and 'export.gif_large'). Decided from the database only.
 * Capped features are taken atomically (check and count in one update) and
 * handed back if another feature of the same request is refused, so a cap
 * can never be exceeded, even by simultaneous requests.
 */
export async function authorizeFeatureUse(db: Db, userId: ObjectId, features: FeatureId[], now = new Date()): Promise<FeatureUseResult> {
  return takeFeatures(db, userId, await getEntitlements(db, userId, now), features, now);
}

/**
 * Authorize one export (or other protected operation) from a tool: the tool
 * must be included — checked, never counted, so an export never uses up
 * anything of the tool — and then each export feature is authorized and
 * counted as in authorizeFeatureUse. With no export features it only checks
 * the tool (e.g. saving a project file). An export made from a Learn item's
 * reference (`learnItem`) also needs that item open to the account, checked
 * before anything is counted. Decided from the database only.
 */
export async function authorizeToolUse(
  db: Db,
  userId: ObjectId,
  use: { tool: ToolFeatureId | null; features: ExportFeatureId[]; learnItem?: string | null },
  now = new Date(),
): Promise<FeatureUseResult> {
  const entitlements = await getEntitlements(db, userId, now);
  if (use.tool && !includes(entitlements, use.tool)) return { status: 'denied', reason: 'not_included', missing: [use.tool] };
  if (use.learnItem) {
    const state = await learnItemState(db, entitlements, use.learnItem);
    if (state.status !== 'open') {
      return { status: 'denied', reason: 'not_included', missing: [], learnItem: { id: use.learnItem, reason: state.status === 'locked' ? state.reason : 'unavailable' } };
    }
  }
  if (use.features.length === 0) return entitlements.accountActive ? { status: 'recorded' } : { status: 'denied', reason: 'not_included', missing: [] };
  return takeFeatures(db, userId, entitlements, use.features, now);
}

async function takeFeatures(db: Db, userId: ObjectId, entitlements: Entitlements, features: FeatureId[], now: Date): Promise<FeatureUseResult> {
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
