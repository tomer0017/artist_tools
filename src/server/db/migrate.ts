import 'server-only';
import type { Db, IndexSpecification, CreateIndexesOptions } from 'mongodb';
import { DEFAULT_CURRENCY, DEFAULT_LOCALE } from '@/lib/locale';
import { catalogReadNotes, catalogSpec, initialCatalog, readCatalog, syncPlans } from '@/server/config/catalog';
import { pricingSpec } from '@/server/config/pricing';
import { getPublished, seedDefaults } from '@/server/config/versions';
import { log } from '@/server/log';
import { collections } from './collections';

// Idempotent schema setup: safe to run on every deploy (`npm run db:migrate`).
// Better Auth's MongoDB adapter creates no indexes, so its collections' are
// here too (unique email and session token, lookups), with the app's own.
// A unique index cannot be created over duplicates: the migration then fails
// and the release stops before switching (deploy/release.sh), with the dump
// it took first.

interface IndexPlan {
  collection: string;
  key: IndexSpecification;
  options: CreateIndexesOptions & { name: string };
}

export const INDEXES: IndexPlan[] = [
  // One app account per Google identity, whatever happens to the email.
  { collection: 'accounts', key: { providerId: 1, accountId: 1 }, options: { name: 'provider_identity_unique', unique: true } },
  // Better Auth's own lookups and uniqueness (found missing by the first restore drill, 2026-11-11).
  { collection: 'users', key: { email: 1 }, options: { name: 'users_email_unique', unique: true } },
  { collection: 'sessions', key: { token: 1 }, options: { name: 'sessions_token_unique', unique: true } },
  { collection: 'sessions', key: { userId: 1 }, options: { name: 'sessions_by_user' } },
  { collection: 'accounts', key: { userId: 1 }, options: { name: 'accounts_by_user' } },
  { collection: 'verifications', key: { identifier: 1 }, options: { name: 'verifications_by_identifier' } },
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
  // Live grants of an account, newest end first.
  { collection: 'access_grants', key: { userId: 1, endsAt: -1 }, options: { name: 'grants_by_user' } },
  { collection: 'audit_events', key: { at: -1 }, options: { name: 'audit_by_time' } },
  // Versioned configuration: numbered per kind, one published and one draft at most.
  { collection: 'config_versions', key: { kind: 1, version: 1 }, options: { name: 'config_version_unique', unique: true } },
  {
    collection: 'config_versions',
    key: { kind: 1 },
    options: { name: 'config_one_published', unique: true, partialFilterExpression: { status: 'published' } },
  },
  { collection: 'config_versions', key: { kind: 1, status: 1 }, options: { name: 'config_one_draft', unique: true, partialFilterExpression: { status: 'draft' } } },
  { collection: 'coupons', key: { code: 1 }, options: { name: 'coupon_code_unique', unique: true } },
  { collection: 'coupon_redemptions', key: { couponId: 1, userId: 1 }, options: { name: 'redemption_by_coupon_user' } },
  { collection: 'analytics_events', key: { userId: 1, name: 1, at: -1 }, options: { name: 'analytics_by_user' } },
  // Billing (docs/billing/02-architecture.md): one customer per account and provider,
  // one record per provider payment, checkouts that expire on their own.
  { collection: 'billing_customers', key: { provider: 1, userId: 1 }, options: { name: 'billing_customer_unique', unique: true } },
  { collection: 'payments', key: { provider: 1, providerPaymentId: 1 }, options: { name: 'payment_unique', unique: true } },
  { collection: 'payments', key: { userId: 1, occurredAt: -1 }, options: { name: 'payments_by_user' } },
  { collection: 'payments', key: { occurredAt: -1 }, options: { name: 'payments_by_time' } },
  { collection: 'payment_events', key: { receivedAt: -1 }, options: { name: 'payment_events_by_time' } },
  { collection: 'subscriptions', key: { updatedAt: -1 }, options: { name: 'subscriptions_by_updated' } },
  { collection: 'checkout_sessions', key: { expiresAt: 1 }, options: { name: 'checkout_expiry_ttl', expireAfterSeconds: 7 * 24 * 60 * 60 } },
  { collection: 'reconciliation_runs', key: { startedAt: -1 }, options: { name: 'reconciliation_by_time' } },
  { collection: 'admin_mfa_sessions', key: { expiresAt: 1 }, options: { name: 'admin_mfa_session_ttl', expireAfterSeconds: 0 } },
  { collection: 'admin_mfa_sessions', key: { userId: 1 }, options: { name: 'admin_mfa_sessions_by_user' } },
  { collection: 'error_reports', key: { lastSeen: 1 }, options: { name: 'error_reports_ttl', expireAfterSeconds: 30 * 24 * 60 * 60 } },
  // Username accounts (ADR-0012): one account per username, whatever races;
  // accounts without one (every Google account) are not in the index at all.
  { collection: 'users', key: { username: 1 }, options: { name: 'users_username_unique', unique: true, partialFilterExpression: { username: { $type: 'string' } } } },
  // Initial passwords waiting to be revealed once remove themselves when they expire.
  { collection: 'password_handoffs', key: { expiresAt: 1 }, options: { name: 'password_handoff_ttl', expireAfterSeconds: 0 } },
  // Learn's asset metadata (ADR-0017), newest first for the admin page; thumbnails by the asset they preview.
  { collection: 'learn_assets', key: { uploadedAt: -1 }, options: { name: 'learn_assets_by_time' } },
  { collection: 'learn_assets', key: { of: 1 }, options: { name: 'learn_assets_by_original', partialFilterExpression: { of: { $type: 'string' } } } },
  // Learn completions (ADR-0018): a person's history, newest first, and per item (ticks and counts).
  { collection: 'learn_completions', key: { userId: 1, completedAt: -1 }, options: { name: 'learn_completions_by_user' } },
  { collection: 'learn_completions', key: { userId: 1, itemId: 1, completedAt: -1 }, options: { name: 'learn_completions_by_item' } },
  // The owner (set only from the server command line): at most one account, whatever races.
  { collection: 'users', key: { owner: 1 }, options: { name: 'users_one_owner', unique: true, partialFilterExpression: { owner: true } } },
  // Trusted admin devices: found by their token's hash, listed per admin, removed when the trust ends.
  { collection: 'admin_trusted_devices', key: { tokenHash: 1 }, options: { name: 'admin_trusted_device_token_unique', unique: true } },
  { collection: 'admin_trusted_devices', key: { userId: 1 }, options: { name: 'admin_trusted_devices_by_user' } },
  { collection: 'admin_trusted_devices', key: { expiresAt: 1 }, options: { name: 'admin_trusted_device_ttl', expireAfterSeconds: 0 } },
];

export interface MigrationReport {
  indexes: number;
  /** Configuration kinds published for the first time (with the code's defaults). */
  configSeeded: number;
  plansInserted: number;
  plansUpdated: number;
  usersBackfilled: number;
  preferencesBackfilled: number;
  /**
   * How this release read the published catalog. `unreadable`: `plans` was
   * left exactly as it was. `partial`: features it cannot apply are withheld.
   * `notes`: what it kept without applying, or why it could not read it.
   */
  catalog: { version: number | null; status: 'ok' | 'partial' | 'unreadable'; notes: string[] };
}

export async function migrate(db: Db): Promise<MigrationReport> {
  for (const index of INDEXES) {
    await db.collection(index.collection).createIndex(index.key, index.options);
  }

  // Configuration starts as the code's defaults (version 1), so a deploy never
  // changes behaviour; after that, admins own it (docs/adr/0006). A database
  // with plans but no catalog (its history lost) starts from the plans in
  // force, never from the defaults, which can grant more (ADR-0014).
  const catalogSeed = (await getPublished(db, catalogSpec)) ? undefined : await initialCatalog(db);
  const configSeeded = Number(await seedDefaults(db, catalogSpec, catalogSeed)) + Number(await seedDefaults(db, pricingSpec));

  // `plans` follows the published catalog: missing plans are inserted, and a
  // plan whose stored features, quotas or name differ is brought back in step.
  // Rolling back is safe (ADR-0014): what a newer release added is kept in the
  // catalog and not applied here; a catalog this release cannot read at all
  // leaves `plans` exactly as it is, the last plans applied.
  const { users } = collections(db);
  const published = await getPublished(db, catalogSpec);
  const read = readCatalog(published?.document);
  const catalog: MigrationReport['catalog'] = { version: published?.version ?? null, status: read.status, notes: catalogReadNotes(read) };
  let plansInserted = 0;
  let plansUpdated = 0;
  if (read.status === 'unreadable') {
    log.error('catalog.unreadable', { version: catalog.version, issues: catalog.notes });
  } else {
    if (catalog.notes.length > 0) log.warn('catalog.not_applied', { version: catalog.version, status: read.status, notes: catalog.notes });
    ({ inserted: plansInserted, updated: plansUpdated } = await syncPlans(db, read.catalog));
  }

  // Accounts created before plans existed are on Free.
  const { modifiedCount: usersBackfilled } = await users.updateMany({ plan: { $exists: false } }, { $set: { plan: 'free' } });

  // Accounts created before preferences existed: English and US dollars.
  const locale = await users.updateMany({ locale: { $exists: false } }, { $set: { locale: DEFAULT_LOCALE } });
  const currency = await users.updateMany({ currency: { $exists: false } }, { $set: { currency: DEFAULT_CURRENCY } });

  return {
    indexes: INDEXES.length,
    configSeeded,
    plansInserted,
    plansUpdated,
    usersBackfilled,
    preferencesBackfilled: Math.max(locale.modifiedCount, currency.modifiedCount),
    catalog,
  };
}
