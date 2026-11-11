import 'server-only';
import { cache } from 'react';
import { headers } from 'next/headers';
import { notFound, redirect } from 'next/navigation';
import { FRESH_SESSION_SECONDS, getAuth } from '@/server/auth';
import { getDb } from '@/server/db/client';
import { collections, toObjectId } from '@/server/db/collections';
import { signInPath } from '@/lib/redirects';

// Server-side session checks for pages and API routes. The proxy only looks
// for a session cookie (fast, forgeable); these verify the session itself.

/**
 * The verified session for this request, or null. Cached for the request.
 * Better Auth may answer from its 5-minute signed cookie cache; the session is
 * then confirmed against the database too, so a session that was ended (sign
 * out of other devices, suspension, account deletion) stops working on its
 * very next request, not minutes later.
 */
export const getSession = cache(async () => {
  // Reading the request first also marks the page as per-request for Next.js.
  const requestHeaders = await headers();
  const session = await getAuth().api.getSession({ headers: requestHeaders });
  if (!session || session.user.status !== 'active') return null;
  const live = await collections(getDb()).sessions.countDocuments({ token: session.session.token, expiresAt: { $gt: new Date() } }, { limit: 1 });
  return live > 0 ? session : null;
});

/** Pages: the signed-in user, or a redirect to sign-in that comes back to `returnTo`. */
export async function requireUser(returnTo: string) {
  const session = await getSession();
  if (!session) redirect(signInPath(returnTo));
  return session.user;
}

/**
 * The signed-in administrator, or null. The role is re-read from the database
 * (never from the session's cookie cache), so a revoked admin loses access on
 * their very next request. Server actions call this before doing anything.
 */
export async function currentAdmin() {
  const session = await getSession();
  const id = session ? toObjectId(session.user.id) : null;
  if (!id) return null;
  const fresh = await collections(getDb()).users.findOne({ _id: id }, { projection: { role: 1, status: 1 } });
  if (fresh?.role !== 'admin' || fresh.status !== 'active') return null;
  return { id, user: session!.user, signedInAt: new Date(session!.session.createdAt) };
}

/** Whether a session started recently enough for sensitive changes (FRESH_SESSION_SECONDS). */
export const signedInRecently = (signedInAt: Date, now = Date.now()) => now - signedInAt.getTime() < FRESH_SESSION_SECONDS * 1000;

/**
 * Admin pages: anyone who is not an administrator gets a plain 404 — the page
 * does not exist for them.
 */
export async function requireAdmin(returnTo = '/admin') {
  await requireUser(returnTo);
  const admin = await currentAdmin();
  if (!admin) notFound();
  return admin;
}
