import 'server-only';
import type { Db } from 'mongodb';
import type { ItemState } from '@/lib/learn/access';
import type { LearnItem } from '@/lib/learn/model';
import { collections, type LearnAssetDoc } from '@/server/db/collections';

// What the Learn routes send (ADR-0017). An open item: everything for its
// card. A locked item in a list: its ID, title, place and lock, and a
// thumbnail only where previews allow — never its instructions, guide or
// references. Built on the server from what the account may see, so locked
// content is absent from the response, not hidden in it.

export async function assetsFor(db: Db, ids: string[]): Promise<Map<string, LearnAssetDoc>> {
  if (ids.length === 0) return new Map();
  return new Map((await collections(db).learnAssets.find({ _id: { $in: [...new Set(ids)] } }).toArray()).map((doc) => [doc._id, doc]));
}

/**
 * The fields of an item learners receive, by name. Content is read tolerantly
 * (fields a newer release adds are kept), so anything else an item carries,
 * such as a reviewer's note, is never sent (ADR-0018).
 */
const EXERCISE_FIELDS = ['id', 'kind', 'collection', 'groupId', 'order', 'title', 'objective', 'materials', 'instruction', 'guide', 'mistake', 'success', 'worksheet', 'tools'] as const;
const CHALLENGE_FIELDS = ['id', 'kind', 'collection', 'groupId', 'order', 'title', 'prompt', 'level', 'skill', 'skillArea', 'reference', 'medium', 'quick', 'tools'] as const;

/** The whole item, its references with their thumbnails and sizes. */
export function fullItem(item: LearnItem, assets: Map<string, LearnAssetDoc>, admin: boolean) {
  const fields: readonly string[] = item.kind === 'exercise' ? EXERCISE_FIELDS : CHALLENGE_FIELDS;
  const known = Object.fromEntries(fields.filter((field) => field in item).map((field) => [field, (item as unknown as Record<string, unknown>)[field]]));
  return {
    ...(known as Omit<LearnItem, 'published' | 'references'>),
    ...(admin ? { published: item.published } : {}),
    references: item.references.map((ref) => {
      const doc = assets.get(ref.assetId);
      return {
        assetId: ref.assetId,
        alt: ref.alt,
        ...(ref.credit ? { credit: ref.credit } : {}),
        thumbnailAssetId: doc?.thumbnailAssetId ?? null,
        width: doc?.width ?? null,
        height: doc?.height ?? null,
      };
    }),
  };
}

/** One row of a list: open or locked, with a thumbnail only when allowed. */
export function listEntry(item: LearnItem, state: ItemState, thumbnail: boolean, assets: Map<string, LearnAssetDoc>, admin: boolean) {
  const first = item.references[0];
  return {
    id: item.id,
    kind: item.kind,
    collection: item.collection,
    groupId: item.groupId,
    order: item.order,
    title: item.title,
    ...(item.kind === 'challenge' ? { level: item.level, quick: item.quick, medium: item.medium, reference: item.reference } : {}),
    ...(admin ? { published: item.published } : {}),
    open: state.status === 'open',
    lock: state.status === 'locked' ? state.reason : null,
    thumbnailAssetId: thumbnail && first ? (assets.get(first.assetId)?.thumbnailAssetId ?? null) : null,
  };
}
