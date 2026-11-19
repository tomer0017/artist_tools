import 'server-only';
import type { Db } from 'mongodb';
import { LEARN_FEATURE_IDS } from '@/lib/plans';
import { learnAccess, type ItemState, type LearnAccessView, type LearnViewer } from '@/lib/learn/access';
import type { LearnContent, LearnItem } from '@/lib/learn/model';
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
