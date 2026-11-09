import 'server-only';
import type { Db, ObjectId } from 'mongodb';
import { collections, isDuplicateKeyError, type FeatureId } from '@/server/db/collections';

/** Usage is counted per calendar month in UTC: '2026-11'. */
export const usagePeriod = (date = new Date()): string => date.toISOString().slice(0, 7);

/** Atomically add to a user's usage of a feature for the current month. */
export async function recordUsage(db: Db, userId: ObjectId, feature: FeatureId, quantity = 1, now = new Date()): Promise<void> {
  const write = () =>
    collections(db).usage.updateOne(
      { userId, feature, period: usagePeriod(now) },
      { $inc: { quantity }, $set: { lastAt: now }, $setOnInsert: { firstAt: now } },
      { upsert: true },
    );
  try {
    await write();
  } catch (error) {
    // Two first-of-the-month writes can race to insert the same document; the
    // loser retries as a plain increment.
    if (!isDuplicateKeyError(error)) throw error;
    await write();
  }
}

/** A user's usage per feature for one month. */
export async function getUsage(db: Db, userId: ObjectId, period = usagePeriod()): Promise<Partial<Record<FeatureId, number>>> {
  const docs = await collections(db).usage.find({ userId, period }, { projection: { feature: 1, quantity: 1 } }).toArray();
  return Object.fromEntries(docs.map((d) => [d.feature, d.quantity]));
}
