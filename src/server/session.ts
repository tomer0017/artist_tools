import 'server-only';
import { cache } from 'react';
import { headers } from 'next/headers';
import { notFound, redirect } from 'next/navigation';
import { FRESH_SESSION_SECONDS, getAuth } from '@/server/auth';
import { adminGate, type AdminGate } from '@/server/admin-mfa';
import { getDb } from '@/server/db/client';
import { collections, toObjectId } from '@/server/db/collections';
import { authConfig } from '@/server/env';
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
  // Inside a server action (a POST with the Next-Action header), read the
  // session without renewing its cookies: any cookie written there makes
  // Next.js re-render the whole page into the action's reply, which is slow
  // and, while prefetches are in flight, sometimes left the action's promise
  // unresolved. Page loads still renew the session as people use the site.
  const inAction = requestHeaders.has('next-action');
  const session = await getAuth().api.getSession({
    headers: requestHeaders,
    query: inAction ? { disableCookieCache: true, disableRefresh: true } : undefined,
  });
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
 * The signed-in administrator by role alone, before the second factor, or
 * null. The role is re-read from the database (never from the session's
 * cookie cache), so a revoked admin loses access on their very next request.
 * Only the two-factor pages use this directly; everything else uses
 * `currentAdmin()` / `requireAdmin()`.
 */
export async function currentAdminRole() {
  const session = await getSession();
  const id = session ? toObjectId(session.user.id) : null;
  if (!id) return null;
  const fresh = await collections(getDb()).users.findOne({ _id: id }, { projection: { role: 1, status: 1 } });
  if (fresh?.role !== 'admin' || fresh.status !== 'active') return null;
  return {
    id,
    user: session!.user,
    signedInAt: new Date(session!.session.createdAt),
    session: { id: session!.session.id, expiresAt: new Date(session!.session.expiresAt) },
  };
}

/** What this administrator's session still needs before admin access (src/server/admin-mfa.ts). */
export async function adminAccessGate(admin: NonNullable<Awaited<ReturnType<typeof currentAdminRole>>>): Promise<AdminGate> {
  return adminGate(getDb(), admin.id, admin.session.id, authConfig().adminMfaRequired);
}

/**
 * The signed-in administrator who has passed two-factor verification for this
 * session (when they enrolled, or when it is required), or null. Server
 * actions and admin API routes call this before doing anything.
 */
export async function currentAdmin() {
  const admin = await currentAdminRole();
  if (!admin) return null;
  return (await adminAccessGate(admin)) === 'ok' ? admin : null;
}

/** Whether a session started recently enough for sensitive changes (FRESH_SESSION_SECONDS). */
export const signedInRecently = (signedInAt: Date, now = Date.now()) => now - signedInAt.getTime() < FRESH_SESSION_SECONDS * 1000;

/** Only admin addresses are returned to after verification (no open redirects). */
export const safeAdminPath = (path: string | null | undefined) => (path && /^\/admin(\/[\w\-/[\]]*)?(\?[\w=&%.-]*)?$/.test(path) && !path.startsWith('/admin/verify') ? path : '/admin');

/**
 * Admin pages: anyone who is not an administrator gets a plain 404 — the page
 * does not exist for them. An administrator who still needs the second factor
 * is sent to enter a code (or to enrol, when that is required) and comes back.
 * `allowEnrollment` is for the enrolment page itself.
 */
export async function requireAdmin(returnTo = '/admin', options: { allowEnrollment?: boolean } = {}) {
  await requireUser(returnTo);
  const admin = await currentAdminRole();
  if (!admin) notFound();
  const gate = await adminAccessGate(admin);
  if (gate === 'verify') redirect(`/admin/verify?returnTo=${encodeURIComponent(safeAdminPath(returnTo))}`);
  if (gate === 'enroll' && !options.allowEnrollment) redirect('/admin/security');
  return admin;
}

/** The verification page: an administrator by role, whatever the second factor's state. */
export async function requireAdminRole(returnTo = '/admin') {
  await requireUser(returnTo);
  const admin = await currentAdminRole();
  if (!admin) notFound();
  return admin;
}
