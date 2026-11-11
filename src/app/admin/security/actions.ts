'use server';

import { z } from 'zod';
import { encode } from 'uqr';
import { confirmEnrollment, disableMfa, regenerateRecoveryCodes, startEnrollment, verifySession, type CodeResult } from '@/server/admin-mfa';
import { getDb } from '@/server/db/client';
import { log } from '@/server/log';
import { adminAccessGate, currentAdmin, currentAdminRole, signedInRecently } from '@/server/session';

// Two-factor verification for administrators (src/server/admin-mfa.ts). The
// account always comes from the verified session, never from the input.
// Enrolling and turning 2FA off also need a sign-in within the last 10
// minutes, like the other sensitive admin changes.

const Code = z.object({ code: z.string().trim().min(6).max(20) }).strict();

export type MfaResult =
  | { ok: true; recoveryCodes?: string[]; recoveryCodesLeft?: number }
  | { ok: false; reason: 'denied' | 'reauth' | 'invalid' | 'locked' | 'not_enrolled' | 'already_enrolled' | 'failed'; message: string };

type Refusal = Extract<MfaResult, { ok: false }>;
const DENIED: Refusal = { ok: false, reason: 'denied', message: 'You are not allowed to do that.' };
const REAUTH: Refusal = { ok: false, reason: 'reauth', message: 'For your security, confirm it is you (sign in again), then continue.' };
const INVALID_INPUT: Refusal = { ok: false, reason: 'invalid', message: 'Enter the 6-digit code from your authenticator app, or a recovery code.' };

function fromCode(result: CodeResult<object>): Refusal | null {
  if (result.status === 'ok') return null;
  if (result.status === 'locked') return { ok: false, reason: 'locked', message: 'Too many wrong codes. Wait 15 minutes, then try again.' };
  if (result.status === 'not_enrolled') return { ok: false, reason: 'not_enrolled', message: 'Two-factor verification is not set up for this account.' };
  return { ok: false, reason: 'invalid', message: 'That code did not work. Check the time on your phone is right, or use another code.' };
}

export type StartMfaResult = { ok: true; secret: string; uri: string; qr: string[] } | Refusal;

/** Begin enrolment: a new secret, shown once as a QR code and a setup key. */
export async function startAdminMfa(): Promise<StartMfaResult> {
  const admin = await currentAdminRole();
  if (!admin) return DENIED;
  if ((await adminAccessGate(admin)) === 'verify') return DENIED;
  if (!signedInRecently(admin.signedInAt)) return REAUTH;
  try {
    const result = await startEnrollment(getDb(), admin.id, admin.user.email);
    if (result.status === 'already_enrolled') return { ok: false, reason: 'already_enrolled', message: 'Two-factor verification is already on.' };
    const qr = encode(result.uri, { ecc: 'M', border: 0 }).data.map((row) => row.map((dark) => (dark ? '1' : '0')).join(''));
    return { ok: true, secret: result.secret, uri: result.uri, qr };
  } catch (error) {
    log.error('admin.mfa_start_failed', { error });
    return { ok: false, reason: 'failed', message: 'That did not work. Please try again.' };
  }
}

/** Finish enrolment with a first code; returns the recovery codes, shown once. */
export async function confirmAdminMfa(input: unknown): Promise<MfaResult> {
  const admin = await currentAdminRole();
  if (!admin) return DENIED;
  const parsed = Code.safeParse(input);
  if (!parsed.success) return INVALID_INPUT;
  const result = await confirmEnrollment(getDb(), admin.id, admin.session, parsed.data.code);
  return fromCode(result) ?? { ok: true, recoveryCodes: result.status === 'ok' ? result.recoveryCodes : [] };
}

/** Pass the second factor for this session. */
export async function verifyAdminMfa(input: unknown): Promise<MfaResult> {
  const admin = await currentAdminRole();
  if (!admin) return DENIED;
  const parsed = Code.safeParse(input);
  if (!parsed.success) return INVALID_INPUT;
  const result = await verifySession(getDb(), admin.id, admin.session, parsed.data.code);
  return fromCode(result) ?? { ok: true, recoveryCodesLeft: result.status === 'ok' ? result.recoveryCodesLeft : 0 };
}

/** New recovery codes; the old ones stop working. */
export async function regenerateAdminRecoveryCodes(input: unknown): Promise<MfaResult> {
  const admin = await currentAdmin();
  if (!admin) return DENIED;
  const parsed = Code.safeParse(input);
  if (!parsed.success) return INVALID_INPUT;
  const result = await regenerateRecoveryCodes(getDb(), admin.id, parsed.data.code);
  return fromCode(result) ?? { ok: true, recoveryCodes: result.status === 'ok' ? result.recoveryCodes : [] };
}

/** Turn two-factor verification off for this administrator. */
export async function disableAdminMfa(input: unknown): Promise<MfaResult> {
  const admin = await currentAdmin();
  if (!admin) return DENIED;
  if (!signedInRecently(admin.signedInAt)) return REAUTH;
  const parsed = Code.safeParse(input);
  if (!parsed.success) return INVALID_INPUT;
  return fromCode(await disableMfa(getDb(), admin.id, parsed.data.code)) ?? { ok: true };
}
