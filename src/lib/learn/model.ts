import type { ToolId } from '@/lib/account';
import type { LearnFeatureId, PlanId } from '@/lib/plans';

// ─── Learn: the content model and the access rules (ADR-0017) ────────────────
// Shared by the server, which decides, and the admin editors, which show what
// the server will decide. Content lives in the database as versioned
// publications (kind `learn_content`) and is never committed: the repository
// is public. IDs are stable and never reused; titles and order are separate.

/** Collections, each opened by its own module feature. */
export const LEARN_COLLECTIONS = ['curriculum', 'color', 'challenges'] as const;
export type LearnCollection = (typeof LEARN_COLLECTIONS)[number];

export const LEARN_MODULE: Record<LearnCollection, LearnFeatureId> = {
  curriculum: 'learn.curriculum',
  color: 'learn.color',
  challenges: 'learn.challenges',
};

export const COLLECTION_LABELS: Record<LearnCollection, string> = {
  curriculum: 'Drawing curriculum',
  color: 'Color module',
  challenges: 'Challenges',
};

/** D-OBS-02 (drawing curriculum), C-COL-01 (colour module), CH-017 (challenges). */
export const EXERCISE_ID = /^[DC]-[A-Z]{2,8}-\d{2}$/;
export const CHALLENGE_ID = /^CH-\d{3}$/;
export const ITEM_ID = /^(?:[DC]-[A-Z]{2,8}-\d{2}|CH-\d{3})$/;
export const GROUP_ID = /^[a-z][a-z0-9-]{1,31}$/;
/** An asset is named by the SHA-256 of its bytes: 64 lowercase hex characters, never a path. */
export const ASSET_ID = /^[0-9a-f]{64}$/;

export const isItemId = (value: unknown): value is string => typeof value === 'string' && ITEM_ID.test(value);

/** The collection an item ID belongs to: the ID's prefix says it (D- curriculum, C- colour, CH- challenges). */
export function collectionOfId(id: string): LearnCollection | null {
  if (CHALLENGE_ID.test(id)) return 'challenges';
  if (EXERCISE_ID.test(id)) return id.startsWith('D-') ? 'curriculum' : 'color';
  return null;
}

export type Localized = { en: string; he: string };

export interface AssetRef {
  assetId: string;
  alt: Localized;
  credit?: Localized;
}

export interface LearnGroup {
  id: string;
  collection: LearnCollection;
  order: number;
  title: Localized;
  summary?: Localized;
}

export type WorksheetSpec = { kind: 'none' } | { kind: 'generated' } | { kind: 'static'; assetId: string };

export interface LearnExercise {
  id: string;
  collection: 'curriculum' | 'color';
  groupId: string;
  /** Display order within the collection (First N follows it). */
  order: number;
  /** Unpublished items are visible to admins only. */
  published: boolean;
  title: Localized;
  objective: Localized;
  materials: Localized;
  /** The short card text. */
  instruction: Localized;
  /** "More help". */
  guide?: Localized;
  mistake: { mistake: Localized; fix: Localized };
  success: Localized;
  references: AssetRef[];
  worksheet: WorksheetSpec;
  tools: ToolId[];
}

export const CHALLENGE_LEVELS = ['beginner', 'intermediate', 'advanced'] as const;
export const REFERENCE_KINDS = ['life', 'own_photo', 'provided', 'memory'] as const;
export const MEDIUMS = ['pencil', 'both'] as const;

export interface LearnChallenge {
  id: string;
  groupId: string;
  order: number;
  published: boolean;
  title: Localized;
  prompt: Localized;
  level: (typeof CHALLENGE_LEVELS)[number];
  skill: Localized;
  /** 1–10, the skill areas of docs/learn/03-challenges.md. */
  skillArea: number;
  reference: (typeof REFERENCE_KINDS)[number];
  references: AssetRef[];
  medium: (typeof MEDIUMS)[number];
  quick: boolean;
  tools: ToolId[];
}

export interface LearnContent {
  groups: LearnGroup[];
  exercises: LearnExercise[];
  challenges: LearnChallenge[];
}

export const emptyContent = (): LearnContent => ({ groups: [], exercises: [], challenges: [] });

/** What the access rules and the editors need of an item: its place and whether it is published. */
type ExerciseLike = Pick<LearnExercise, 'id' | 'collection' | 'groupId' | 'order' | 'published'>;
type ChallengeLike = Pick<LearnChallenge, 'id' | 'groupId' | 'order' | 'published'>;

/** Content, or an outline of it (the admin editors get IDs, places and titles, not the items' text). */
export interface ContentLike<E extends ExerciseLike = ExerciseLike, C extends ChallengeLike = ChallengeLike> {
  exercises: E[];
  challenges: C[];
}

export type ItemOf<E, C> = (E & { kind: 'exercise' }) | (C & { kind: 'challenge'; collection: 'challenges' });
export type LearnItem = ItemOf<LearnExercise, LearnChallenge>;

/** Every item of a content document, with its kind and collection. */
export function itemsOf<E extends ExerciseLike, C extends ChallengeLike>(content: ContentLike<E, C>): ItemOf<E, C>[] {
  return [
    ...content.exercises.map((e) => ({ ...e, kind: 'exercise' as const })),
    ...content.challenges.map((c) => ({ ...c, kind: 'challenge' as const, collection: 'challenges' as const })),
  ];
}

/** A collection's items in display order (order, then ID): the order First N counts in. */
export function orderedItems<E extends ExerciseLike, C extends ChallengeLike>(content: ContentLike<E, C>, collection: LearnCollection): ItemOf<E, C>[] {
  return itemsOf(content)
    .filter((item) => item.collection === collection)
    .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
}

/** The outline of content the admin editors work with: IDs, places, titles and levels; no instructions. */
export interface ContentOutline extends ContentLike<
  ExerciseLike & { title: Localized },
  ChallengeLike & { title: Localized; level: LearnChallenge['level'] }
> {
  groups: Pick<LearnGroup, 'id' | 'collection' | 'order' | 'title'>[];
}

export const outlineOf = (content: LearnContent): ContentOutline => ({
  groups: content.groups.map(({ id, collection, order, title }) => ({ id, collection, order, title })),
  exercises: content.exercises.map(({ id, collection, groupId, order, published, title }) => ({ id, collection, groupId, order, published, title })),
  challenges: content.challenges.map(({ id, groupId, order, published, title, level }) => ({ id, groupId, order, published, title, level })),
});

// ─── Access rules (in the plan catalog, edited in Admin → Plans) ─────────────

/** How a Selected list was made: shown to admins; the server enforces only the list. */
export type SelectionOrigin = { by: 'first'; n: number; contentVersion: number | null } | { by: 'group'; groupId: string; contentVersion: number | null } | { by: 'pick' };

/**
 * One rule per collection and plan. All: every published item, including
 * later ones. None: no item. Selected: exactly the listed items, frozen when
 * published, so reordering or adding content never changes anyone's access.
 */
export type LearnRule = { mode: 'all' } | { mode: 'none' } | { mode: 'selected'; items: string[]; made?: SelectionOrigin };

/** What a locked item shows in lists: its title, or its title and a small thumbnail. */
export type LearnPreviews = 'title' | 'thumbnail';
export const LEARN_PREVIEWS = ['title', 'thumbnail'] as const satisfies readonly LearnPreviews[];

export type LearnRules = Record<LearnCollection, LearnRule>;

/** The catalog's Learn section: a rule per plan and collection, and what locked items show. */
export interface LearnSection {
  access: Record<PlanId, LearnRules>;
  previews: LearnPreviews;
}

/** What one plan's accounts get, as written to `plans` and read by entitlements. */
export interface LearnAccess {
  rules: LearnRules;
  previews: LearnPreviews;
}

export const NO_RULES = (): LearnRules => ({ curriculum: { mode: 'none' }, color: { mode: 'none' }, challenges: { mode: 'none' } });

/** A catalog without a Learn section (every catalog before M4) reads as this: nothing opens, titles only (ADR-0017). */
export const defaultLearnSection = (): LearnSection => ({ access: { free: NO_RULES(), pro: NO_RULES() }, previews: 'title' });

export const NO_LEARN_ACCESS = (): LearnAccess => ({ rules: NO_RULES(), previews: 'title' });

/** Admins: every item, drafts included (the resolver also checks the role first). */
export const ALL_LEARN_ACCESS = (): LearnAccess => ({ rules: { curriculum: { mode: 'all' }, color: { mode: 'all' }, challenges: { mode: 'all' } }, previews: 'thumbnail' });

export const sameRule = (a: LearnRule, b: LearnRule): boolean =>
  a.mode === b.mode && (a.mode !== 'selected' || (b.mode === 'selected' && a.items.length === b.items.length && a.items.every((id, i) => id === b.items[i])));

export function ruleText(rule: LearnRule): string {
  if (rule.mode === 'all') return 'All';
  if (rule.mode === 'none') return 'None';
  const how = rule.made?.by === 'first' ? `First ${rule.made.n}` : rule.made?.by === 'group' ? `group ${rule.made.groupId}` : 'Selected';
  return `${how} (${rule.items.length === 0 ? 'no items' : rule.items.join(', ')})`;
}

/** First N, resolved now: the first N published items in the collection's current order. */
export function firstN(content: ContentLike, collection: LearnCollection, n: number): string[] {
  return orderedItems(content, collection)
    .filter((item) => item.published)
    .slice(0, Math.max(0, n))
    .map((item) => item.id);
}

/** A whole group, resolved now: its published items in order. */
export function groupItems(content: ContentLike, collection: LearnCollection, groupId: string): string[] {
  return orderedItems(content, collection)
    .filter((item) => item.published && item.groupId === groupId)
    .map((item) => item.id);
}

/**
 * Whether a Selected list still says what its origin would give now (the
 * content's order or groups changed since it was made). Only shown to
 * admins: the list itself never changes by this.
 */
export function selectionDrift(content: ContentLike, collection: LearnCollection, rule: LearnRule): string[] | null {
  if (rule.mode !== 'selected' || !rule.made || rule.made.by === 'pick') return null;
  const now = rule.made.by === 'first' ? firstN(content, collection, rule.made.n) : groupItems(content, collection, rule.made.groupId);
  const same = now.length === rule.items.length && now.every((id, i) => id === rule.items[i]);
  return same ? null : now;
}
