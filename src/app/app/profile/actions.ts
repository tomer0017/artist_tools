'use server';

import { cookies, headers } from 'next/headers';
import { z } from 'zod';
import { CURRENCIES, LOCALES } from '@/lib/locale';
import {
  deleteAccount,
  listDeviceSessions,
  revokeDeviceSession,
  revokeOtherSessions,
  setMarketingConsent,
  updateProfile,
  type DeviceSession,
} from '@/server/account-management';
import { COOKIE_PREFIX, FRESH_SESSION_SECONDS, emailPasswordAvailable, getAuth } from '@/server/auth';
import { runInBackground } from '@/server/background';
import { getDb } from '@/server/db/client';
import { toObjectId } from '@/server/db/collections';
import { authConfig } from '@/server/env';
import { log } from '@/server/log';
import { createMailer } from '@/server/mail/mailer';
import { mailTemplates } from '@/server/mail/templates';
import { PASSWORD_MESSAGES, checkPassword } from '@/server/security/password-policy';
import { getSession } from '@/server/session';

// The account page's own changes. Next.js accepts server actions only from
// this site's pages (it compares Origin and Host); each action then takes the
// account from the verified session — never from its input — validates the
// input, and is audited by the operation it calls. Changes that could lock
// someone out or hand the account to someone else (adding a password,
// deleting the account) also need a session started in the last 10 minutes.

export type ActionResult = { ok: true; message?: string } | { ok: false; reason: 'signed_out' | 'invalid' | 'reauth' | 'refused' | 'failed'; message: string };

const SIGNED_OUT: ActionResult = { ok: false, reason: 'signed_out', message: 'Your session has ended. Please sign in again.' };
const INVALID: ActionResult = { ok: false, reason: 'invalid', message: 'That was not valid. Please check and try again.' };
const REAUTH: ActionResult = { ok: false, reason: 'reauth', message: 'For your security, please confirm it is you first.' };
const FAILED: ActionResult = { ok: false, reason: 'failed', message: 'That did not work. Please try again.' };

async function caller() {
  const session = await getSession();
  const userId = session ? toObjectId(session.user.id) : null;
  return session && userId ? { session, userId } : null;
}

/** Whether the session was started (signed in) within the last 10 minutes. */
const isFresh = (session: { session: { createdAt: Date | string } }) =>
  Date.now() - new Date(session.session.createdAt).getTime() < FRESH_SESSION_SECONDS * 1000;

const ProfileInput = z
  .object({
    name: z.string().max(200).optional(),
    locale: z.enum(LOCALES).optional(),
    currency: z.enum(CURRENCIES).optional(),
    removeImage: z.literal(true).optional(),
  })
  .strict();

export async function saveProfile(input: unknown): Promise<ActionResult> {
  const who = await caller();
  if (!who) return SIGNED_OUT;
  const parsed = ProfileInput.safeParse(input);
  if (!parsed.success) return INVALID;
  try {
    const result = await updateProfile(getDb(), who.userId, parsed.data);
    if (result === 'invalid') return { ok: false, reason: 'invalid', message: 'Use a name of 1 to 80 characters.' };
    if (result === 'not_found') return SIGNED_OUT;
    return { ok: true, message: result === 'updated' ? 'Saved.' : undefined };
  } catch (error) {
    log.error('account.profile_failed', { error });
    return FAILED;
  }
}

export async function saveMarketingConsent(input: unknown): Promise<ActionResult> {
  const who = await caller();
  if (!who) return SIGNED_OUT;
  const parsed = z.object({ granted: z.boolean() }).strict().safeParse(input);
  if (!parsed.success) return INVALID;
  try {
    const result = await setMarketingConsent(getDb(), who.userId, parsed.data.granted, 'profile');
    if (result === 'not_found') return SIGNED_OUT;
    return { ok: true, message: parsed.data.granted ? 'You will get occasional news by email.' : 'No marketing emails.' };
  } catch (error) {
    log.error('account.consent_failed', { error });
    return FAILED;
  }
}

export async function loadDeviceSessions(): Promise<{ ok: true; sessions: DeviceSession[] } | ActionResult> {
  const who = await caller();
  if (!who) return SIGNED_OUT;
  try {
    return { ok: true, sessions: await listDeviceSessions(getDb(), who.userId, who.session.session.token) };
  } catch (error) {
    log.error('account.sessions_failed', { error });
    return FAILED;
  }
}

export async function signOutDevice(input: unknown): Promise<ActionResult> {
  const who = await caller();
  if (!who) return SIGNED_OUT;
  const parsed = z.object({ sessionId: z.string().regex(/^[0-9a-f]{24}$/i) }).strict().safeParse(input);
  if (!parsed.success) return INVALID;
  try {
    const result = await revokeDeviceSession(getDb(), who.userId, toObjectId(parsed.data.sessionId)!, who.session.session.token);
    if (result === 'current') return { ok: false, reason: 'refused', message: 'That is this device: use Sign out instead.' };
    return { ok: true, message: result === 'revoked' ? 'Signed out on that device.' : 'That device was already signed out.' };
  } catch (error) {
    log.error('account.session_revoke_failed', { error });
    return FAILED;
  }
}

export async function signOutOtherDevices(): Promise<ActionResult> {
  const who = await caller();
  if (!who) return SIGNED_OUT;
  try {
    const count = await revokeOtherSessions(getDb(), who.userId, who.session.session.token);
    return { ok: true, message: count === 0 ? 'No other devices were signed in.' : `Signed out on ${count} other ${count === 1 ? 'device' : 'devices'}.` };
  } catch (error) {
    log.error('account.sessions_revoke_failed', { error });
    return FAILED;
  }
}

/** Give a Google account a password too (same, already verified address). */
export async function addPassword(input: unknown): Promise<ActionResult> {
  const who = await caller();
  if (!who) return SIGNED_OUT;
  if (!emailPasswordAvailable()) return { ok: false, reason: 'refused', message: 'Passwords are not available on this server.' };
  const parsed = z.object({ password: z.string().max(1000) }).strict().safeParse(input);
  if (!parsed.success) return INVALID;
  if (!isFresh(who.session)) return REAUTH;
  const problem = checkPassword(parsed.data.password, { email: who.session.user.email, name: who.session.user.name });
  if (problem) return { ok: false, reason: 'invalid', message: PASSWORD_MESSAGES[problem] };
  try {
    // Audited and emailed by the auth hooks when the password sign-in is created.
    await getAuth().api.setPassword({ body: { newPassword: parsed.data.password }, headers: await headers() });
    return { ok: true, message: 'Password added. You can now sign in with your email and this password too.' };
  } catch (error) {
    const code = (error as { body?: { code?: string } }).body?.code;
    if (code === 'PASSWORD_ALREADY_SET') return { ok: false, reason: 'refused', message: 'This account already has a password. Use Change password.' };
    log.error('account.add_password_failed', { error });
    return FAILED;
  }
}

/**
 * Delete the account and its personal data, after a fresh sign-in and a typed
 * confirmation. The person is signed out and told by email.
 */
export async function deleteMyAccount(input: unknown): Promise<ActionResult> {
  const who = await caller();
  if (!who) return SIGNED_OUT;
  const parsed = z.object({ confirmation: z.string().max(20) }).strict().safeParse(input);
  if (!parsed.success || parsed.data.confirmation.trim().toUpperCase() !== 'DELETE') {
    return { ok: false, reason: 'invalid', message: 'Type DELETE to confirm.' };
  }
  if (!isFresh(who.session)) return REAUTH;
  try {
    const db = getDb();
    const result = await deleteAccount(db, who.userId);
    if (result.status === 'last_admin') {
      return { ok: false, reason: 'refused', message: 'You are the last administrator. Make someone else an administrator first.' };
    }
    if (result.status === 'active_subscription') {
      return { ok: false, reason: 'refused', message: 'Cancel your subscription first; then you can delete the account.' };
    }
    if (result.status === 'not_found') return SIGNED_OUT;
    log.info('account.deleted', { userId: who.userId.toHexString() });
    runInBackground(createMailer(db, authConfig().mail.transport).deliver(mailTemplates.accountDeleted(result.name), { address: result.email, userId: null }));
    const jar = await cookies();
    for (const name of ['session_token', 'session_data', 'dont_remember']) {
      jar.delete(`${COOKIE_PREFIX}.${name}`);
      jar.delete(`__Secure-${COOKIE_PREFIX}.${name}`);
    }
    return { ok: true, message: 'Your account was deleted.' };
  } catch (error) {
    log.error('account.delete_failed', { error });
    return FAILED;
  }
}
