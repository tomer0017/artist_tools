import 'server-only';
import { cache } from 'react';
import { headers } from 'next/headers';
import { notFound, redirect } from 'next/navigation';
import { getAuth } from '@/server/auth';
import { getDb } from '@/server/db/client';
import { collections, toObjectId } from '@/server/db/collections';
import { signInPath } from '@/lib/redirects';

// Server-side session checks for pages and API routes. The proxy only looks
// for a session cookie (fast, forgeable); these verify the session itself.

/** The verified session for this request, or null. Cached for the request. */
export const getSession = cache(async () => {
  // Reading the request first also marks the page as per-request for Next.js.
  const requestHeaders = await headers();
  const session = await getAuth().api.getSession({ headers: requestHeaders });
  if (!session || session.user.status !== 'active') return null;
  return session;
});

/** Pages: the signed-in user, or a redirect to sign-in that comes back to `returnTo`. */
export async function requireUser(returnTo: string) {
  const session = await getSession();
  if (!session) redirect(signInPath(returnTo));
  return session.user;
}

/**
 * Admin pages: the role is re-read from the database (never from the session's
 * cookie cache), and anyone else gets a plain 404 — the page does not exist
 * for them.
 */
export async function requireAdmin(returnTo = '/admin') {
  const user = await requireUser(returnTo);
  const fresh = await collections(getDb()).users.findOne({ _id: toObjectId(user.id) }, { projection: { role: 1, status: 1 } });
  if (fresh?.role !== 'admin' || fresh.status !== 'active') notFound();
  return user;
}
