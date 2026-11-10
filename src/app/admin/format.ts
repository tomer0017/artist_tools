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
    case 'account.status_changed':
      return `Account ${String(m.status ?? 'status changed')}`;
    case 'subscription.changed':
      return `Subscription ${String(m.status ?? 'changed')}`;
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
