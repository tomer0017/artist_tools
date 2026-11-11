'use server';

import { cookies, headers } from 'next/headers';
import { z } from 'zod';
import { CURRENCIES, LOCALES } from '@/lib/locale';
import { LOCALE_COOKIE } from '@/i18n/config';
import { getT, messagesFor } from '@/i18n/server';
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
import { checkPassword, type PasswordProblem } from '@/server/security/password-policy';
import { getSession } from '@/server/session';

// The account page's own changes. Next.js accepts server actions only from
// this site's pages (it compares Origin and Host); each action then takes the
// account from the verified session — never from its input — validates the
// input, and is audited by the operation it calls. Changes that could lock
// someone out or hand the account to someone else (adding a password,
// deleting the account) also need a session started in the last 10 minutes.
// Messages are in the language of the request (the account's language).

export type ActionResult = { ok: true; message?: string } | { ok: false; reason: 'signed_out' | 'invalid' | 'reauth' | 'refused' | 'failed'; message: string };

type Reason = Extract<ActionResult, { ok: false }>['reason'];
const refusal = (reason: Reason, message: string): ActionResult => ({ ok: false, reason, message });

/** The account page's translator, with the common refusals. */
async function texts() {
  const t = await getT('account');
  return {
    t,
    signedOut: refusal('signed_out', t('actions.signedOut')),
    invalid: refusal('invalid', t('actions.invalid')),
    reauth: refusal('reauth', t('actions.reauth')),
    failed: refusal('failed', t('tryAgain')),
  };
}

async function passwordMessage(problem: PasswordProblem): Promise<string> {
  const t = await getT('auth');
  switch (problem) {
    case 'too_short':
      return t('errors.PASSWORD_TOO_SHORT');
    case 'too_long':
      return t('errors.PASSWORD_TOO_LONG');
    case 'too_common':
      return t('errors.PASSWORD_TOO_COMMON');
    case 'too_predictable':
      return t('errors.PASSWORD_TOO_PREDICTABLE');
    case 'personal':
      return t('errors.PASSWORD_PERSONAL');
  }
}

/** The word typed to confirm deletion, in any of the languages ("DELETE", "מחיקה"). */
const CONFIRM_WORDS = new Set((['en', 'he'] as const).map((locale) => messagesFor(locale).account.data.confirmWord.toUpperCase()));

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
  const m = await texts();
  const who = await caller();
  if (!who) return m.signedOut;
  const parsed = ProfileInput.safeParse(input);
  if (!parsed.success) return m.invalid;
  try {
    const result = await updateProfile(getDb(), who.userId, parsed.data);
    if (result === 'invalid') return refusal('invalid', m.t('actions.nameInvalid'));
    if (result === 'not_found') return m.signedOut;
    // Public pages and emails follow the chosen language from now on.
    if (parsed.data.locale) (await cookies()).set(LOCALE_COOKIE, parsed.data.locale, { path: '/', sameSite: 'lax', maxAge: 60 * 60 * 24 * 365 });
    // Said in the language just chosen.
    const saved = parsed.data.locale ? messagesFor(parsed.data.locale).account.saved : m.t('saved');
    return { ok: true, message: result === 'updated' ? saved : undefined };
  } catch (error) {
    log.error('account.profile_failed', { error });
    return m.failed;
  }
}

export async function saveMarketingConsent(input: unknown): Promise<ActionResult> {
  const m = await texts();
  const who = await caller();
  if (!who) return m.signedOut;
  const parsed = z.object({ granted: z.boolean() }).strict().safeParse(input);
  if (!parsed.success) return m.invalid;
  try {
    const result = await setMarketingConsent(getDb(), who.userId, parsed.data.granted, 'profile');
    if (result === 'not_found') return m.signedOut;
    return { ok: true, message: parsed.data.granted ? m.t('actions.newsOn') : m.t('actions.newsOff') };
  } catch (error) {
    log.error('account.consent_failed', { error });
    return m.failed;
  }
}

export async function loadDeviceSessions(): Promise<{ ok: true; sessions: DeviceSession[] } | ActionResult> {
  const m = await texts();
  const who = await caller();
  if (!who) return m.signedOut;
  try {
    return { ok: true, sessions: await listDeviceSessions(getDb(), who.userId, who.session.session.token) };
  } catch (error) {
    log.error('account.sessions_failed', { error });
    return m.failed;
  }
}

export async function signOutDevice(input: unknown): Promise<ActionResult> {
  const m = await texts();
  const who = await caller();
  if (!who) return m.signedOut;
  const parsed = z.object({ sessionId: z.string().regex(/^[0-9a-f]{24}$/i) }).strict().safeParse(input);
  if (!parsed.success) return m.invalid;
  try {
    const result = await revokeDeviceSession(getDb(), who.userId, toObjectId(parsed.data.sessionId)!, who.session.session.token);
    if (result === 'current') return refusal('refused', m.t('actions.deviceCurrent'));
    return { ok: true, message: result === 'revoked' ? m.t('actions.deviceRevoked') : m.t('actions.deviceAlready') };
  } catch (error) {
    log.error('account.session_revoke_failed', { error });
    return m.failed;
  }
}

export async function signOutOtherDevices(): Promise<ActionResult> {
  const m = await texts();
  const who = await caller();
  if (!who) return m.signedOut;
  try {
    const count = await revokeOtherSessions(getDb(), who.userId, who.session.session.token);
    return { ok: true, message: m.t('actions.othersSignedOut', { count }) };
  } catch (error) {
    log.error('account.sessions_revoke_failed', { error });
    return m.failed;
  }
}

/** Give a Google account a password too (same, already verified address). */
export async function addPassword(input: unknown): Promise<ActionResult> {
  const m = await texts();
  const who = await caller();
  if (!who) return m.signedOut;
  if (!emailPasswordAvailable()) return refusal('refused', m.t('actions.passwordsUnavailable'));
  const parsed = z.object({ password: z.string().max(1000) }).strict().safeParse(input);
  if (!parsed.success) return m.invalid;
  if (!isFresh(who.session)) return m.reauth;
  const problem = checkPassword(parsed.data.password, { email: who.session.user.email, name: who.session.user.name });
  if (problem) return refusal('invalid', await passwordMessage(problem));
  try {
    // Audited and emailed by the auth hooks when the password sign-in is created.
    await getAuth().api.setPassword({ body: { newPassword: parsed.data.password }, headers: await headers() });
    return { ok: true, message: m.t('actions.passwordAdded') };
  } catch (error) {
    const code = (error as { body?: { code?: string } }).body?.code;
    if (code === 'PASSWORD_ALREADY_SET') return refusal('refused', m.t('actions.passwordAlreadySet'));
    log.error('account.add_password_failed', { error });
    return m.failed;
  }
}

/**
 * Delete the account and its personal data, after a fresh sign-in and a typed
 * confirmation. The person is signed out and told by email.
 */
export async function deleteMyAccount(input: unknown): Promise<ActionResult> {
  const m = await texts();
  const who = await caller();
  if (!who) return m.signedOut;
  const parsed = z.object({ confirmation: z.string().max(20) }).strict().safeParse(input);
  if (!parsed.success || !CONFIRM_WORDS.has(parsed.data.confirmation.trim().toUpperCase())) {
    return refusal('invalid', m.t('actions.typeToDelete', { word: m.t('data.confirmWord') }));
  }
  if (!isFresh(who.session)) return m.reauth;
  try {
    const db = getDb();
    const result = await deleteAccount(db, who.userId);
    if (result.status === 'last_admin') return refusal('refused', m.t('actions.lastAdmin'));
    if (result.status === 'active_subscription') return refusal('refused', m.t('actions.subscriptionFirst'));
    if (result.status === 'not_found') return m.signedOut;
    log.info('account.deleted', { userId: who.userId.toHexString() });
    runInBackground(createMailer(db, authConfig().mail.transport).deliver(mailTemplates(result.locale).accountDeleted(result.name), { address: result.email, userId: null }));
    const jar = await cookies();
    for (const name of ['session_token', 'session_data', 'dont_remember']) {
      jar.delete(`${COOKIE_PREFIX}.${name}`);
      jar.delete(`__Secure-${COOKIE_PREFIX}.${name}`);
    }
    return { ok: true, message: m.t('actions.deleted') };
  } catch (error) {
    log.error('account.delete_failed', { error });
    return m.failed;
  }
}
