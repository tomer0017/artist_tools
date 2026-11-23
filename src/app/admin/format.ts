import { formatMoney } from '@/lib/money';
import { PLAN_NAMES, isPlanId } from '@/lib/plans';
import type { AccessSource, AdminAuditEvent } from '@/server/admin';
import type { GrantReason, SubscriptionStatus } from '@/server/db/collections';
import { GRANT_REASON_LABELS } from '@/server/grants';

// Presentation helpers for the admin pages (server-rendered). Times are shown
// in UTC, labelled as such, so every admin reads the same clock.

const DATE_TIME = new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' });
const DATE = new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeZone: 'UTC' });

export const dateTime = (value: Date | null) => (value ? `${DATE_TIME.format(value)} UTC` : '—');
export const dateOnly = (value: Date | null) => (value ? DATE.format(value) : '—');

const plan = (value: unknown) => (isPlanId(value) ? PLAN_NAMES[value] : String(value ?? '?'));

/** A grant or plan-change reason in words ('trial' → 'Trial'); anything unknown as it is. */
export const reasonLabel = (value: unknown) => GRANT_REASON_LABELS[value as GrantReason] ?? String(value ?? '');

/** A subscription status as the payment provider reported it, in words. */
export const SUBSCRIPTION_STATUS_LABELS: Record<SubscriptionStatus, string> = {
  trialing: 'Trial',
  active: 'Active',
  past_due: 'Past due',
  canceled: 'Canceled',
  incomplete: 'Incomplete',
  expired: 'Expired',
};

/** Where access comes from, in a few words for the users list ("paid", "given until 3 Dec 2026", "no end date"). */
export function sourceShort(source: AccessSource): string {
  switch (source.kind) {
    case 'admin':
      return 'admin';
    case 'paid':
      if (source.status === 'past_due') return 'paid, past due';
      return source.cancelAtPeriodEnd || source.status === 'canceled' ? `paid until ${dateOnly(source.periodEnd)}` : 'paid';
    case 'given':
      return `given until ${dateOnly(source.until)}`;
    case 'assigned':
      return 'no end date';
  }
}

/** Where access comes from, in a sentence for the account page. */
export function sourceLong(source: AccessSource): { label: string; detail: string } {
  switch (source.kind) {
    case 'admin':
      return { label: 'Admin', detail: 'The admin role: every feature, whatever the plan.' };
    case 'paid': {
      const end = source.periodEnd ? (source.cancelAtPeriodEnd || source.status === 'canceled' ? `, ends ${dateOnly(source.periodEnd)}` : `, renews ${dateOnly(source.periodEnd)}`) : '';
      return { label: 'Paid', detail: `A subscription: ${SUBSCRIPTION_STATUS_LABELS[source.status].toLowerCase()}${end}.` };
    }
    case 'given':
      return { label: 'For a time', detail: `Pro given until ${dateOnly(source.until)}${source.reason ? ` (${reasonLabel(source.reason)})` : ''}. No payment.` };
    case 'assigned':
      return { label: 'No end date', detail: 'Pro given by an admin, with no end date. No payment.' };
  }
}

/** What happened, in words. */
export function describeEvent(event: AdminAuditEvent): string {
  const m = event.metadata;
  switch (event.type) {
    case 'user.registered':
      return m.provider === 'credential' ? 'Created an account with email and password' : 'Created an account with Google';
    case 'user.login':
      if (m.method === 'username') return 'Signed in with username and password';
      return m.method === 'password' ? 'Signed in with password' : m.method === 'email_link' ? 'Signed in from a confirmation link' : 'Signed in';
    case 'user.logout':
      return 'Signed out';
    case 'user.email_verified':
      return 'Confirmed their email address';
    case 'user.password_changed':
      return 'Changed their password';
    case 'user.password_reset':
      return 'Reset their password (all devices signed out)';
    case 'user.profile_updated':
      return `Updated their profile (${String(m.fields ?? '').split(',').filter(Boolean).join(', ') || 'details'})`;
    case 'user.consent_changed':
      return m.granted ? 'Turned on news by email' : 'Turned off news by email';
    case 'user.session_revoked':
      return 'Signed out another device';
    case 'user.sessions_revoked':
      return `Signed out ${Number(m.count ?? 0)} other ${Number(m.count) === 1 ? 'device' : 'devices'}`;
    case 'account.linked':
      return m.provider === 'credential' ? 'Added a password' : 'Connected Google';
    case 'account.unlinked':
      return m.provider === 'credential' ? 'Removed their password' : 'Disconnected Google';
    case 'account.data_exported':
      return 'Downloaded their data';
    case 'account.deleted':
      return 'Deleted their account';
    case 'auth.login_failed':
      return m.method === 'username' ? 'Failed username sign-in' : 'Failed password sign-in';
    case 'auth.throttled':
      if (m.purpose === 'signups') return 'New sign-ups paused: too many new accounts this hour or day';
      return m.purpose === 'mail' ? 'Email limit reached' : 'Sign-in paused after too many attempts';
    case 'admin.role_granted':
      return 'Made an admin';
    case 'admin.role_revoked':
      return 'Admin access removed';
    case 'admin.plan_changed':
      // The assigned plan: Pro there is Pro with no end date.
      if (m.to === 'pro') return `Pro given with no end date${m.reason ? ` (${reasonLabel(m.reason)})` : ''}`;
      if (m.from === 'pro') return 'Pro with no end date ended';
      return `Plan changed: ${plan(m.from)} → ${plan(m.to)}`;
    case 'admin.account_suspended':
      return `Account suspended (${String(m.reason ?? 'no reason')})`;
    case 'admin.account_reactivated':
      return 'Account reactivated';
    case 'admin.test_flag_changed':
      return m.test ? 'Marked as a test account' : 'No longer a test account';
    case 'admin.account_created':
      return `Account created for username sign-in (${plan(m.plan)}${m.test ? ', test account' : ''})`;
    case 'admin.account_removed':
      return 'Username account removed from the server command line';
    case 'admin.password_reset':
      return `Password reset by an admin (${Number(m.sessionsEnded ?? 0)} ${Number(m.sessionsEnded) === 1 ? 'session' : 'sessions'} signed out)`;
    case 'admin.sessions_revoked':
      return `Signed out everywhere by an admin (${Number(m.count ?? 0)} ${Number(m.count) === 1 ? 'session' : 'sessions'})`;
    case 'admin.initial_password_revealed':
      return 'Initial password revealed to an admin (then removed from the server)';
    case 'admin.grant_created':
      return `${plan(m.planId)} given for ${Number(m.days ?? 0)} days (${reasonLabel(m.reason)})`;
    case 'admin.grant_extended':
      return `${plan(m.planId)} extended by ${Number(m.days ?? 0)} days, until ${typeof m.to === 'string' ? dateOnly(new Date(m.to)) : '?'}`;
    case 'admin.grant_revoked':
      return 'Given access ended early';
    case 'admin.audit_exported':
      return 'Exported the activity log';
    case 'admin.mfa_enrolled':
      return 'Turned on two-factor verification';
    case 'admin.mfa_verified':
      return m.method === 'recovery' ? 'Passed two-factor verification with a recovery code' : 'Passed two-factor verification';
    case 'admin.mfa_failed':
      return 'Entered a wrong two-factor code';
    case 'admin.mfa_codes_regenerated':
      return 'Made new two-factor recovery codes';
    case 'admin.mfa_disabled':
      return 'Turned off two-factor verification';
    case 'admin.mfa_reset':
      return 'Two-factor verification removed from the server command line';
    case 'admin.mfa_device_trusted':
      return m.renewed ? 'Entered a code on a trusted device (trusted for another 90 days at most)' : 'Trusted a device for two-factor verification';
    case 'admin.mfa_device_used':
      return 'Passed two-factor verification on a trusted device';
    case 'admin.mfa_device_revoked':
      return `Forgot ${Number(m.count ?? 0)} trusted ${Number(m.count) === 1 ? 'device' : 'devices'}`;
    case 'admin.owner_set':
      return 'Made the owner, from the server command line';
    case 'account.status_changed':
      return `Account ${String(m.status ?? 'status changed')}`;
    case 'subscription.changed':
      return `Subscription ${String(m.status ?? 'changed')}`;
    case 'billing.checkout_started':
      return `Started checkout (${String(m.priceId ?? 'price')}${m.coupon ? `, coupon ${String(m.coupon)}` : ''})`;
    case 'billing.payment':
      return `${m.kind === 'refund' ? 'Refund' : m.kind === 'chargeback' ? 'Chargeback' : 'Payment'} ${m.status === 'failed' ? 'failed' : 'recorded'}: ${formatMoney(Number(m.amountMinor ?? 0), String(m.currency ?? 'USD') as 'USD')}`;
    case 'billing.cancel_requested':
      return m.mode === 'now' ? 'Asked to cancel the subscription now' : 'Asked to cancel the subscription at the end of the period';
    case 'billing.reconciled':
      return `Subscription corrected to match the payment provider (${String(m.fields ?? '')})`;
    default:
      return event.type;
  }
}

/** Who did it, from the point of view of the admin reading the log. */
export function actorLabel(event: AdminAuditEvent, viewerId: string): string {
  const { actor } = event;
  if (actor.kind === 'cli') return 'Server command line';
  if (actor.kind === 'webhook') return 'Payment provider';
  if (actor.kind === 'system') return 'System';
  if (actor.id === viewerId) return 'You';
  if (actor.kind === 'user' && actor.id === event.subject?.id) return 'The user';
  return actor.email ?? (actor.kind === 'admin' ? 'An admin' : 'A user');
}

/** Groups of event types for the activity filter. */
export const EVENT_GROUPS: { id: string; label: string; types: AdminAuditEvent['type'][] }[] = [
  { id: 'signins', label: 'Sign-ins', types: ['user.login', 'user.logout', 'auth.login_failed', 'auth.throttled'] },
  { id: 'registrations', label: 'Registrations and deletions', types: ['user.registered', 'user.email_verified', 'account.deleted'] },
  {
    id: 'security',
    label: 'Passwords, methods and devices',
    types: [
      'user.password_changed',
      'user.password_reset',
      'admin.password_reset',
      'admin.initial_password_revealed',
      'admin.sessions_revoked',
      'account.linked',
      'account.unlinked',
      'user.session_revoked',
      'user.sessions_revoked',
      'admin.mfa_enrolled',
      'admin.mfa_verified',
      'admin.mfa_failed',
      'admin.mfa_codes_regenerated',
      'admin.mfa_disabled',
      'admin.mfa_reset',
      'admin.mfa_device_trusted',
      'admin.mfa_device_used',
      'admin.mfa_device_revoked',
    ],
  },
  { id: 'profile', label: 'Profile, consent and data', types: ['user.profile_updated', 'user.consent_changed', 'account.data_exported'] },
  {
    id: 'admin',
    label: 'Admin changes',
    types: [
      'admin.role_granted',
      'admin.role_revoked',
      'admin.owner_set',
      'admin.plan_changed',
      'admin.account_suspended',
      'admin.account_reactivated',
      'admin.test_flag_changed',
      'admin.account_created',
      'admin.account_removed',
      'admin.grant_created',
      'admin.grant_extended',
      'admin.grant_revoked',
      'admin.audit_exported',
      'account.status_changed',
    ],
  },
  { id: 'billing', label: 'Billing', types: ['subscription.changed', 'billing.checkout_started', 'billing.payment', 'billing.cancel_requested', 'billing.reconciled'] },
];

/** Who published a configuration version, as the reading admin sees it. */
export const publishedByLabel = (actor: string | null, viewerId: string) =>
  actor === `admin:${viewerId}` ? 'you' : actor?.startsWith('admin:') ? 'an admin' : actor === 'system' ? 'the system (defaults)' : (actor ?? '—');
