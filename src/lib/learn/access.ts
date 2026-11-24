import { LEARN_FEATURE_IDS, type PlanId } from '@/lib/plans';
import { LEARN_MODULE, NO_RULES, isAccessMode, itemsOf, orderedItems, type AccessMode, type ContentLike, type ItemOf, type LearnCollection, type LearnRules } from './model';

// ─── Who may open which Learn item (ADR-0023, replacing ADR-0017's rules) ────
// One decision, used by every Learn route, the asset route, completions and
// export authorization on the server (src/server/learn/live.ts), and by
// Admin → Learn to show what learners get. Pure: the server builds the viewer
// from the request's fresh entitlements (src/server/entitlements.ts), which
// remain the only place that reads plans. Precedence, complete:
//   1. an account that is not active (signed out, suspended) gets nothing;
//   2. an archived or Blocked item is hidden from everyone, admins included
//      (Admin → Learn still edits and previews it);
//   3. an administrator opens everything else;
//   4. an Admin only item is hidden from everyone else;
//   5. a Free item opens for every active account;
//   6. a Pro item opens on Pro, and is listed as locked to everyone else.
// The item's own mode is the only setting. An item written before modes has
// none: the old plan rules give it the access it had (accessModeOf).

/** The published plans' old Learn rules (ADR-0017): only for items that have no mode of their own. */
export interface LegacyPlan {
  /** The Learn modules the plan includes. */
  modules: readonly string[];
  rules: LearnRules;
}
export type LegacyLearn = Record<PlanId, LegacyPlan | null>;
export const NO_LEGACY: LegacyLearn = { free: null, pro: null };

/** The plans in force as the old rules saw them: a plan switched off has none. */
export function legacyLearnOf(plans: Partial<Record<PlanId, { active: boolean; features: readonly string[]; learn?: { rules: LearnRules } } | undefined>>): LegacyLearn {
  const plan = (planId: PlanId): LegacyPlan | null => {
    const state = plans[planId];
    if (!state?.active) return null;
    return { modules: LEARN_FEATURE_IDS.filter((f) => state.features.includes(f)), rules: state.learn ? structuredClone(state.learn.rules) : NO_RULES() };
  };
  return { free: plan('free'), pro: plan('pro') };
}

export interface LearnViewer {
  active: boolean;
  admin: boolean;
  /** On Pro now: a subscription, a time-limited grant or a plan an admin assigned. */
  pro: boolean;
  legacy: LegacyLearn;
}

/** Why an item is locked: Pro opens it (the reason keeps ADR-0017's name, which the studio and its tests know). */
export type LockReason = 'module_off' | 'not_in_plan';

export type ItemState =
  | { status: 'open' }
  | { status: 'locked'; reason: LockReason }
  /** Unknown, archived, Blocked, Admin only (to anyone but admins), or the account is not active: as if it did not exist. */
  | { status: 'hidden' };

const OPEN: ItemState = { status: 'open' };
const HIDDEN: ItemState = { status: 'hidden' };
const PRO_LOCK: ItemState = { status: 'locked', reason: 'not_in_plan' };

type ModeInput = { id: string; collection: LearnCollection; published: boolean; access?: unknown };

/** Whether a plan's old rules open a published item: its module, then All or its Selected list. */
function ruleOpens(plan: LegacyPlan | null, item: ModeInput): boolean {
  if (!plan || !plan.modules.includes(LEARN_MODULE[item.collection])) return false;
  const rule = plan.rules[item.collection];
  return rule.mode === 'all' || (rule.mode === 'selected' && rule.items.includes(item.id));
}

/**
 * An item's access mode: its own, or, for an item written before modes, what
 * the old rules gave it — unpublished: Admin only; opened by Free's rules:
 * Free; by Pro's only: Pro; by none: Admin only. A mode this release does not
 * know counts as Blocked (never more than was written).
 */
export function accessModeOf(item: ModeInput, legacy: LegacyLearn): AccessMode {
  if (item.access !== undefined) return isAccessMode(item.access) ? item.access : 'blocked';
  if (!item.published) return 'admin';
  if (ruleOpens(legacy.free, item)) return 'free';
  if (ruleOpens(legacy.pro, item)) return 'pro';
  return 'admin';
}

export interface LearnAccessView<Item = unknown> {
  state(itemId: string): ItemState;
  canOpen(itemId: string): boolean;
  /** Whether lists show the item at all (open, or locked behind Pro). */
  listed(itemId: string): boolean;
  /** Whether its thumbnail may be shown: open, or listed while locked (a Pro item's teaser). */
  thumbnail(itemId: string): boolean;
  /** The item's mode (null: unknown ID). */
  mode(itemId: string): AccessMode | null;
  /** A collection's items as lists may show them, in order. */
  list(collection: LearnCollection): { item: Item; state: ItemState }[];
  /** The IDs this viewer opens, per collection, in order. */
  opens(collection: LearnCollection): string[];
}

export function learnAccess<E extends ContentLike['exercises'][number], C extends ContentLike['challenges'][number]>(
  viewer: LearnViewer,
  content: ContentLike<E, C>,
): LearnAccessView<ItemOf<E, C>> {
  const items = new Map(itemsOf(content).map((item) => [item.id, item]));
  const modes = new Map([...items.values()].map((item) => [item.id, accessModeOf(item, viewer.legacy)]));
  const state = (itemId: string): ItemState => {
    const item = items.get(itemId);
    if (!viewer.active || !item) return HIDDEN;
    const mode = modes.get(itemId)!;
    if (item.archived === true || mode === 'blocked') return HIDDEN;
    if (viewer.admin) return OPEN;
    if (mode === 'admin') return HIDDEN;
    if (mode === 'free') return OPEN;
    return viewer.pro ? OPEN : PRO_LOCK;
  };
  const listed = (itemId: string): boolean => state(itemId).status !== 'hidden';
  return {
    state,
    canOpen: (itemId) => state(itemId).status === 'open',
    listed,
    thumbnail: listed,
    mode: (itemId) => modes.get(itemId) ?? null,
    list: (collection) => orderedItems(content, collection).filter((item) => listed(item.id)).map((item) => ({ item, state: state(item.id) })),
    opens: (collection) => orderedItems(content, collection).filter((item) => state(item.id).status === 'open').map((item) => item.id),
  };
}
