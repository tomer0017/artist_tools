// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ObjectId } from 'mongodb';
import { MONGO_STARTUP_TIMEOUT, startTestMongo, type TestMongo } from '@/test/mongo';
import { collections } from '@/server/db/collections';
import { migrate } from '@/server/db/migrate';
import { open, seal } from '@/server/security/secret-box';
import { base32Decode, base32Encode, otpauthUri, timeStep, totpAt, verifyTotp } from '@/server/security/totp';
import { TRUST_IDLE_DAYS as PAGE_IDLE_DAYS, TRUST_MAX_DAYS as PAGE_MAX_DAYS } from '@/app/admin/security/trust';
import {
  MAX_FAILURES,
  TRUST_IDLE_DAYS,
  TRUST_MAX_DAYS,
  adminGate,
  confirmEnrollment,
  disableMfa,
  forgetAdminVerification,
  forgetAllTrustedDevices,
  forgetDeviceToken,
  forgetTrustedDevice,
  listTrustedDevices,
  mfaStatus,
  regenerateRecoveryCodes,
  resetMfa,
  startEnrollment,
  trustDevice,
  trustEnds,
  verifySession,
} from './admin-mfa';

const SECRET = 'x'.repeat(48);

describe('TOTP (RFC 6238)', () => {
  // RFC 6238 appendix B, SHA-1 key "12345678901234567890": the 8-digit codes'
  // last 6 digits are the 6-digit codes.
  const key = base32Encode(Buffer.from('12345678901234567890'));
  const vectors: [number, string][] = [
    [59, '287082'],
    [1111111109, '081804'],
    [1111111111, '050471'],
    [1234567890, '005924'],
    [2000000000, '279037'],
    [20000000000, '353130'],
  ];

  it('matches the RFC test vectors', () => {
    for (const [seconds, code] of vectors) expect(totpAt(key, timeStep(seconds * 1000)), String(seconds)).toBe(code);
  });

  it('accepts one step of clock drift either way, and never a used step again', () => {
    const now = 1_700_000_000_000;
    const step = timeStep(now);
    expect(verifyTotp(key, totpAt(key, step), now)).toBe(step);
    expect(verifyTotp(key, totpAt(key, step - 1), now)).toBe(step - 1);
    expect(verifyTotp(key, totpAt(key, step + 1), now)).toBe(step + 1);
    expect(verifyTotp(key, totpAt(key, step + 2), now)).toBeNull();
    expect(verifyTotp(key, totpAt(key, step), now, step)).toBeNull(); // replay
    expect(verifyTotp(key, totpAt(key, step + 1), now, step)).toBe(step + 1);
    expect(verifyTotp(key, '12345', now)).toBeNull();
    expect(verifyTotp(key, 'abcdef', now)).toBeNull();
  });

  it('round-trips base32 and builds an otpauth link', () => {
    const bytes = Buffer.from([0, 1, 2, 250, 251, 252, 253, 254, 255]);
    expect(base32Decode(base32Encode(bytes))).toEqual(bytes);
    expect(otpauthUri('JBSWY3DPEHPK3PXP', 'admin@example.com')).toBe(
      'otpauth://totp/SketchyArtLab:admin%40example.com?secret=JBSWY3DPEHPK3PXP&issuer=SketchyArtLab&algorithm=SHA1&digits=6&period=30',
    );
  });
});

describe('secret box', () => {
  it('seals with a fresh IV each time, opens only with the same key, and detects tampering', () => {
    const a = seal('JBSWY3DPEHPK3PXP', SECRET);
    const b = seal('JBSWY3DPEHPK3PXP', SECRET);
    expect(a).not.toBe(b);
    expect(open(a, SECRET)).toBe('JBSWY3DPEHPK3PXP');
    expect(open(a, 'y'.repeat(48))).toBeNull();
    const [v, iv, tag, data] = a.split('.');
    expect(open([v, iv, tag, `${data.slice(0, -2)}AA`].join('.'), SECRET)).toBeNull();
    expect(open('nonsense', SECRET)).toBeNull();
  });
});

describe('admin two-factor verification', () => {
  let mongo: TestMongo;
  const previousSecret = process.env.BETTER_AUTH_SECRET;
  const previousUrl = process.env.BETTER_AUTH_URL;

  beforeAll(async () => {
    process.env.BETTER_AUTH_SECRET = SECRET;
    process.env.BETTER_AUTH_URL = 'http://localhost:8080';
    mongo = await startTestMongo();
    await migrate(mongo.db);
  }, MONGO_STARTUP_TIMEOUT);
  afterAll(async () => {
    process.env.BETTER_AUTH_SECRET = previousSecret;
    process.env.BETTER_AUTH_URL = previousUrl;
    await mongo?.stop();
  });

  const session = (id: string) => ({ id, expiresAt: new Date(Date.now() + 7 * 86_400_000) });

  it('is optional until required, then asks each new session for a code', async () => {
    const db = mongo.db;
    const admin = new ObjectId();
    expect(await adminGate(db, admin, 's1', false)).toBe('ok');
    expect(await adminGate(db, admin, 's1', true)).toBe('enroll');

    const started = await startEnrollment(db, admin, 'admin@example.com');
    if (started.status !== 'started') throw new Error(started.status);
    // Pending enrolment changes nothing yet; the secret is stored sealed.
    expect(await adminGate(db, admin, 's1', false)).toBe('ok');
    const stored = await collections(db).adminMfa.findOne({ _id: admin });
    expect(stored.secret).not.toContain(started.secret);
    expect(open(stored.secret)).toBe(started.secret);

    expect(await confirmEnrollment(db, admin, session('s1'), '000000')).toEqual({ status: 'invalid' });
    const now = Date.now();
    const confirmed = await confirmEnrollment(db, admin, session('s1'), totpAt(started.secret, timeStep(now)));
    if (confirmed.status !== 'ok') throw new Error(confirmed.status);
    expect(confirmed.recoveryCodes).toHaveLength(10);
    expect(new Set(confirmed.recoveryCodes).size).toBe(10);
    expect(confirmed.recoveryCodes[0]).toMatch(/^[A-Z2-7]{5}-[A-Z2-7]{5}$/);

    // The enrolling session is verified; any other session must verify.
    expect(await adminGate(db, admin, 's1', false)).toBe('ok');
    expect(await adminGate(db, admin, 's2', false)).toBe('verify');
    expect(await mfaStatus(db, admin)).toMatchObject({ enrolled: true, recoveryCodesLeft: 10 });
    expect(await startEnrollment(db, admin, 'admin@example.com')).toEqual({ status: 'already_enrolled' });

    // The code used to enrol cannot be used again; the next step's code works.
    expect(await verifySession(db, admin, session('s2'), totpAt(started.secret, timeStep(now)))).toEqual({ status: 'invalid' });
    const next = await verifySession(db, admin, session('s2'), totpAt(started.secret, timeStep(now) + 1));
    expect(next).toMatchObject({ status: 'ok', method: 'totp' });
    expect(await adminGate(db, admin, 's2', false)).toBe('ok');

    // A recovery code works once, in any case and with or without its dash.
    const code = confirmed.recoveryCodes[3];
    expect(await verifySession(db, admin, session('s3'), code.toLowerCase().replace('-', ' '))).toMatchObject({ status: 'ok', method: 'recovery', recoveryCodesLeft: 9 });
    expect(await verifySession(db, admin, session('s4'), code)).toEqual({ status: 'invalid' });
    expect(await adminGate(db, admin, 's4', false)).toBe('verify');

    const audit = await collections(db).auditEvents.find({ userId: admin }).toArray();
    expect(audit.map((e) => e.type)).toEqual(
      expect.arrayContaining(['admin.mfa_failed', 'admin.mfa_enrolled', 'admin.mfa_verified']),
    );
  });

  it('locks after five wrong codes for fifteen minutes', async () => {
    const db = mongo.db;
    const admin = new ObjectId();
    const started = await startEnrollment(db, admin, 'locked@example.com');
    if (started.status !== 'started') throw new Error(started.status);
    const t0 = new Date();
    const confirmed = await confirmEnrollment(db, admin, session('L1'), totpAt(started.secret, timeStep(t0.getTime())), t0);
    if (confirmed.status !== 'ok') throw new Error(confirmed.status);
    for (let i = 0; i < MAX_FAILURES; i++) expect((await verifySession(db, admin, session('L2'), '000000', t0)).status).toBe('invalid');
    // Even a right code is refused while locked.
    const right = totpAt(started.secret, timeStep(t0.getTime()) + 1);
    expect(await verifySession(db, admin, session('L2'), right, t0)).toEqual({ status: 'locked' });
    const later = new Date(t0.getTime() + 16 * 60_000);
    expect((await verifySession(db, admin, session('L2'), totpAt(started.secret, timeStep(later.getTime())), later)).status).toBe('ok');
  });

  it('replaces recovery codes with an authenticator code, and turns off or is reset', async () => {
    const db = mongo.db;
    const admin = new ObjectId();
    const started = await startEnrollment(db, admin, 'manage@example.com');
    if (started.status !== 'started') throw new Error(started.status);
    const t = Date.now();
    const confirmed = await confirmEnrollment(db, admin, session('M1'), totpAt(started.secret, timeStep(t) - 1));
    if (confirmed.status !== 'ok') throw new Error(confirmed.status);

    // A recovery code cannot make new codes; an authenticator code can, and the old codes stop working.
    expect(await regenerateRecoveryCodes(db, admin, confirmed.recoveryCodes[0])).toEqual({ status: 'invalid' });
    const fresh = await regenerateRecoveryCodes(db, admin, totpAt(started.secret, timeStep(t)));
    if (fresh.status !== 'ok') throw new Error(fresh.status);
    expect(await verifySession(db, admin, session('M2'), confirmed.recoveryCodes[1])).toEqual({ status: 'invalid' });
    expect((await verifySession(db, admin, session('M3'), fresh.recoveryCodes[1])).status).toBe('ok');

    // Turning off needs a valid code, and removes every verified session.
    expect(await disableMfa(db, admin, '000000')).toEqual({ status: 'invalid' });
    expect(await disableMfa(db, admin, fresh.recoveryCodes[2])).toEqual({ status: 'ok' });
    expect(await mfaStatus(db, admin)).toMatchObject({ enrolled: false });
    expect(await collections(db).adminMfaSessions.countDocuments({ userId: admin })).toBe(0);
    expect(await adminGate(db, admin, 'M3', false)).toBe('ok');

    // The operator's reset, for a lost phone and lost codes.
    const again = await startEnrollment(db, admin, 'manage@example.com');
    if (again.status !== 'started') throw new Error(again.status);
    await confirmEnrollment(db, admin, session('M4'), totpAt(again.secret, timeStep(Date.now())));
    expect(await resetMfa(db, admin)).toBe(true);
    expect(await resetMfa(db, admin)).toBe(false);
    expect(await collections(db).auditEvents.findOne({ userId: admin, type: 'admin.mfa_reset' })).toMatchObject({ actor: 'cli' });
  });
});

describe('trusted admin devices', () => {
  let mongo: TestMongo;
  const previousSecret = process.env.BETTER_AUTH_SECRET;
  const previousUrl = process.env.BETTER_AUTH_URL;
  const DAY = 86_400_000;
  const T0 = new Date('2026-12-01T09:00:00Z');
  const at = (days: number) => new Date(T0.getTime() + days * DAY);
  const device = (token: string | null, sessionDays = 30, from = T0) => ({ token, sessionExpiresAt: new Date(from.getTime() + sessionDays * DAY) });

  beforeAll(async () => {
    process.env.BETTER_AUTH_SECRET = SECRET;
    process.env.BETTER_AUTH_URL = 'http://localhost:8080';
    mongo = await startTestMongo();
    await migrate(mongo.db);
  }, MONGO_STARTUP_TIMEOUT);
  afterAll(async () => {
    process.env.BETTER_AUTH_SECRET = previousSecret;
    process.env.BETTER_AUTH_URL = previousUrl;
    await mongo?.stop();
  });

  /** An enrolled administrator (the first code verified session `enrol`). */
  async function enrolledAdmin() {
    const db = mongo.db;
    const admin = new ObjectId();
    const started = await startEnrollment(db, admin, 'admin@example.com', T0);
    if (started.status !== 'started') throw new Error(started.status);
    const confirmed = await confirmEnrollment(db, admin, { id: `enrol-${admin}`, expiresAt: at(30) }, totpAt(started.secret, timeStep(T0.getTime())), T0);
    if (confirmed.status !== 'ok') throw new Error(confirmed.status);
    return admin;
  }

  it('lets a trusted device pass new sessions without a code, for its own account only', async () => {
    const db = mongo.db;
    const admin = await enrolledAdmin();
    const other = await enrolledAdmin();
    const token = await trustDevice(db, admin, { currentToken: null, label: 'Chrome on macOS' }, T0);
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);

    // Only the token's hash is stored, never the token.
    const stored = await collections(db).adminTrustedDevices.findOne({ userId: admin });
    expect(stored).toMatchObject({ label: 'Chrome on macOS', tokenHash: expect.stringMatching(/^[0-9a-f]{64}$/) });
    expect(JSON.stringify(stored)).not.toContain(token);

    // A new session (a browser reopened, a new Google sign-in) passes on this device…
    expect(await adminGate(db, admin, 'next-day', false, at(1), device(token, 30, at(1)))).toBe('ok');
    expect(await collections(db).adminMfaSessions.findOne({ _id: 'next-day' })).toMatchObject({ method: 'device' });
    expect(await collections(db).auditEvents.countDocuments({ userId: admin, type: 'admin.mfa_device_used' })).toBe(1);
    // …but the token does nothing for another administrator, and nothing without a token.
    expect(await adminGate(db, other, 'other-session', false, at(1), device(token))).toBe('verify');
    expect(await adminGate(db, admin, 'no-token', false, at(1), device(null))).toBe('verify');
    expect(await adminGate(db, admin, 'wrong-token', false, at(1), device('x'.repeat(43)))).toBe('verify');
  });

  it('ends 30 days after its last use, and at most 90 days after its last code', async () => {
    const db = mongo.db;
    const admin = await enrolledAdmin();
    const token = await trustDevice(db, admin, { currentToken: null, label: 'Safari on iOS' }, T0);
    expect(trustEnds(T0, T0)).toEqual(at(TRUST_IDLE_DAYS));

    // Unused for 31 days: a code again.
    expect(await adminGate(db, admin, 'idle', false, at(31), device(token, 30, at(31)))).toBe('verify');

    // Used every 20 days, it slides, but never past 90 days after its code.
    const busy = await trustDevice(db, admin, { currentToken: null, label: 'Safari on iOS' }, T0);
    for (const day of [20, 40, 60, 80]) expect(await adminGate(db, admin, `busy-${day}`, false, at(day), device(busy, 30, at(day))), `day ${day}`).toBe('ok');
    expect((await collections(db).adminTrustedDevices.findOne({ userId: admin, lastUsedAt: at(80) }))?.expiresAt).toEqual(at(TRUST_MAX_DAYS));
    expect(await adminGate(db, admin, 'busy-91', false, at(91), device(busy, 30, at(91)))).toBe('verify');

    // A code on the device trusts it again with the same token: another 90 days from then.
    const renewed = await trustDevice(db, admin, { currentToken: busy, label: 'Safari on iOS' }, at(85));
    expect(renewed).toBe(busy);
    expect(await adminGate(db, admin, 'busy-100', false, at(100), device(busy, 30, at(100)))).toBe('ok');
    expect(await collections(db).auditEvents.countDocuments({ userId: admin, type: 'admin.mfa_device_trusted', 'metadata.renewed': true })).toBe(1);
  });

  it('verifies a session only until the session itself ends, or 12 hours', async () => {
    const db = mongo.db;
    const admin = await enrolledAdmin();
    const token = await trustDevice(db, admin, { currentToken: null, label: 'Chrome on macOS' }, T0);
    expect(await adminGate(db, admin, 'short', false, T0, { token, sessionExpiresAt: new Date(T0.getTime() + 60_000) })).toBe('ok');
    expect((await collections(db).adminMfaSessions.findOne({ _id: 'short' }))?.expiresAt).toEqual(new Date(T0.getTime() + 60_000));
    expect(await adminGate(db, admin, 'long', false, T0, device(token))).toBe('ok');
    expect((await collections(db).adminMfaSessions.findOne({ _id: 'long' }))?.expiresAt).toEqual(new Date(T0.getTime() + 12 * 3_600_000));
  });

  it('forgets devices one by one, all at once, by their own token, and with the second factor or the admin role', async () => {
    const db = mongo.db;
    const admin = await enrolledAdmin();
    const mac = await trustDevice(db, admin, { currentToken: null, label: 'Chrome on macOS' }, T0);
    const phone = await trustDevice(db, admin, { currentToken: null, label: 'Safari on iOS' }, T0);
    const list = await listTrustedDevices(db, admin, phone, at(1));
    expect(list.map((d) => [d.label, d.current])).toEqual(expect.arrayContaining([['Chrome on macOS', false], ['Safari on iOS', true]]));

    const macId = list.find((d) => d.label === 'Chrome on macOS')!.id;
    expect(await forgetTrustedDevice(db, new ObjectId(), new ObjectId(macId))).toBe(false); // someone else's
    expect(await forgetTrustedDevice(db, admin, new ObjectId(macId))).toBe(true);
    expect(await adminGate(db, admin, 'mac-after', false, at(1), device(mac))).toBe('verify');
    expect(await adminGate(db, admin, 'phone-after', false, at(1), device(phone))).toBe('ok');

    // "Shared device? Sign out…": the token itself is given up.
    expect(await forgetDeviceToken(db, phone)).toBe(true);
    expect(await forgetDeviceToken(db, phone)).toBe(false);
    expect(await adminGate(db, admin, 'phone-gone', false, at(1), device(phone))).toBe('verify');

    await trustDevice(db, admin, { currentToken: null, label: 'A' }, T0);
    await trustDevice(db, admin, { currentToken: null, label: 'B' }, T0);
    expect(await forgetAllTrustedDevices(db, admin)).toBe(2);
    expect(await collections(db).auditEvents.findOne({ userId: admin, type: 'admin.mfa_device_revoked', 'metadata.count': 2 })).toBeTruthy();

    // Turning 2FA off, the server reset, and losing the admin role forget every device.
    await trustDevice(db, admin, { currentToken: null, label: 'C' }, T0);
    expect(await resetMfa(db, admin)).toBe(true);
    expect(await collections(db).adminTrustedDevices.countDocuments({ userId: admin })).toBe(0);
    const second = await enrolledAdmin();
    await trustDevice(db, second, { currentToken: null, label: 'D' }, T0);
    await forgetAdminVerification(db, second);
    expect(await collections(db).adminTrustedDevices.countDocuments({ userId: second })).toBe(0);
    expect(await collections(db).adminMfaSessions.countDocuments({ userId: second })).toBe(0);
  });

  it('keeps the pages and the server on the same lengths', () => {
    expect([PAGE_IDLE_DAYS, PAGE_MAX_DAYS]).toEqual([TRUST_IDLE_DAYS, TRUST_MAX_DAYS]);
  });
});

