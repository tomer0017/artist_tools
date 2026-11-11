import 'server-only';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { Db, ObjectId } from 'mongodb';
import { recordAudit } from '@/server/audit';
import { collections, type AdminMfaDoc } from '@/server/db/collections';
import { open, seal } from '@/server/security/secret-box';
import { base32Encode, generateTotpSecret, otpauthUri, timeStep, verifyTotp } from '@/server/security/totp';

// ─── Two-factor verification for administrators (docs/security/admin-2fa.md) ──
// A step-up check on admin access itself, whatever the sign-in method:
// Better Auth's two-factor plugin covers password sign-ins only, and admins
// sign in with Google. An admin who has enrolled an authenticator app must
// enter a code (or a one-time recovery code) once per session, every 12
// hours, before any admin page or action works. Enrolment is voluntary
// unless ADMIN_MFA_REQUIRED=on, which is off until the owner approves it.

export const MFA_SESSION_HOURS = 12;
export const MAX_FAILURES = 5;
export const FAILURE_WINDOW_MS = 15 * 60 * 1000;
export const RECOVERY_CODE_COUNT = 10;

/** Recovery codes are compared without case, spaces or dashes. */
export const normalizeRecoveryCode = (code: string) => code.toUpperCase().replace(/[^A-Z0-9]/g, '');
const hashRecoveryCode = (code: string) => createHash('sha256').update(normalizeRecoveryCode(code)).digest('hex');

/** Ten codes like "K7Q2M-9XWTA" (50 random bits each). */
function newRecoveryCodes(): string[] {
  return Array.from({ length: RECOVERY_CODE_COUNT }, () => {
    const code = base32Encode(randomBytes(7)).slice(0, 10);
    return `${code.slice(0, 5)}-${code.slice(5)}`;
  });
}

export interface MfaStatus {
  enrolled: boolean;
  confirmedAt: Date | null;
  recoveryCodesLeft: number;
}

export async function mfaStatus(db: Db, userId: ObjectId): Promise<MfaStatus> {
  const doc = await collections(db).adminMfa.findOne({ _id: userId });
  return {
    enrolled: Boolean(doc?.confirmedAt),
    confirmedAt: doc?.confirmedAt ?? null,
    recoveryCodesLeft: doc?.confirmedAt ? doc.recoveryCodes.filter((c) => !c.usedAt).length : 0,
  };
}

const isLocked = (doc: Pick<AdminMfaDoc, 'failures' | 'failureWindowStart'>, now: Date) =>
  Boolean(doc.failureWindowStart) && now.getTime() - doc.failureWindowStart!.getTime() < FAILURE_WINDOW_MS && doc.failures >= MAX_FAILURES;

async function recordFailure(db: Db, doc: AdminMfaDoc, now: Date, stage: string) {
  const inWindow = doc.failureWindowStart && now.getTime() - doc.failureWindowStart.getTime() < FAILURE_WINDOW_MS;
  await collections(db).adminMfa.updateOne({ _id: doc._id }, inWindow ? { $inc: { failures: 1 } } : { $set: { failures: 1, failureWindowStart: now } });
  await recordAudit(db, { type: 'admin.mfa_failed', userId: doc._id, actor: `admin:${doc._id.toHexString()}`, metadata: { stage } });
}

/** Accept a TOTP code once: the time step is claimed in the same write, so a code cannot be used twice. */
async function acceptTotp(db: Db, doc: AdminMfaDoc, code: string, now: Date): Promise<boolean> {
  const secret = open(doc.secret);
  if (!secret) return false;
  const step = verifyTotp(secret, code, now.getTime(), doc.lastStep);
  if (step === null) return false;
  const { modifiedCount } = await collections(db).adminMfa.updateOne(
    { _id: doc._id, $or: [{ lastStep: null }, { lastStep: { $lt: step } }] },
    { $set: { lastStep: step, failures: 0, failureWindowStart: null, updatedAt: now } },
  );
  return modifiedCount === 1;
}

async function acceptRecoveryCode(db: Db, doc: AdminMfaDoc, code: string, now: Date): Promise<boolean> {
  const hash = hashRecoveryCode(code);
  if (!doc.recoveryCodes.some((c) => !c.usedAt && c.hash.length === hash.length && timingSafeEqual(Buffer.from(c.hash), Buffer.from(hash)))) return false;
  const { modifiedCount } = await collections(db).adminMfa.updateOne(
    { _id: doc._id, recoveryCodes: { $elemMatch: { hash, usedAt: null } } },
    { $set: { 'recoveryCodes.$.usedAt': now, failures: 0, failureWindowStart: null, updatedAt: now } },
  );
  return modifiedCount === 1;
}

async function markSessionVerified(db: Db, userId: ObjectId, sessionId: string, sessionExpiresAt: Date, method: 'totp' | 'recovery', now: Date) {
  const expiresAt = new Date(Math.min(sessionExpiresAt.getTime(), now.getTime() + MFA_SESSION_HOURS * 3600_000));
  await collections(db).adminMfaSessions.updateOne(
    { _id: sessionId },
    { $set: { userId, method, verifiedAt: now, expiresAt } },
    { upsert: true },
  );
}

export async function isSessionVerified(db: Db, userId: ObjectId, sessionId: string, now = new Date()): Promise<boolean> {
  return (await collections(db).adminMfaSessions.countDocuments({ _id: sessionId, userId, expiresAt: { $gt: now } }, { limit: 1 })) > 0;
}

export type AdminGate = 'ok' | 'verify' | 'enroll';

/** What an administrator's session needs before admin access: nothing, a code, or enrolment (only when required). */
export async function adminGate(db: Db, userId: ObjectId, sessionId: string, required: boolean, now = new Date()): Promise<AdminGate> {
  const doc = await collections(db).adminMfa.findOne({ _id: userId }, { projection: { confirmedAt: 1 } });
  if (doc?.confirmedAt) return (await isSessionVerified(db, userId, sessionId, now)) ? 'ok' : 'verify';
  return required ? 'enroll' : 'ok';
}

export type StartResult = { status: 'started'; secret: string; uri: string } | { status: 'already_enrolled' };

/** Begin (or begin again) enrolment: a new secret, not active until a first code confirms it. */
export async function startEnrollment(db: Db, userId: ObjectId, account: string, now = new Date()): Promise<StartResult> {
  const { adminMfa } = collections(db);
  const existing = await adminMfa.findOne({ _id: userId }, { projection: { confirmedAt: 1 } });
  if (existing?.confirmedAt) return { status: 'already_enrolled' };
  const secret = generateTotpSecret();
  await adminMfa.updateOne(
    { _id: userId, confirmedAt: null },
    {
      $set: { secret: seal(secret), recoveryCodes: [], lastStep: null, failures: 0, failureWindowStart: null, updatedAt: now },
      $setOnInsert: { createdAt: now }, // confirmedAt: null comes from the query
    },
    { upsert: true },
  );
  return { status: 'started', secret, uri: otpauthUri(secret, account) };
}

export type CodeResult<T = object> = ({ status: 'ok' } & T) | { status: 'invalid' | 'locked' | 'not_enrolled' };

/** Confirm enrolment with a first code: 2FA is on, this session counts as verified, and recovery codes are issued (shown once). */
export async function confirmEnrollment(
  db: Db,
  userId: ObjectId,
  session: { id: string; expiresAt: Date },
  code: string,
  now = new Date(),
): Promise<CodeResult<{ recoveryCodes: string[] }>> {
  const { adminMfa } = collections(db);
  const doc = await adminMfa.findOne({ _id: userId });
  if (!doc || doc.confirmedAt) return { status: 'not_enrolled' };
  if (isLocked(doc, now)) return { status: 'locked' };
  if (!(await acceptTotp(db, doc, code, now))) {
    await recordFailure(db, doc, now, 'enroll');
    return { status: 'invalid' };
  }
  const recoveryCodes = newRecoveryCodes();
  await adminMfa.updateOne(
    { _id: userId },
    { $set: { confirmedAt: now, recoveryCodes: recoveryCodes.map((c) => ({ hash: hashRecoveryCode(c), usedAt: null })), updatedAt: now } },
  );
  await markSessionVerified(db, userId, session.id, session.expiresAt, 'totp', now);
  await recordAudit(db, { type: 'admin.mfa_enrolled', userId, actor: `admin:${userId.toHexString()}`, metadata: {} });
  return { status: 'ok', recoveryCodes };
}

/** Pass the second factor for this session, with an authenticator code or a recovery code (used up). */
export async function verifySession(
  db: Db,
  userId: ObjectId,
  session: { id: string; expiresAt: Date },
  code: string,
  now = new Date(),
): Promise<CodeResult<{ method: 'totp' | 'recovery'; recoveryCodesLeft: number }>> {
  const doc = await collections(db).adminMfa.findOne({ _id: userId });
  if (!doc?.confirmedAt) return { status: 'not_enrolled' };
  if (isLocked(doc, now)) return { status: 'locked' };
  const looksLikeTotp = /^\d{6}$/.test(code.replace(/\s/g, ''));
  const method = looksLikeTotp ? 'totp' : 'recovery';
  const accepted = looksLikeTotp ? await acceptTotp(db, doc, code, now) : await acceptRecoveryCode(db, doc, code, now);
  if (!accepted) {
    await recordFailure(db, doc, now, 'verify');
    return { status: 'invalid' };
  }
  await markSessionVerified(db, userId, session.id, session.expiresAt, method, now);
  await recordAudit(db, { type: 'admin.mfa_verified', userId, actor: `admin:${userId.toHexString()}`, metadata: { method } });
  const left = (await mfaStatus(db, userId)).recoveryCodesLeft;
  return { status: 'ok', method, recoveryCodesLeft: left };
}

/** New recovery codes (the old ones stop working); needs a current authenticator code. */
export async function regenerateRecoveryCodes(db: Db, userId: ObjectId, code: string, now = new Date()): Promise<CodeResult<{ recoveryCodes: string[] }>> {
  const { adminMfa } = collections(db);
  const doc = await adminMfa.findOne({ _id: userId });
  if (!doc?.confirmedAt) return { status: 'not_enrolled' };
  if (isLocked(doc, now)) return { status: 'locked' };
  if (!(await acceptTotp(db, doc, code, now))) {
    await recordFailure(db, doc, now, 'regenerate');
    return { status: 'invalid' };
  }
  const recoveryCodes = newRecoveryCodes();
  await adminMfa.updateOne({ _id: userId }, { $set: { recoveryCodes: recoveryCodes.map((c) => ({ hash: hashRecoveryCode(c), usedAt: null })), updatedAt: now } });
  await recordAudit(db, { type: 'admin.mfa_codes_regenerated', userId, actor: `admin:${userId.toHexString()}`, metadata: {} });
  return { status: 'ok', recoveryCodes };
}

/** Turn 2FA off for this administrator; needs an authenticator or recovery code. */
export async function disableMfa(db: Db, userId: ObjectId, code: string, now = new Date()): Promise<CodeResult> {
  const doc = await collections(db).adminMfa.findOne({ _id: userId });
  if (!doc?.confirmedAt) return { status: 'not_enrolled' };
  if (isLocked(doc, now)) return { status: 'locked' };
  const looksLikeTotp = /^\d{6}$/.test(code.replace(/\s/g, ''));
  const accepted = looksLikeTotp ? await acceptTotp(db, doc, code, now) : await acceptRecoveryCode(db, doc, code, now);
  if (!accepted) {
    await recordFailure(db, doc, now, 'disable');
    return { status: 'invalid' };
  }
  await removeMfa(db, userId);
  await recordAudit(db, { type: 'admin.mfa_disabled', userId, actor: `admin:${userId.toHexString()}`, metadata: {} });
  return { status: 'ok' };
}

/** Remove an administrator's 2FA entirely (lost device and codes): server command line only, audited. */
export async function resetMfa(db: Db, userId: ObjectId, actor = 'cli'): Promise<boolean> {
  const removed = await removeMfa(db, userId);
  if (removed) await recordAudit(db, { type: 'admin.mfa_reset', userId, actor, metadata: {} });
  return removed;
}

async function removeMfa(db: Db, userId: ObjectId): Promise<boolean> {
  const { adminMfa, adminMfaSessions } = collections(db);
  const { deletedCount } = await adminMfa.deleteOne({ _id: userId });
  await adminMfaSessions.deleteMany({ userId });
  return deletedCount === 1;
}

/** The current time step, for tests and diagnostics. */
export const currentStep = (now = Date.now()) => timeStep(now);
