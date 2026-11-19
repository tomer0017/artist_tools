import 'server-only';
import { createHash } from 'node:crypto';
import type { Db } from 'mongodb';
import { LEARN_FEATURE_IDS } from '@/lib/plans';
import type { LearnSummary } from '@/lib/account';
import { learnAccess, type ItemState, type LearnAccessView, type LearnViewer } from '@/lib/learn/access';
import { LEARN_COLLECTIONS, LEARN_MODULE, type LearnContent, type LearnItem } from '@/lib/learn/model';
import type { Entitlements } from '@/server/entitlements';
import { getPublished } from '@/server/config/versions';
import { learnContentSpec, publishedLearnContent } from './content';

// The Learn decision for one request (ADR-0017): the account's fresh
// entitlements (src/server/entitlements.ts, the only reader of plans) and the
// published content, read on every request, through one resolver
// (src/lib/learn/access.ts). Content that cannot be read refuses everything.

/** What the resolver needs from entitlements. */
export function learnViewerOf(entitlements: Entitlements): LearnViewer {
  const offered = new Set([...entitlements.offer.free, ...entitlements.offer.pro]);
  return {
    active: entitlements.accountActive,
    admin: entitlements.access === 'admin',
    modules: LEARN_FEATURE_IDS.filter((f) => entitlements.features.includes(f)),
    offered: LEARN_FEATURE_IDS.filter((f) => offered.has(f)),
    access: entitlements.learn,
  };
}

/**
 * What the studio shows of Learn for this account (ADR-0018): whether Learn
 * appears at all, and each collection as open, locked (offered by another
 * plan) or absent. A module no published plan offers is not shown, so Learn
 * stays invisible to everyone but admins until a module is published.
 */
export function learnSummaryOf(entitlements: Entitlements): LearnSummary {
  const viewer = learnViewerOf(entitlements);
  const modules = Object.fromEntries(
    LEARN_COLLECTIONS.map((collection) => {
      const feature = LEARN_MODULE[collection];
      const state = !viewer.active ? null : viewer.admin || viewer.modules.includes(feature) ? 'open' : viewer.offered.includes(feature) ? 'locked' : null;
      return [collection, state];
    }),
  ) as LearnSummary['modules'];
  const key = createHash('sha256').update(JSON.stringify([modules, viewer.admin ? 'admin' : viewer.access])).digest('base64url').slice(0, 16);
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
