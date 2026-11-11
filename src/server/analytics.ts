import 'server-only';
import type { Db, ObjectId } from 'mongodb';
import {
  ANALYTICS_EVENTS,
  collections,
  isDuplicateKeyError,
  toObjectId,
  type AnalyticsEventDoc,
  type AnalyticsEventName,
} from '@/server/db/collections';

// First-party product analytics: a small allow-listed set of events, stored
// without personal data (ids only). One-off events carry a dedupe key, so a
// retry or a second tab can never count a registration or first export twice.

export const isAnalyticsEventName = (name: unknown): name is AnalyticsEventName =>
  typeof name === 'string' && (ANALYTICS_EVENTS as readonly string[]).includes(name);

export async function trackEvent(
  db: Db,
  event: {
    name: AnalyticsEventName;
    userId?: string | ObjectId | null;
    anonymousId?: string | null;
    dedupeKey?: string | null;
    campaign?: AnalyticsEventDoc['campaign'];
    props?: AnalyticsEventDoc['props'];
    /** When it happened (now unless given). */
    at?: Date;
  },
): Promise<'recorded' | 'duplicate'> {
  try {
    await collections(db).analyticsEvents.insertOne({
      name: event.name,
      at: event.at ?? new Date(),
      userId: toObjectId(event.userId ?? null),
      anonymousId: event.anonymousId ?? null,
      dedupeKey: event.dedupeKey ?? null,
      campaign: event.campaign ?? null,
      props: event.props ?? {},
    });
    return 'recorded';
  } catch (error) {
    if (isDuplicateKeyError(error)) return 'duplicate';
    throw error;
  }
}

const utcDay = (now: Date) => now.toISOString().slice(0, 10);

/** The account used the studio today (counted once per UTC day): active users. */
export const recordActiveDay = (db: Db, userId: string | ObjectId, now = new Date()) =>
  trackEvent(db, { name: 'active_day', userId, at: now, dedupeKey: `active_day:${String(userId)}:${utcDay(now)}`, props: { day: utcDay(now) } });

/** The account opened a tool today (counted once per tool per UTC day): usage by tool. */
export const recordToolOpen = (db: Db, userId: string | ObjectId, tool: string, now = new Date()) =>
  trackEvent(db, { name: 'tool_open', userId, at: now, dedupeKey: `tool_open:${String(userId)}:${tool}:${utcDay(now)}`, props: { tool, day: utcDay(now) } });
