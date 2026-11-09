import 'server-only';
import type { Db, IndexSpecification, CreateIndexesOptions } from 'mongodb';
import { FEATURES, collections, type PlanDoc } from './collections';

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
];

/** Plans as first created. Existing plan documents are never overwritten. */
export function seedPlans(now = new Date()): PlanDoc[] {
  return [
    { _id: 'free', name: 'Free', active: true, features: [...FEATURES], limits: {}, updatedAt: now },
    { _id: 'pro', name: 'Pro', active: true, features: [...FEATURES], limits: {}, updatedAt: now },
  ];
}

export async function migrate(db: Db): Promise<{ indexes: number; plansInserted: number }> {
  for (const index of INDEXES) {
    await db.collection(index.collection).createIndex(index.key, index.options);
  }
  let plansInserted = 0;
  for (const plan of seedPlans()) {
    const result = await collections(db).plans.updateOne({ _id: plan._id }, { $setOnInsert: plan }, { upsert: true });
    plansInserted += result.upsertedCount;
  }
  return { indexes: INDEXES.length, plansInserted };
}
