// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ObjectId } from 'mongodb';
import { MONGO_STARTUP_TIMEOUT, startTestMongo, type TestMongo } from '@/test/mongo';
import { collections } from '@/server/db/collections';
import { migrate } from '@/server/db/migrate';
import { open, seal } from '@/server/security/secret-box';
import { base32Decode, base32Encode, otpauthUri, timeStep, totpAt, verifyTotp } from '@/server/security/totp';
import {
  MAX_FAILURES,
  adminGate,
  confirmEnrollment,
  disableMfa,
  mfaStatus,
  regenerateRecoveryCodes,
  resetMfa,
  startEnrollment,
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
      'otpauth://totp/Studio%20Companion:admin%40example.com?secret=JBSWY3DPEHPK3PXP&issuer=Studio+Companion&algorithm=SHA1&digits=6&period=30',
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
