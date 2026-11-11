import 'server-only';
import type { Db, ObjectId } from 'mongodb';
import { TOOL_IDS, type ToolId } from '@/lib/account';
import { FEATURES, type FeatureId } from '@/lib/plans';
import { collections } from '@/server/db/collections';
import { usagePeriod } from '@/server/usage';
import { billingMetrics } from '@/server/billing/metrics';

// ─── Product analytics for the admin dashboard (ADR-0011) ─────────────────────
// Computed from first-party data only: account records, the allow-listed
// events (active days, tool opens, registrations) and server-side usage
// counters. Test accounts are left out of every figure. Billing figures are
// zero until a payment provider is live, and say so.

const DAY = 86_400_000;
const dayKey = (d: Date) => d.toISOString().slice(0, 10);
const startOfUtcDay = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
/** Monday 00:00 UTC of the week containing `d`. */
const startOfUtcWeek = (d: Date) => {
  const day = startOfUtcDay(d);
  return new Date(day.getTime() - ((day.getUTCDay() + 6) % 7) * DAY);
};

export interface DailyPoint {
  day: string;
  value: number;
}

export interface AnalyticsReport {
  generatedAt: string;
  accounts: { total: number; verified: number; last7: number; last30: number; testExcluded: number };
  registrations: DailyPoint[];
  active: { today: number; last7: number; last30: number; daily: DailyPoint[] };
  tools: { tool: ToolId; users: number; opens: number }[];
  features: { feature: FeatureId; uses: number; users: number }[];
  /** Weekly cohorts: of the accounts registered that week, the share active 1–4 weeks later (null: not reached yet). */
  retention: { week: string; size: number; weeks: (number | null)[] }[];
  plans: { proAssigned: number; proGiven: number; paying: number };
  /** Revenue from verified provider events (none until a provider is connected): per currency, minor units. */
  billing: {
    live: boolean;
    mrrMinor: Record<string, number>;
    arrMinor: Record<string, number>;
    cancellations30: number;
    churnRate30: number | null;
    refunds30: number;
    failedPayments30: number;
    chargebacks30: number;
  };
}

function series(days: number, today: Date, counts: Map<string, number>): DailyPoint[] {
  return Array.from({ length: days }, (_, i) => {
    const day = dayKey(new Date(today.getTime() - (days - 1 - i) * DAY));
    return { day, value: counts.get(day) ?? 0 };
  });
}

export async function analyticsReport(db: Db, now = new Date()): Promise<AnalyticsReport> {
  const c = collections(db);
  const today = startOfUtcDay(now);
  const since30 = new Date(today.getTime() - 29 * DAY);
  const since7 = new Date(today.getTime() - 6 * DAY);
  const testIds = (await c.users.distinct('_id', { testAccount: true })) as ObjectId[];
  const real = { $nin: testIds };

  const [total, verified, last7, last30, regDocs] = await Promise.all([
    c.users.countDocuments({ _id: real }),
    c.users.countDocuments({ _id: real, emailVerified: true }),
    c.users.countDocuments({ _id: real, createdAt: { $gte: since7 } }),
    c.users.countDocuments({ _id: real, createdAt: { $gte: since30 } }),
    c.users
      .aggregate<{ _id: string; n: number }>([
        { $match: { _id: real, createdAt: { $gte: since30 } } },
        { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } }, n: { $sum: 1 } } },
      ])
      .toArray(),
  ]);

  // Active users: one `active_day` event per account and UTC day.
  const activeDocs = await c.analyticsEvents
    .find({ name: 'active_day', at: { $gte: since30 }, userId: real }, { projection: { userId: 1, at: 1 } })
    .toArray();
  const activeByDay = new Map<string, number>();
  const users7 = new Set<string>();
  const users30 = new Set<string>();
  for (const e of activeDocs) {
    const key = dayKey(e.at);
    activeByDay.set(key, (activeByDay.get(key) ?? 0) + 1);
    users30.add(String(e.userId));
    if (e.at >= since7) users7.add(String(e.userId));
  }

  const [toolDocs, featureDocs] = await Promise.all([
    c.analyticsEvents
      .aggregate<{ _id: string; opens: number; users: ObjectId[] }>([
        { $match: { name: 'tool_open', at: { $gte: since30 }, userId: real } },
        { $group: { _id: '$props.tool', opens: { $sum: 1 }, users: { $addToSet: '$userId' } } },
      ])
      .toArray(),
    c.usage
      .aggregate<{ _id: FeatureId; uses: number; users: ObjectId[] }>([
        { $match: { period: usagePeriod(now), userId: real } },
        { $group: { _id: '$feature', uses: { $sum: '$quantity' }, users: { $addToSet: '$userId' } } },
      ])
      .toArray(),
  ]);

  // Retention: cohorts of the last 8 full-or-current weeks.
  const thisWeek = startOfUtcWeek(now);
  const firstWeek = new Date(thisWeek.getTime() - 7 * 7 * DAY);
  const cohortUsers = await c.users.find({ _id: real, createdAt: { $gte: firstWeek } }, { projection: { createdAt: 1 } }).toArray();
  const activity = cohortUsers.length
    ? await c.analyticsEvents.find({ name: 'active_day', userId: { $in: cohortUsers.map((u) => u._id) } }, { projection: { userId: 1, at: 1 } }).toArray()
    : [];
  const daysByUser = new Map<string, Date[]>();
  for (const e of activity) daysByUser.set(String(e.userId), [...(daysByUser.get(String(e.userId)) ?? []), e.at]);
  const retention = Array.from({ length: 8 }, (_, i) => {
    const start = new Date(firstWeek.getTime() + i * 7 * DAY);
    const members = cohortUsers.filter((u) => u.createdAt >= start && u.createdAt < new Date(start.getTime() + 7 * DAY));
    const weeks = [1, 2, 3, 4].map((k) => {
      const from = new Date(start.getTime() + k * 7 * DAY);
      if (from > now || members.length === 0) return null;
      const to = new Date(from.getTime() + 7 * DAY);
      const back = members.filter((m) => (daysByUser.get(String(m._id)) ?? []).some((d) => d >= from && d < to)).length;
      return Math.round((back / members.length) * 100);
    });
    return { week: dayKey(start), size: members.length, weeks };
  });

  const [proAssigned, proGiven, paying] = await Promise.all([
    c.users.countDocuments({ _id: real, plan: 'pro' }),
    c.accessGrants.distinct('userId', { userId: real, planId: 'pro', revokedAt: null, startsAt: { $lte: now }, endsAt: { $gt: now } }).then((ids) => ids.length),
    c.subscriptions.countDocuments({ userId: real, status: { $in: ['active', 'trialing', 'past_due'] } }),
  ]);
  const money = await billingMetrics(db, { now });

  return {
    generatedAt: now.toISOString(),
    accounts: { total, verified, last7, last30, testExcluded: testIds.length },
    registrations: series(30, today, new Map(regDocs.map((d) => [d._id, d.n]))),
    active: { today: activeByDay.get(dayKey(today)) ?? 0, last7: users7.size, last30: users30.size, daily: series(30, today, activeByDay) },
    tools: TOOL_IDS.map((tool) => {
      const doc = toolDocs.find((d) => d._id === tool);
      return { tool, opens: doc?.opens ?? 0, users: doc?.users.length ?? 0 };
    }),
    features: FEATURES.map((feature) => {
      const doc = featureDocs.find((d) => d._id === feature);
      return { feature, uses: doc?.uses ?? 0, users: doc?.users.length ?? 0 };
    }).filter((f) => f.uses > 0),
    retention,
    plans: { proAssigned, proGiven, paying },
    // Computed from subscriptions and payments written by verified provider
    // events; no provider is connected yet, so they stay empty until then.
    billing: {
      live: money.subscriptions.active + money.subscriptions.trialing + money.subscriptions.pastDue > 0,
      mrrMinor: money.mrrMinor,
      arrMinor: money.arrMinor,
      cancellations30: money.last30Days.ended,
      churnRate30: money.last30Days.churnRate,
      refunds30: money.last30Days.refunds.count,
      failedPayments30: money.last30Days.failedPayments,
      chargebacks30: money.last30Days.chargebacks,
    },
  };
}
