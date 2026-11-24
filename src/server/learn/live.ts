import 'server-only';
import { createHash } from 'node:crypto';
import type { Db } from 'mongodb';
import type { LearnSummary } from '@/lib/account';
import { isAccessMode, LEARN_COLLECTIONS, type AccessMode, type ContentLike, type LearnContent, type LearnItem } from '@/lib/learn/model';
import { learnAccess, legacyLearnOf, type ItemState, type LearnAccessView, type LearnViewer } from '@/lib/learn/access';
import type { PlanId } from '@/lib/plans';
import { collections } from '@/server/db/collections';
import type { Entitlements, PlanState } from '@/server/entitlements';
import { getPublished } from '@/server/config/versions';
import { learnContentSpec, publishedLearnContent } from './content';

// The Learn decision for one request (ADR-0017, ADR-0023): the account's
// fresh entitlements (src/server/entitlements.ts, the only reader of plans)
// and the published content, read on every request, through one resolver
// (src/lib/learn/access.ts). Each item's own access mode decides; content
// that cannot be read refuses everything.

/** What the resolver needs from entitlements. */
export function learnViewerOf(entitlements: Entitlements): LearnViewer {
  return {
    active: entitlements.accountActive,
    admin: entitlements.access === 'admin',
    pro: entitlements.access === 'pro',
    legacy: entitlements.legacyLearn,
  };
}

/**
 * What an active, non-admin account would get on `planId` as published: the
 * same resolver, on that plan. Used to say what upgrading opens (a locked
 * item that Pro opens, how many more lessons).
 */
export function planLearnViewer(_entitlements: Entitlements, plans: Partial<Record<PlanId, PlanState>>, planId: PlanId): LearnViewer {
  return { active: true, admin: false, pro: planId === 'pro' && plans.pro?.active === true, legacy: legacyLearnOf(plans) };
}

type OutlineItem = { id: string; collection: 'curriculum' | 'color'; groupId: string; order: number; published: boolean; access?: AccessMode; archived?: boolean };
type OutlineChallenge = Omit<OutlineItem, 'collection'>;

/**
 * Only what the summary needs of the published content (IDs, collections,
 * modes): read with a projection, since the account summary is asked for
 * often. Anything malformed is left out (never shown more than it says).
 */
export async function publishedOutline(db: Db): Promise<{ version: number | null; content: ContentLike<OutlineItem, OutlineChallenge> }> {
  const doc = await collections(db).configVersions.findOne(
    { kind: 'learn_content', status: 'published' },
    {
      projection: {
        version: 1,
        'document.exercises.id': 1,
        'document.exercises.collection': 1,
        'document.exercises.published': 1,
        'document.exercises.access': 1,
        'document.exercises.archived': 1,
        'document.challenges.id': 1,
        'document.challenges.published': 1,
        'document.challenges.access': 1,
        'document.challenges.archived': 1,
      },
    },
  );
  const document = (doc?.document ?? {}) as { exercises?: unknown[]; challenges?: unknown[] };
  const valid = (raw: unknown): raw is Record<string, unknown> =>
    typeof raw === 'object' && raw !== null && typeof (raw as { id?: unknown }).id === 'string' && typeof (raw as { published?: unknown }).published === 'boolean';
  const modeOk = (raw: Record<string, unknown>) => raw.access === undefined || isAccessMode(raw.access);
  const exercises: OutlineItem[] = (Array.isArray(document.exercises) ? document.exercises : [])
    .filter(valid)
    .filter((raw) => (raw.collection === 'curriculum' || raw.collection === 'color') && modeOk(raw))
    .map((raw) => ({ id: raw.id as string, collection: raw.collection as 'curriculum' | 'color', groupId: '', order: 0, published: raw.published as boolean, access: raw.access as AccessMode | undefined, archived: raw.archived === true }));
  const challenges: OutlineChallenge[] = (Array.isArray(document.challenges) ? document.challenges : [])
    .filter(valid)
    .filter(modeOk)
    .map((raw) => ({ id: raw.id as string, groupId: '', order: 0, published: raw.published as boolean, access: raw.access as AccessMode | undefined, archived: raw.archived === true }));
  return { version: doc?.version ?? null, content: { exercises, challenges } };
}

/**
 * What the studio shows of Learn for this account (ADR-0018, ADR-0023):
 * whether Learn appears at all, and each collection as open (it opens at
 * least one item), locked (it only lists Pro items for this account) or
 * absent (nothing in it for this account). The key changes with the content
 * version, so an edit or an access change reaches open Learn screens on
 * their next check.
 */
export function learnSummaryOf(entitlements: Entitlements, outline: { version: number | null; content: ContentLike }): LearnSummary {
  const viewer = learnViewerOf(entitlements);
  const view = learnAccess(viewer, outline.content);
  const modules = Object.fromEntries(
    LEARN_COLLECTIONS.map((collection) => {
      const rows = view.list(collection);
      const state = rows.length === 0 ? null : rows.some((row) => row.state.status === 'open') ? 'open' : 'locked';
      return [collection, state];
    }),
  ) as LearnSummary['modules'];
  const who = !viewer.active ? 'none' : viewer.admin ? 'admin' : viewer.pro ? 'pro' : 'free';
  const key = createHash('sha256').update(JSON.stringify([modules, who, outline.version])).digest('base64url').slice(0, 16);
  return { visible: Object.values(modules).some((state) => state !== null), modules, key };
}

export interface LiveLearn {
  content: LearnContent;
  version: number | null;
  view: LearnAccessView<LearnItem>;
}

/** The published content and what this account may do with it. */
export async function liveLearn(db: Db, entitlements: Entitlements): Promise<LiveLearn> {
  const [content, published] = await Promise.all([publishedLearnContent(db), getPublished(db, learnContentSpec)]);
  return { content, version: published?.version ?? null, view: learnAccess(learnViewerOf(entitlements), content) };
}

/** One item's state for this account (worksheet exports from a Learn reference need it open). */
export async function learnItemState(db: Db, entitlements: Entitlements, itemId: string): Promise<ItemState> {
  return learnAccess(learnViewerOf(entitlements), await publishedLearnContent(db)).state(itemId);
}
