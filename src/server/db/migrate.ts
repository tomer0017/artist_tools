import 'server-only';
import type { Db, IndexSpecification, CreateIndexesOptions } from 'mongodb';
import { DEFAULT_CURRENCY, DEFAULT_LOCALE } from '@/lib/locale';
import { PLAN_FEATURES, PLAN_IDS, PLAN_NAMES } from '@/lib/plans';
import { collections, type PlanDoc } from './collections';

// Idempotent schema setup: safe to run on every deploy (`npm run db:migrate`).
// Better Auth creates its own basic indexes (unique email and session token,
// userId lookups); these are the constraints it does not cover plus the app's
// own collections.

interface IndexPlan {
  collection: string;
  key: IndexSpecification;
  options: CreateIndexesOptions & { name: string };
}

export const INDEXES: IndexPlan[] = [
  // One app account per Google identity, whatever happens to the email.
  { collection: 'accounts', key: { providerId: 1, accountId: 1 }, options: { name: 'provider_identity_unique', unique: true } },
  // Expired sessions and sign-in verifications delete themselves.
  { collection: 'sessions', key: { expiresAt: 1 }, options: { name: 'session_expiry_ttl', expireAfterSeconds: 0 } },
  { collection: 'verifications', key: { expiresAt: 1 }, options: { name: 'verification_expiry_ttl', expireAfterSeconds: 0 } },
  { collection: 'users', key: { createdAt: -1 }, options: { name: 'users_by_created' } },
  { collection: 'subscriptions', key: { userId: 1, updatedAt: -1 }, options: { name: 'subscriptions_by_user' } },
  {
    collection: 'subscriptions',
    key: { provider: 1, providerSubscriptionId: 1 },
    options: {
      name: 'provider_subscription_unique',
      unique: true,
      partialFilterExpression: { providerSubscriptionId: { $type: 'string' } },
    },
  },
  { collection: 'usage', key: { userId: 1, feature: 1, period: 1 }, options: { name: 'usage_per_period_unique', unique: true } },
  { collection: 'audit_events', key: { userId: 1, at: -1 }, options: { name: 'audit_by_user' } },
  { collection: 'audit_events', key: { type: 1, at: -1 }, options: { name: 'audit_by_type' } },
  { collection: 'payment_events', key: { provider: 1, eventId: 1 }, options: { name: 'payment_event_unique', unique: true } },
  {
    collection: 'analytics_events',
    key: { dedupeKey: 1 },
    options: { name: 'analytics_dedupe_unique', unique: true, partialFilterExpression: { dedupeKey: { $type: 'string' } } },
  },
  { collection: 'analytics_events', key: { name: 1, at: -1 }, options: { name: 'analytics_by_name' } },
  // Per-address throttle windows and outbox messages remove themselves.
  { collection: 'auth_throttles', key: { expiresAt: 1 }, options: { name: 'throttle_expiry_ttl', expireAfterSeconds: 0 } },
  { collection: 'mail_outbox', key: { expiresAt: 1 }, options: { name: 'outbox_expiry_ttl', expireAfterSeconds: 0 } },
  { collection: 'mail_outbox', key: { createdAt: -1 }, options: { name: 'outbox_by_created' } },
  { collection: 'consent_events', key: { userId: 1, at: -1 }, options: { name: 'consent_by_user' } },
  // Better Auth's per-IP counters: looked up by key, pruned by age (scripts/db.ts maintenance).
  { collection: 'rateLimits', key: { key: 1 }, options: { name: 'rate_limit_by_key' } },
  { collection: 'rateLimits', key: { lastRequest: 1 }, options: { name: 'rate_limit_by_age' } },
];

/** Plans as the code defines them (src/lib/plans.ts). */
export function planDefinitions(now = new Date()): PlanDoc[] {
  return PLAN_IDS.map((id) => ({ _id: id, name: PLAN_NAMES[id], active: true, features: [...PLAN_FEATURES[id]], limits: {}, updatedAt: now }));
}

const sameList = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((item, i) => item === b[i]);

export interface MigrationReport {
  indexes: number;
  plansInserted: number;
  plansUpdated: number;
  usersBackfilled: number;
  preferencesBackfilled: number;
}

export async function migrate(db: Db): Promise<MigrationReport> {
  for (const index of INDEXES) {
    await db.collection(index.collection).createIndex(index.key, index.options);
  }

  // The code owns plan definitions: missing plans are inserted, and a plan
  // whose stored features, limits or name differ is brought back in step.
  const { plans, users } = collections(db);
  let plansInserted = 0;
  let plansUpdated = 0;
  for (const plan of planDefinitions()) {
    const stored = await plans.findOne({ _id: plan._id });
    if (!stored) {
      await plans.insertOne(plan);
      plansInserted += 1;
    } else if (
      stored.name !== plan.name ||
      stored.active !== plan.active ||
      !sameList(stored.features ?? [], plan.features) ||
      JSON.stringify(stored.limits ?? {}) !== JSON.stringify(plan.limits)
    ) {
      const { _id, ...definition } = plan;
      await plans.updateOne({ _id }, { $set: definition });
      plansUpdated += 1;
    }
  }

  // Accounts created before plans existed are on Free.
  const { modifiedCount: usersBackfilled } = await users.updateMany({ plan: { $exists: false } }, { $set: { plan: 'free' } });

  // Accounts created before preferences existed: English and US dollars.
  const locale = await users.updateMany({ locale: { $exists: false } }, { $set: { locale: DEFAULT_LOCALE } });
  const currency = await users.updateMany({ currency: { $exists: false } }, { $set: { currency: DEFAULT_CURRENCY } });

  return {
    indexes: INDEXES.length,
    plansInserted,
    plansUpdated,
    usersBackfilled,
    preferencesBackfilled: Math.max(locale.modifiedCount, currency.modifiedCount),
  };
}
