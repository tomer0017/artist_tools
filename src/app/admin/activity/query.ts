import 'server-only';
import { ObjectId } from 'mongodb';
import type { AuditQuery } from '@/server/admin';
import { getDb } from '@/server/db/client';
import { collections } from '@/server/db/collections';
import { EVENT_GROUPS } from '../format';

// The activity filter, read from the URL (the page and its CSV export share
// it). Unknown values are ignored; an unknown account email matches nothing.

const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value) ?? '';
const day = (value: string, offsetDays = 0) =>
  /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(new Date(`${value}T00:00:00Z`).getTime() + offsetDays * 86_400_000) : undefined;

export const ACTORS = [
  ['user', 'The person themselves'],
  ['admin', 'An admin'],
  ['system', 'The system'],
  ['cli', 'Server command line'],
  ['webhook', 'Payment provider'],
] as const;

const NOBODY = new ObjectId('000000000000000000000000');

export async function auditQueryFrom(params: Record<string, string | string[] | undefined>): Promise<{ query: AuditQuery; active: Record<string, string> }> {
  const v = (name: string) => first(params[name]);
  const query: AuditQuery = {};
  const group = EVENT_GROUPS.find((g) => g.id === v('kind'));
  if (group) query.types = group.types;
  const actor = ACTORS.find(([id]) => id === v('by'))?.[0];
  if (actor) query.actorKind = actor;
  query.from = day(v('from'));
  query.before = day(v('to'), 1);
  const email = v('email').trim().toLowerCase().slice(0, 200);
  if (email) {
    const user = await collections(getDb()).users.findOne({ email }, { projection: { _id: 1 } });
    query.userId = user?._id ?? NOBODY;
  }
  const active: Record<string, string> = {};
  for (const name of ['kind', 'by', 'from', 'to', 'email']) if (v(name)) active[name] = v(name);
  return { query, active };
}
