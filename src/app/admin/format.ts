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
      return 'Created an account with Google';
    case 'user.login':
      return 'Signed in';
    case 'user.logout':
      return 'Signed out';
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
