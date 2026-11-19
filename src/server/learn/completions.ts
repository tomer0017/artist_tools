import 'server-only';
import { ObjectId, type Db } from 'mongodb';
import { itemsOf, type Localized } from '@/lib/learn/model';
import { collections, type LearnCompletionDoc } from '@/server/db/collections';
import type { Entitlements } from '@/server/entitlements';
import { liveLearn } from './live';

// ─── Learn completions: a person's own history (ADR-0018) ─────────────────────
// "Mark as completed" on an exercise or a challenge: optional, several per
// item, removable one by one. Recorded only for an item open to the account
// at that moment (the same resolver as every Learn request); read and removed
// only by their owner. No streaks, scores or targets are derived from them:
// the studio shows a tick with a count, "Continue" and the history page.
// Class mode never calls any of this (the browser does not ask). In the
// account's data download; removed with the account (ADR-0010).

/** One page of the history page. */
export const HISTORY_PAGE = 50;
/**
 * Completions one account may keep: years of daily practice, far beyond any
 * real use, so a history (read and counted on every Learn visit) stays small.
 */
export const MAX_COMPLETIONS = 10_000;

export interface CompletionView {
  id: string;
  itemId: string;
  completedAt: string;
}

const view = (doc: Pick<LearnCompletionDoc, '_id' | 'itemId' | 'completedAt'>): CompletionView => ({
  id: doc._id.toHexString(),
  itemId: doc.itemId,
  completedAt: doc.completedAt.toISOString(),
});

export type RecordResult =
  | { status: 'recorded'; completion: CompletionView }
  /** The item exists for this account but is locked (its module or its plan's rule). */
  | { status: 'locked'; reason: 'module_off' | 'not_in_plan' }
  /** Unknown, unpublished (to anyone but admins), or the account is not active. */
  | { status: 'not_found' }
  /** The history holds MAX_COMPLETIONS already. */
  | { status: 'full' };

/** Record that the person completed an item now: only an item they may open at this moment. */
export async function recordCompletion(db: Db, userId: ObjectId, entitlements: Entitlements, itemId: string, now = new Date()): Promise<RecordResult> {
  const { view: access, version } = await liveLearn(db, entitlements);
  const state = access.state(itemId);
  if (state.status === 'hidden') return { status: 'not_found' };
  if (state.status === 'locked') return { status: 'locked', reason: state.reason };
  if ((await collections(db).learnCompletions.countDocuments({ userId }, { limit: MAX_COMPLETIONS })) >= MAX_COMPLETIONS) return { status: 'full' };
  const doc: LearnCompletionDoc = { _id: new ObjectId(), userId, itemId, completedAt: now, contentVersion: version };
  await collections(db).learnCompletions.insertOne(doc);
  return { status: 'recorded', completion: view(doc) };
}

/** Remove one of the person's own completions; false when there is no such entry of theirs. */
export async function removeCompletion(db: Db, userId: ObjectId, completionId: ObjectId): Promise<boolean> {
  const { deletedCount } = await collections(db).learnCompletions.deleteOne({ _id: completionId, userId });
  return deletedCount === 1;
}

/** Where the next page of the history starts: the last entry's time and id. */
const cursorOf = (doc: Pick<LearnCompletionDoc, '_id' | 'completedAt'>) => `${doc.completedAt.getTime()}.${doc._id.toHexString()}`;

/** A cursor from the browser: `<ms>.<24 hex>`, or null when malformed. */
export function parseCursor(value: string | null): { at: Date; id: ObjectId } | null {
  const match = value ? /^(\d{1,15})\.([0-9a-f]{24})$/.exec(value) : null;
  return match ? { at: new Date(Number(match[1])), id: new ObjectId(match[2]) } : null;
}

/** The person's completions, newest first, a page at a time. */
export async function completionHistory(db: Db, userId: ObjectId, options: { after?: { at: Date; id: ObjectId } | null; limit?: number } = {}) {
  const limit = Math.min(Math.max(options.limit ?? HISTORY_PAGE, 1), HISTORY_PAGE);
  const after = options.after;
  const docs = await collections(db)
    .learnCompletions.find(
      { userId, ...(after ? { $or: [{ completedAt: { $lt: after.at } }, { completedAt: after.at, _id: { $lt: after.id } }] } : {}) },
      { sort: { completedAt: -1, _id: -1 }, limit: limit + 1, projection: { itemId: 1, completedAt: 1 } },
    )
    .toArray();
  const page = docs.slice(0, limit);
  return { completions: page.map(view), next: docs.length > limit ? cursorOf(page[page.length - 1]) : null };
}

export interface CompletionSummary {
  /** Per item: how many times, and the latest. */
  items: Record<string, { count: number; last: string }>;
  /** Every completion of the person. */
  total: number;
}

/** How often, and when last, the person completed each item (the ticks, "Continue", Random's "recently done"). */
export async function completionSummary(db: Db, userId: ObjectId): Promise<CompletionSummary> {
  const rows = await collections(db)
    .learnCompletions.aggregate<{ _id: string; count: number; last: Date }>([
      { $match: { userId } },
      { $group: { _id: '$itemId', count: { $sum: 1 }, last: { $max: '$completedAt' } } },
    ])
    .toArray();
  return {
    items: Object.fromEntries(rows.map((row) => [row._id, { count: row.count, last: row.last.toISOString() }])),
    total: rows.reduce((sum, row) => sum + row.count, 0),
  };
}

/**
 * Titles for the items in a person's history, so the history page can name
 * them whatever their access is now, exactly as lists would: open, or locked
 * behind a module some plan offers (lists show those titles). Any other item
 * (unpublished, or in a module no plan offers) has none.
 */
export async function historyTitles(db: Db, entitlements: Entitlements, itemIds: string[]): Promise<Record<string, { title: Localized; kind: 'exercise' | 'challenge' } | null>> {
  const { content, view: access } = await liveLearn(db, entitlements);
  const items = new Map(itemsOf(content).map((item) => [item.id, item]));
  return Object.fromEntries(
    [...new Set(itemIds)].map((id) => {
      const item = items.get(id);
      // As lists name items: open, or locked behind a module some plan offers.
      return [id, item && access.listed(id) ? { title: item.title, kind: item.kind } : null];
    }),
  );
}
