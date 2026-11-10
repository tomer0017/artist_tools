import 'server-only';
import { ObjectId, type Db } from 'mongodb';
import { FEATURES, PLAN_IDS, type FeatureId, type PlanId } from '@/lib/plans';

// ─── Data model ────────────────────────────────────────────────────────────────
// `users`, `sessions`, `accounts` and `verifications` are owned by Better Auth
// (see src/server/auth.ts); everything else belongs to the app. All user
// references are ObjectIds, the same type Better Auth stores.

export { FEATURES, PLAN_IDS, type FeatureId, type PlanId };

export type UserRole = 'user' | 'admin';
export type AccountStatus = 'active' | 'suspended';

/** A user as stored by Better Auth, plus the app's own fields. */
export interface UserDoc {
  _id: ObjectId;
  name: string;
  email: string;
  emailVerified: boolean;
  image?: string | null;
  createdAt: Date;
  updatedAt: Date;
  /** What the account may administer. Independent of the plan: Pro never makes anyone an admin. */
  role: UserRole;
  status: AccountStatus;
  /**
   * The plan an administrator assigned ('free' for every new account). Written
   * only by the server (admin dashboard, operator CLI); paid plans arrive
   * through `subscriptions` instead, and the better of the two applies.
   */
  plan?: PlanId;
  planUpdatedAt?: Date | null;
  /** Who last assigned the plan: 'admin:<id>' or 'cli'. */
  planUpdatedBy?: string | null;
  lastLoginAt?: Date | null;
  /** Tools whose first-visit introduction the person dismissed (TabId values). */
  introsSeen?: string[];
  /** Marketing email consent is opt-in and recorded separately from sign-up. */
  marketingConsent: boolean;
  marketingConsentAt?: Date | null;
  marketingConsentSource?: string | null;
}

/** A sign-in identity: Google's stable subject id (`accountId`), never the email. */
export interface AccountDoc {
  _id: ObjectId;
  userId: ObjectId;
  providerId: string;
  accountId: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface SessionDoc {
  _id: ObjectId;
  userId: ObjectId;
  token: string;
  expiresAt: Date;
  createdAt: Date;
  updatedAt: Date;
  ipAddress?: string | null;
  userAgent?: string | null;
}

// Features are stable identifiers the server checks; plans list which ones they
// include. Both are defined in src/lib/plans.ts.
export interface PlanDoc {
  _id: PlanId;
  name: string;
  active: boolean;
  features: FeatureId[];
  /** Usage caps per calendar month (UTC); a missing feature is unlimited. */
  limits: Partial<Record<FeatureId, number>>;
  updatedAt: Date;
}

export type SubscriptionStatus = 'trialing' | 'active' | 'past_due' | 'canceled' | 'incomplete' | 'expired';

/** Written only by the server from verified payment-provider events. */
export interface SubscriptionDoc {
  _id?: ObjectId;
  userId: ObjectId;
  planId: PlanId;
  provider: string;
  providerCustomerId: string | null;
  providerSubscriptionId: string | null;
  status: SubscriptionStatus;
  currentPeriodStart: Date | null;
  currentPeriodEnd: Date | null;
  cancelAtPeriodEnd: boolean;
  canceledAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface UsageDoc {
  _id?: ObjectId;
  userId: ObjectId;
  feature: FeatureId;
  /** Calendar month, 'YYYY-MM' in UTC. */
  period: string;
  quantity: number;
  firstAt: Date;
  lastAt: Date;
}

export type AuditEventType =
  | 'user.registered'
  | 'user.login'
  | 'user.logout'
  | 'admin.role_granted'
  | 'admin.role_revoked'
  | 'admin.plan_changed'
  | 'account.status_changed'
  | 'subscription.changed';

/** Only ids, enums and counts — never tokens, emails or free text from users. */
export type AuditMetadata = Record<string, string | number | boolean | null>;

export interface AuditEventDoc {
  _id?: ObjectId;
  type: AuditEventType;
  /** The account the event is about. */
  userId: ObjectId | null;
  /** Who caused it: 'user:<id>', 'admin:<id>', 'cli', 'system' or 'webhook:<provider>'. */
  actor: string;
  at: Date;
  metadata: AuditMetadata;
}

export interface PaymentEventDoc {
  _id?: ObjectId;
  provider: string;
  eventId: string;
  type: string;
  status: 'processing' | 'processed' | 'ignored' | 'failed';
  receivedAt: Date;
  processedAt: Date | null;
  error: string | null;
}

export const ANALYTICS_EVENTS = [
  'landing_view',
  'start_free_click',
  'sign_in_start',
  'registration_completed',
  'login_succeeded',
  'first_tool_use',
  'tool_use',
  'first_export',
  'subscription_converted',
] as const;
export type AnalyticsEventName = (typeof ANALYTICS_EVENTS)[number];

export interface AnalyticsEventDoc {
  _id?: ObjectId;
  name: AnalyticsEventName;
  at: Date;
  userId: ObjectId | null;
  /** Random per-browser id for visitors who have not signed in. */
  anonymousId: string | null;
  /** Makes one-off events (e.g. first export) impossible to double count. */
  dedupeKey: string | null;
  /** UTM attribution, stored only when consent allows it. */
  campaign: { source?: string; medium?: string; campaign?: string } | null;
  props: Record<string, string | number | boolean>;
}

export function collections(db: Db) {
  return {
    users: db.collection<UserDoc>('users'),
    accounts: db.collection<AccountDoc>('accounts'),
    sessions: db.collection<SessionDoc>('sessions'),
    plans: db.collection<PlanDoc>('plans'),
    subscriptions: db.collection<SubscriptionDoc>('subscriptions'),
    usage: db.collection<UsageDoc>('usage'),
    auditEvents: db.collection<AuditEventDoc>('audit_events'),
    paymentEvents: db.collection<PaymentEventDoc>('payment_events'),
    analyticsEvents: db.collection<AnalyticsEventDoc>('analytics_events'),
  };
}

/** Parse an id from a URL, CLI or session into an ObjectId; null when malformed. */
export function toObjectId(id: string | ObjectId | null | undefined): ObjectId | null {
  if (id instanceof ObjectId) return id;
  return typeof id === 'string' && ObjectId.isValid(id) && /^[0-9a-f]{24}$/i.test(id) ? new ObjectId(id) : null;
}

/** MongoDB's duplicate-key error (a unique index rejected the write). */
export const isDuplicateKeyError = (error: unknown): boolean =>
  typeof error === 'object' && error !== null && (error as { code?: number }).code === 11000;
