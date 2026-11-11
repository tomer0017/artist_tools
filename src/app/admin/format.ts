import { formatMoney } from '@/lib/money';
import { PLAN_NAMES, isPlanId } from '@/lib/plans';
import type { AdminAuditEvent } from '@/server/admin';

// Presentation helpers for the admin pages (server-rendered). Times are shown
// in UTC, labelled as such, so every admin reads the same clock.

const DATE_TIME = new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' });
const DATE = new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeZone: 'UTC' });

export const dateTime = (value: Date | null) => (value ? `${DATE_TIME.format(value)} UTC` : '—');
export const dateOnly = (value: Date | null) => (value ? DATE.format(value) : '—');

const plan = (value: unknown) => (isPlanId(value) ? PLAN_NAMES[value] : String(value ?? '?'));

/** What happened, in words. */
export function describeEvent(event: AdminAuditEvent): string {
  const m = event.metadata;
  switch (event.type) {
    case 'user.registered':
      return m.provider === 'credential' ? 'Created an account with email and password' : 'Created an account with Google';
    case 'user.login':
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
      return 'Failed password sign-in';
    case 'auth.throttled':
      return m.purpose === 'mail' ? 'Email limit reached' : 'Sign-in paused after too many attempts';
    case 'admin.role_granted':
      return 'Made an admin';
    case 'admin.role_revoked':
      return 'Admin access removed';
    case 'admin.plan_changed':
      return `Plan changed: ${plan(m.from)} → ${plan(m.to)}`;
    case 'admin.account_suspended':
      return `Account suspended (${String(m.reason ?? 'no reason')})`;
    case 'admin.account_reactivated':
      return 'Account reactivated';
    case 'admin.test_flag_changed':
      return m.test ? 'Marked as a test account' : 'No longer a test account';
    case 'admin.grant_created':
      return `${plan(m.planId)} given for ${Number(m.days ?? 0)} days (${String(m.reason ?? '')})`;
    case 'admin.grant_revoked':
      return 'Given access ended early';
    case 'admin.audit_exported':
      return 'Exported the activity log';
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
    types: ['user.password_changed', 'user.password_reset', 'account.linked', 'account.unlinked', 'user.session_revoked', 'user.sessions_revoked'],
  },
  { id: 'profile', label: 'Profile, consent and data', types: ['user.profile_updated', 'user.consent_changed', 'account.data_exported'] },
  {
    id: 'admin',
    label: 'Admin changes',
    types: [
      'admin.role_granted',
      'admin.role_revoked',
      'admin.plan_changed',
      'admin.account_suspended',
      'admin.account_reactivated',
      'admin.test_flag_changed',
      'admin.grant_created',
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
