import { LEARN_MODULE, itemsOf, orderedItems, type ContentLike, type ItemOf, type LearnAccess, type LearnCollection } from './model';

// ─── Who may open which Learn item (ADR-0017) ─────────────────────────────────
// One decision, used by every Learn route, the asset route and export
// authorization on the server (src/server/learn/live.ts), and by the admin
// editor to show what a plan would open. Pure: the server builds the viewer
// from the request's fresh entitlements (src/server/entitlements.ts), which
// remain the only place that reads plans. Precedence, complete:
//   1. an account that is not active (signed out, suspended) gets nothing;
//   2. an administrator opens everything, unpublished items included;
//   3. an unpublished (or unknown) item is hidden from everyone else;
//   4. a module missing from the plan in force locks every item of it;
//   5. then the plan's rule for the collection: All, None or the Selected list.

export interface LearnViewer {
  active: boolean;
  admin: boolean;
  /** Module features the plan in force includes (features switched off for everyone already removed). */
  modules: readonly string[];
  /** Module features some plan includes as published: a module no plan offers is not even listed. */
  offered: readonly string[];
  access: LearnAccess;
}

export type LockReason = 'module_off' | 'not_in_plan';

export type ItemState =
  | { status: 'open' }
  | { status: 'locked'; reason: LockReason }
  /** Unknown, unpublished (to anyone but admins), or the account is not active: as if it did not exist. */
  | { status: 'hidden' };

const OPEN: ItemState = { status: 'open' };
const HIDDEN: ItemState = { status: 'hidden' };

export interface LearnAccessView<Item = unknown> {
  state(itemId: string): ItemState;
  canOpen(itemId: string): boolean;
  /** Whether lists show the item at all (open, or locked behind a module some plan offers). */
  listed(itemId: string): boolean;
  /** Whether its thumbnail may be shown: open, or listed while locked items show thumbnails. */
  thumbnail(itemId: string): boolean;
  /** A collection's items as lists may show them, in order. */
  list(collection: LearnCollection): { item: Item; state: ItemState }[];
  /** The IDs this viewer opens, per collection (the admin's "effective access"). */
  opens(collection: LearnCollection): string[];
}

export function learnAccess<E extends ContentLike['exercises'][number], C extends ContentLike['challenges'][number]>(
  viewer: LearnViewer,
  content: ContentLike<E, C>,
): LearnAccessView<ItemOf<E, C>> {
  const items = new Map(itemsOf(content).map((item) => [item.id, item]));
  const state = (itemId: string): ItemState => {
    const item = items.get(itemId);
    if (!viewer.active || !item) return HIDDEN;
    if (viewer.admin) return OPEN;
    if (!item.published) return HIDDEN;
    if (!viewer.modules.includes(LEARN_MODULE[item.collection])) return { status: 'locked', reason: 'module_off' };
    const rule = viewer.access.rules[item.collection];
    if (rule.mode === 'all') return OPEN;
    if (rule.mode === 'selected' && rule.items.includes(itemId)) return OPEN;
    return { status: 'locked', reason: 'not_in_plan' };
  };
  const listed = (itemId: string): boolean => {
    const current = state(itemId);
    if (current.status === 'open') return true;
    if (current.status === 'hidden') return false;
    const item = items.get(itemId)!;
    const feature = LEARN_MODULE[item.collection];
    return viewer.modules.includes(feature) || viewer.offered.includes(feature);
  };
  return {
    state,
    canOpen: (itemId) => state(itemId).status === 'open',
    listed,
    thumbnail: (itemId) => state(itemId).status === 'open' || (listed(itemId) && viewer.access.previews === 'thumbnail'),
    list: (collection) => orderedItems(content, collection).filter((item) => listed(item.id)).map((item) => ({ item, state: state(item.id) })),
    opens: (collection) => orderedItems(content, collection).filter((item) => state(item.id).status === 'open').map((item) => item.id),
  };
}
