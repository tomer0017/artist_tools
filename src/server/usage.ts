import 'server-only';
import type { Db, ObjectId } from 'mongodb';
import { collections, isDuplicateKeyError, type FeatureId } from '@/server/db/collections';

/** Usage is counted per calendar month in UTC ('2026-11') and per UTC day ('2026-11-11'). */
export const usagePeriod = (date = new Date()): string => date.toISOString().slice(0, 7);
export const usageDay = (date = new Date()): string => date.toISOString().slice(0, 10);

/** Atomically add to a user's usage of a feature for one period (no cap). */
export async function countUsage(db: Db, userId: ObjectId, feature: FeatureId, period: string, quantity: number, now: Date) {
  const write = () =>
    collections(db).usage.updateOne(
      { userId, feature, period },
      { $inc: { quantity }, $set: { lastAt: now }, $setOnInsert: { firstAt: now } },
      { upsert: true },
    );
  try {
    await write();
  } catch (error) {
    // Two first writes of a period can race to insert the same document; the
    // loser retries as a plain increment.
    if (!isDuplicateKeyError(error)) throw error;
    await write();
  }
}

/** Atomically add to a user's usage of a feature for the current month and day. */
export async function recordUsage(db: Db, userId: ObjectId, feature: FeatureId, quantity = 1, now = new Date()): Promise<void> {
  await countUsage(db, userId, feature, usagePeriod(now), quantity, now);
  await countUsage(db, userId, feature, usageDay(now), quantity, now);
}

/**
 * Count one use only if it stays within `limit` for the period: the check and
 * the count are one atomic update, so two requests can never both take the
 * last unit. Returns whether the use was counted.
 */
export async function takeUsage(db: Db, userId: ObjectId, feature: FeatureId, period: string, limit: number, now = new Date()): Promise<boolean> {
  const { usage } = collections(db);
  try {
    await usage.updateOne({ userId, feature, period }, { $setOnInsert: { quantity: 0, firstAt: now, lastAt: now } }, { upsert: true });
  } catch (error) {
    if (!isDuplicateKeyError(error)) throw error;
  }
  const { modifiedCount } = await usage.updateOne({ userId, feature, period, quantity: { $lt: limit } }, { $inc: { quantity: 1 }, $set: { lastAt: now } });
  return modifiedCount === 1;
}

/** Undo one counted use (when a request that needed several features is refused). */
export async function giveBackUsage(db: Db, userId: ObjectId, feature: FeatureId, period: string): Promise<void> {
  await collections(db).usage.updateOne({ userId, feature, period, quantity: { $gt: 0 } }, { $inc: { quantity: -1 } });
}

/** A user's usage per feature for one period (a month 'YYYY-MM' or a day 'YYYY-MM-DD'). */
export async function getUsage(db: Db, userId: ObjectId, period = usagePeriod()): Promise<Partial<Record<FeatureId, number>>> {
  const docs = await collections(db).usage.find({ userId, period }, { projection: { feature: 1, quantity: 1 } }).toArray();
  return Object.fromEntries(docs.map((d) => [d.feature, d.quantity]));
}
