import 'server-only';
import { ObjectId, type Db } from 'mongodb';
import { FEATURES, PLAN_IDS, type FeatureId, type PlanId } from '@/lib/plans';
import type { Currency, Locale } from '@/lib/locale';

// ─── Data model ────────────────────────────────────────────────────────────────
// `users`, `sessions`, `accounts`, `verifications` and `rateLimits` are owned
// by Better Auth (see src/server/auth.ts); everything else belongs to the app.
// All user references are ObjectIds, the same type Better Auth stores.

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
  /** Marketing email consent is opt-in and recorded separately from sign-up; history in `consent_events`. */
  marketingConsent: boolean;
  marketingConsentAt?: Date | null;
  marketingConsentSource?: string | null;
  /** Preferred interface language and display/billing currency (src/lib/locale.ts). */
  locale?: Locale;
  currency?: Currency;
  /** Set by an administrator when an account was suspended (cleared on reactivation). */
  suspendedAt?: Date | null;
  suspendedBy?: string | null;
  suspendReason?: SuspendReason | null;
  /** Test accounts are left out of product analytics and revenue figures. */
  testAccount?: boolean;
}

/** Why an account was suspended (an enum, never free text). */
export type SuspendReason = 'abuse' | 'security' | 'payment' | 'request' | 'other';
export const SUSPEND_REASONS: readonly SuspendReason[] = ['abuse', 'security', 'payment', 'request', 'other'];

export type GrantReason = 'promotion' | 'trial' | 'support' | 'test';

/** Time-limited access to a plan given by an administrator (src/server/grants.ts). */
export interface AccessGrantDoc {
  _id?: ObjectId;
  userId: ObjectId;
  planId: PlanId;
  startsAt: Date;
  endsAt: Date;
  reason: GrantReason;
  /** 'admin:<id>' or 'cli'. */
  grantedBy: string;
  createdAt: Date;
  revokedAt: Date | null;
  revokedBy: string | null;
}

/**
 * A sign-in method. Google: `accountId` is Google's stable subject id, never
 * the email. Password (`providerId` 'credential'): `accountId` is the user id
 * and `password` the scrypt hash, which never leaves the server.
 */
export interface AccountDoc {
  _id: ObjectId;
  userId: ObjectId;
  providerId: string;
  accountId: string;
  password?: string | null;
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
  /** Usage caps per day (UTC), from the published catalog. */
  dailyLimits?: Partial<Record<FeatureId, number>>;
  updatedAt: Date;
}

export type ConfigKind = 'catalog' | 'pricing';

/** One version of admin-managed configuration (src/server/config/versions.ts). */
export interface ConfigVersionDoc<T = unknown> {
  _id?: ObjectId;
  kind: ConfigKind;
  version: number;
  status: 'draft' | 'published' | 'archived';
  document: T;
  note: string | null;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
  publishedBy: string | null;
  publishedAt: Date | null;
}

/** A discount code (src/server/coupons.ts). Redemptions are counted from `coupon_redemptions`. */
export interface CouponDoc {
  _id?: ObjectId;
  /** Upper case letters, digits and dashes; unique. */
  code: string;
  kind: 'percent' | 'fixed';
  percentOff: number | null;
  amountOffMinor: number | null;
  currency: Currency | null;
  /** Which prices it applies to, as 'pro:month' / 'pro:year'; empty means every paid price. */
  appliesTo: string[];
  startsAt: Date;
  endsAt: Date | null;
  maxRedemptions: number | null;
  maxPerUser: number;
  status: 'active' | 'disabled';
  note: string | null;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface CouponRedemptionDoc {
  _id?: ObjectId;
  couponId: ObjectId;
  userId: ObjectId;
  subscriptionId: string | null;
  at: Date;
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
  /** The price (pricing configuration id) and what it costs, as the provider reported it. */
  priceId?: string | null;
  interval?: 'month' | 'year' | null;
  currency?: string | null;
  amountMinor?: number | null;
  trialEndsAt?: Date | null;
  couponCode?: string | null;
  /** When the subscription ended for good (expired or cancelled immediately). */
  endedAt?: Date | null;
  /** Provider time of the newest event applied, so older events arriving late are not applied over it. */
  lastEventAt?: Date | null;
}

/** The provider's customer record for an account (one per provider). */
export interface BillingCustomerDoc {
  _id?: ObjectId;
  userId: ObjectId;
  provider: string;
  providerCustomerId: string;
  createdAt: Date;
}

/** Money that moved: a charge, a refund or a chargeback, as the provider reported it. */
export interface PaymentDoc {
  _id?: ObjectId;
  provider: string;
  providerPaymentId: string;
  userId: ObjectId;
  providerSubscriptionId: string | null;
  kind: 'charge' | 'refund' | 'chargeback';
  status: 'succeeded' | 'failed';
  amountMinor: number;
  currency: string;
  occurredAt: Date;
  /** Receipt or invoice page at the provider, when it has one. */
  receiptUrl: string | null;
  createdAt: Date;
}

/** A checkout the server started for an account (the browser never says what it paid for). */
export interface CheckoutSessionDoc {
  _id: string;
  userId: ObjectId;
  provider: string;
  priceId: string;
  couponCode: string | null;
  status: 'open' | 'completed' | 'expired';
  createdAt: Date;
  expiresAt: Date;
  completedAt: Date | null;
}

/** One comparison of our subscriptions with the provider's (src/server/billing/reconcile.ts). */
/** An administrator's second factor (src/server/admin-mfa.ts): one per account, `_id` is the user id. */
export interface AdminMfaDoc {
  _id: ObjectId;
  /** The TOTP secret, sealed (src/server/security/secret-box.ts); never leaves the server after enrolment. */
  secret: string;
  /** When a first code confirmed the authenticator app; null while enrolment is pending. */
  confirmedAt: Date | null;
  /** SHA-256 of each one-time recovery code, and when it was used. */
  recoveryCodes: { hash: string; usedAt: Date | null }[];
  /** The last time step a code was accepted for: each code works once. */
  lastStep: number | null;
  /** Failed attempts since `failureWindowStart`, for the lockout. */
  failures: number;
  failureWindowStart: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

/** A session in which an administrator passed the second factor; removed when it expires (TTL). */
export interface AdminMfaSessionDoc {
  /** The Better Auth session id. */
  _id: string;
  userId: ObjectId;
  method: 'totp' | 'recovery';
  verifiedAt: Date;
  expiresAt: Date;
}

export interface ReconciliationRunDoc {
  _id?: ObjectId;
  provider: string;
  startedAt: Date;
  finishedAt: Date | null;
  checked: number;
  fixed: { providerSubscriptionId: string; field: string; ours: string | null; theirs: string | null }[];
  /** Ours, but unknown to the provider: not changed, for an admin to look into. */
  missing: string[];
  actor: string;
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
  | 'user.email_verified'
  | 'user.password_changed'
  | 'user.password_reset'
  | 'user.profile_updated'
  | 'user.consent_changed'
  | 'user.session_revoked'
  | 'user.sessions_revoked'
  | 'account.linked'
  | 'account.unlinked'
  | 'account.data_exported'
  | 'account.deleted'
  | 'auth.login_failed'
  | 'auth.throttled'
  | 'admin.role_granted'
  | 'admin.role_revoked'
  | 'admin.plan_changed'
  | 'admin.account_suspended'
  | 'admin.account_reactivated'
  | 'admin.test_flag_changed'
  | 'admin.grant_created'
  | 'admin.grant_revoked'
  | 'admin.audit_exported'
  | 'admin.mfa_enrolled'
  | 'admin.mfa_verified'
  | 'admin.mfa_failed'
  | 'admin.mfa_codes_regenerated'
  | 'admin.mfa_disabled'
  | 'admin.mfa_reset'
  | 'admin.config_saved'
  | 'admin.config_discarded'
  | 'admin.config_published'
  | 'admin.coupon_created'
  | 'admin.coupon_status_changed'
  | 'billing.checkout_started'
  | 'billing.payment'
  | 'billing.cancel_requested'
  | 'billing.reconciled'
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
  // One per account and UTC day the studio is used (active-user counts).
  'active_day',
  // One per account, tool and UTC day a tool is opened (usage by tool).
  'tool_open',
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

/** Purposes a person can consent to; each change is one `consent_events` entry. */
export type ConsentPurpose = 'marketing_email';

export interface ConsentEventDoc {
  _id?: ObjectId;
  userId: ObjectId;
  purpose: ConsentPurpose;
  granted: boolean;
  /** Where the choice was made, e.g. 'profile'. */
  source: string;
  at: Date;
}

/** Counter for one address and purpose; `_id` is `<purpose>:<sha256(address)>`, never the address. */
export interface AuthThrottleDoc {
  _id: string;
  count: number;
  firstAt: Date;
  /** End of the window; a TTL index removes the document afterwards. */
  expiresAt: Date;
}

export type MailTemplate =
  | 'verify_email'
  | 'reset_password'
  | 'existing_account'
  | 'password_changed'
  | 'password_added'
  | 'google_connected'
  | 'account_deleted';

/**
 * A message held by the outbox transport (development and staging only)
 * instead of being sent: admins read it at /admin/mail. Removed after 24 h.
 */
export interface MailOutboxDoc {
  _id?: ObjectId;
  template: MailTemplate;
  to: string;
  userId: ObjectId | null;
  subject: string;
  text: string;
  html: string;
  /** The links in the message, for the viewer's buttons. */
  links: { label: string; url: string }[];
  createdAt: Date;
  expiresAt: Date;
}

export function collections(db: Db) {
  return {
    users: db.collection<UserDoc>('users'),
    accounts: db.collection<AccountDoc>('accounts'),
    sessions: db.collection<SessionDoc>('sessions'),
    verifications: db.collection<{ _id: ObjectId; identifier: string; value: string; expiresAt: Date }>('verifications'),
    plans: db.collection<PlanDoc>('plans'),
    subscriptions: db.collection<SubscriptionDoc>('subscriptions'),
    usage: db.collection<UsageDoc>('usage'),
    auditEvents: db.collection<AuditEventDoc>('audit_events'),
    paymentEvents: db.collection<PaymentEventDoc>('payment_events'),
    analyticsEvents: db.collection<AnalyticsEventDoc>('analytics_events'),
    consentEvents: db.collection<ConsentEventDoc>('consent_events'),
    authThrottles: db.collection<AuthThrottleDoc>('auth_throttles'),
    mailOutbox: db.collection<MailOutboxDoc>('mail_outbox'),
    rateLimits: db.collection<{ _id: ObjectId; key: string; count: number; lastRequest: number }>('rateLimits'),
    accessGrants: db.collection<AccessGrantDoc>('access_grants'),
    configVersions: db.collection<ConfigVersionDoc>('config_versions'),
    coupons: db.collection<CouponDoc>('coupons'),
    billingCustomers: db.collection<BillingCustomerDoc>('billing_customers'),
    payments: db.collection<PaymentDoc>('payments'),
    checkoutSessions: db.collection<CheckoutSessionDoc>('checkout_sessions'),
    reconciliationRuns: db.collection<ReconciliationRunDoc>('reconciliation_runs'),
    adminMfa: db.collection<AdminMfaDoc>('admin_mfa'),
    adminMfaSessions: db.collection<AdminMfaSessionDoc>('admin_mfa_sessions'),
    couponRedemptions: db.collection<CouponRedemptionDoc>('coupon_redemptions'),
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
