import 'server-only';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { ObjectId, type Db } from 'mongodb';
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
//
// After a correct code the admin may trust the device: a random token in an
// HttpOnly cookie (only its SHA-256 is stored) then lets that device's
// sessions pass without a code, for the same account only, until the trust
// ends: 30 days after the device was last used, and at most 90 days after the
// last code entered on it. A session is still needed (a Google sign-in): the
// trust only replaces the code. Turning 2FA off, the server reset and losing
// the admin role forget every trusted device; the admin can forget them too.

export const MFA_SESSION_HOURS = 12;
export const MAX_FAILURES = 5;
export const FAILURE_WINDOW_MS = 15 * 60 * 1000;
export const RECOVERY_CODE_COUNT = 10;
/** A trusted device asks for a code again after this many days unused… */
export const TRUST_IDLE_DAYS = 30;
/** …and at the latest this many days after the last code entered on it. */
export const TRUST_MAX_DAYS = 90;
const DAY_MS = 24 * 60 * 60 * 1000;

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

async function markSessionVerified(db: Db, userId: ObjectId, sessionId: string, sessionExpiresAt: Date, method: 'totp' | 'recovery' | 'device', now: Date) {
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

/** The device's trust token (from its cookie) and the session's own end, for a session that has not passed yet. */
export interface DeviceCheck {
  token: string | null;
  sessionExpiresAt: Date;
}

/**
 * What an administrator's session needs before admin access: nothing, a code,
 * or enrolment (only when required). A session that has not passed yet passes
 * without a code on a device this account trusts (`device`).
 */
export async function adminGate(db: Db, userId: ObjectId, sessionId: string, required: boolean, now = new Date(), device?: DeviceCheck): Promise<AdminGate> {
  const doc = await collections(db).adminMfa.findOne({ _id: userId }, { projection: { confirmedAt: 1 } });
  if (!doc?.confirmedAt) return required ? 'enroll' : 'ok';
  if (await isSessionVerified(db, userId, sessionId, now)) return 'ok';
  if (device?.token && (await consumeTrustedDevice(db, userId, device.token, now))) {
    await markSessionVerified(db, userId, sessionId, device.sessionExpiresAt, 'device', now);
    await recordAudit(db, { type: 'admin.mfa_device_used', userId, actor: `admin:${userId.toHexString()}`, metadata: {} });
    return 'ok';
  }
  return 'verify';
}

// ─── Trusted devices ──────────────────────────────────────────────────────────

const hashDeviceToken = (token: string) => createHash('sha256').update(token).digest('hex');

/** When a device's trust ends: 30 days after its last use, never later than 90 days after its last code. */
export const trustEnds = (verifiedAt: Date, lastUsedAt: Date) =>
  new Date(Math.min(lastUsedAt.getTime() + TRUST_IDLE_DAYS * DAY_MS, verifiedAt.getTime() + TRUST_MAX_DAYS * DAY_MS));

/** A live trust for this account and token: renewed (its last use is now), or false when there is none. */
async function consumeTrustedDevice(db: Db, userId: ObjectId, token: string, now: Date): Promise<boolean> {
  const { adminTrustedDevices } = collections(db);
  const doc = await adminTrustedDevices.findOne({ tokenHash: hashDeviceToken(token), userId, expiresAt: { $gt: now } });
  if (!doc) return false;
  await adminTrustedDevices.updateOne({ _id: doc._id }, { $set: { lastUsedAt: now, expiresAt: trustEnds(doc.verifiedAt, now) } });
  return true;
}

/**
 * Trust this device, right after a correct code: the device's own token when
 * it already holds a live one for this account (renewed: the 90 days count
 * from now), else a new random one. Returns the token for the cookie.
 */
export async function trustDevice(db: Db, userId: ObjectId, device: { currentToken: string | null; label: string }, now = new Date()): Promise<string> {
  const { adminTrustedDevices } = collections(db);
  const ends = trustEnds(now, now);
  if (device.currentToken) {
    const { modifiedCount } = await adminTrustedDevices.updateOne(
      { tokenHash: hashDeviceToken(device.currentToken), userId, expiresAt: { $gt: now } },
      { $set: { verifiedAt: now, lastUsedAt: now, expiresAt: ends, label: device.label } },
    );
    if (modifiedCount === 1) {
      await recordAudit(db, { type: 'admin.mfa_device_trusted', userId, actor: `admin:${userId.toHexString()}`, metadata: { renewed: true } });
      return device.currentToken;
    }
  }
  const token = randomBytes(32).toString('base64url');
  await adminTrustedDevices.insertOne({ _id: new ObjectId(), userId, tokenHash: hashDeviceToken(token), label: device.label, createdAt: now, verifiedAt: now, lastUsedAt: now, expiresAt: ends });
  await recordAudit(db, { type: 'admin.mfa_device_trusted', userId, actor: `admin:${userId.toHexString()}`, metadata: { renewed: false } });
  return token;
}

export interface TrustedDeviceView {
  id: string;
  label: string;
  createdAt: Date;
  lastUsedAt: Date;
  /** When it asks for a code again (if unused before then, sooner). */
  expiresAt: Date;
  /** The device this request comes from. */
  current: boolean;
}

/** This administrator's live trusted devices, most recently used first. */
export async function listTrustedDevices(db: Db, userId: ObjectId, currentToken: string | null, now = new Date()): Promise<TrustedDeviceView[]> {
  const current = currentToken ? hashDeviceToken(currentToken) : null;
  const docs = await collections(db).adminTrustedDevices.find({ userId, expiresAt: { $gt: now } }, { sort: { lastUsedAt: -1 } }).toArray();
  return docs.map((d) => ({ id: d._id.toHexString(), label: d.label, createdAt: d.createdAt, lastUsedAt: d.lastUsedAt, expiresAt: d.expiresAt, current: d.tokenHash === current }));
}

/** Forget one of this administrator's trusted devices (its next session asks for a code). */
export async function forgetTrustedDevice(db: Db, userId: ObjectId, deviceId: ObjectId): Promise<boolean> {
  const { deletedCount } = await collections(db).adminTrustedDevices.deleteOne({ _id: deviceId, userId });
  if (deletedCount === 1) await recordAudit(db, { type: 'admin.mfa_device_revoked', userId, actor: `admin:${userId.toHexString()}`, metadata: { count: 1 } });
  return deletedCount === 1;
}

/** Forget every device this administrator trusts; returns how many. */
export async function forgetAllTrustedDevices(db: Db, userId: ObjectId, actor = `admin:${userId.toHexString()}`): Promise<number> {
  const { deletedCount } = await collections(db).adminTrustedDevices.deleteMany({ userId });
  if (deletedCount > 0) await recordAudit(db, { type: 'admin.mfa_device_revoked', userId, actor, metadata: { count: deletedCount } });
  return deletedCount;
}

/** Forget the trust held by this token, whoever it belongs to: holding the token is what proves the right to give it up (signing out of a shared device). */
export async function forgetDeviceToken(db: Db, token: string): Promise<boolean> {
  const doc = await collections(db).adminTrustedDevices.findOneAndDelete({ tokenHash: hashDeviceToken(token) });
  if (doc) await recordAudit(db, { type: 'admin.mfa_device_revoked', userId: doc.userId, actor: `user:${doc.userId.toHexString()}`, metadata: { count: 1 } });
  return Boolean(doc);
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
  const { adminMfa, adminMfaSessions, adminTrustedDevices } = collections(db);
  const { deletedCount } = await adminMfa.deleteOne({ _id: userId });
  await adminMfaSessions.deleteMany({ userId });
  // Trust came from codes of this second factor: it ends with it.
  await adminTrustedDevices.deleteMany({ userId });
  return deletedCount === 1;
}

/** No longer an administrator: verified sessions and trusted devices end (a later admin role starts from a code again). */
export async function forgetAdminVerification(db: Db, userId: ObjectId): Promise<void> {
  const { adminMfaSessions, adminTrustedDevices } = collections(db);
  await adminMfaSessions.deleteMany({ userId });
  await adminTrustedDevices.deleteMany({ userId });
}

/** The current time step, for tests and diagnostics. */
export const currentStep = (now = Date.now()) => timeStep(now);
