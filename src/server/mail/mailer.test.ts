// @vitest-environment node
import nodemailer, { type SendMailOptions } from 'nodemailer';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { MONGO_STARTUP_TIMEOUT, startTestMongo, type TestMongo } from '@/test/mongo';
import { migrate } from '@/server/db/migrate';
import { collections } from '@/server/db/collections';
import type { SmtpSettings } from '@/server/env';
import { createMailer, smtpFailure, smtpOptions, type SmtpConnection } from './mailer';
import { mailTemplates } from './templates';

// The SMTP transport against a stand-in connection (nothing leaves this
// machine), and the message nodemailer really builds from our templates.

const SMTP: SmtpSettings = { host: 'smtp.example.com', port: 587, user: 'apikey', password: 'provider-secret' };
const FROM = 'Studio Companion <hello@example.com>';

let mongo: TestMongo;
beforeAll(async () => {
  mongo = await startTestMongo();
  await migrate(mongo.db);
}, MONGO_STARTUP_TIMEOUT);
afterAll(async () => mongo?.stop());

/** A connection that records what it is asked to send. */
function recorder(fail?: Error) {
  const sent: SendMailOptions[] = [];
  const connection: SmtpConnection = {
    sendMail: async (message) => {
      if (fail) throw fail;
      sent.push(message);
      return { messageId: '<test@example.com>' };
    },
    verify: async () => true,
  };
  return { sent, connect: vi.fn(() => connection) };
}

const link = 'https://staging.example.com/api/auth/verify-email?token=abc';

describe('the SMTP transport', () => {
  it('always encrypts: implicit TLS on 465, STARTTLS required elsewhere, and never reads files or URLs', () => {
    expect(smtpOptions({ ...SMTP, port: 465 })).toMatchObject({ secure: true, requireTLS: false });
    for (const port of [587, 2525]) expect(smtpOptions({ ...SMTP, port })).toMatchObject({ secure: false, requireTLS: true });
    expect(smtpOptions(SMTP)).toMatchObject({
      host: 'smtp.example.com',
      auth: { user: 'apikey', pass: 'provider-secret' },
      tls: { minVersion: 'TLSv1.2' },
      disableFileAccess: true,
      disableUrlAccess: true,
    });
    expect(smtpOptions(SMTP).socketTimeout).toBeGreaterThan(0);
  });

  it('sends the message from the configured sender, marked as automatic, and keeps nothing in the outbox', async () => {
    const { sent, connect } = recorder();
    const mailer = createMailer(mongo.db, 'smtp', { from: FROM, smtp: SMTP, connect });
    const mail = mailTemplates('en').verifyEmail('Ada Lovelace', link);
    expect(await mailer.deliver(mail, { address: 'ada@example.com', userId: null })).toBe('sent');
    expect(sent).toEqual([
      {
        from: FROM,
        to: 'ada@example.com',
        subject: 'Confirm your email address',
        text: mail.text,
        html: mail.html,
        headers: { 'Auto-Submitted': 'auto-generated', 'X-Auto-Response-Suppress': 'All' },
      },
    ]);
    expect(connect).toHaveBeenCalledWith(SMTP);
    expect(await collections(mongo.db).mailOutbox.countDocuments({ to: 'ada@example.com' })).toBe(0);
  });

  it('builds a proper message: both parts, the Hebrew subject encoded, the link intact, no tracking', async () => {
    const stream = nodemailer.createTransport({ streamTransport: true, buffer: true, newline: 'unix' });
    const raw: string[] = [];
    const connect = () => ({
      sendMail: async (message: SendMailOptions) => {
        const info = await stream.sendMail(message);
        raw.push((info.message as Buffer).toString('utf8'));
        return info;
      },
      verify: async () => true,
    });
    const mailer = createMailer(mongo.db, 'smtp', { from: FROM, smtp: SMTP, connect });
    expect(await mailer.deliver(mailTemplates('he').verifyEmail('עדה', link), { address: 'hebrew@example.com' })).toBe('sent');
    const message = raw[0];
    expect(message).toMatch(/^From: Studio Companion <hello@example\.com>$/m);
    expect(message).toMatch(/^To: hebrew@example\.com$/m);
    expect(message).toMatch(/^Auto-Submitted: auto-generated$/m);
    expect(message).toMatch(/^Subject: =\?UTF-8\?/m);
    expect(message).toContain('Content-Type: text/plain; charset=utf-8');
    expect(message).toContain('Content-Type: text/html; charset=utf-8');
    // The parts are quoted-printable: undo the soft line breaks and escapes.
    const decoded = Buffer.from(message.replace(/=\n/g, '').replace(/=([0-9A-F]{2})/g, (_, hex: string) => String.fromCharCode(parseInt(hex, 16))), 'latin1').toString('utf8');
    expect(decoded).toContain(link);
    expect(decoded).toContain('אישור כתובת האימייל');
    expect(decoded).not.toMatch(/<img/i);
  });

  it('reports a refused message without the address or the provider\'s text in the log', async () => {
    const refusal = Object.assign(new Error("Can't send mail - all recipients were rejected: 550 5.1.1 <gone@example.com>: no such user"), {
      code: 'EENVELOPE',
      responseCode: 550,
      command: 'RCPT TO',
    });
    const { connect } = recorder(refusal);
    const mailer = createMailer(mongo.db, 'smtp', { from: FROM, smtp: SMTP, connect });
    const lines: string[] = [];
    const spy = vi.spyOn(console, 'error').mockImplementation((line: unknown) => void lines.push(String(line)));
    try {
      expect(await mailer.deliver(mailTemplates('en').resetPassword(null, link), { address: 'gone@example.com' })).toBe('failed');
    } finally {
      spy.mockRestore();
    }
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0])).toMatchObject({ event: 'mail.failed', template: 'reset_password', code: 'EENVELOPE', responseCode: 550, command: 'RCPT TO' });
    expect(lines[0]).not.toContain('gone@example.com');
    expect(lines[0]).not.toContain('no such user');
    expect(smtpFailure('not an error')).toEqual({ code: undefined, responseCode: undefined, command: undefined });
  });

  it('keeps the per-address limits: the fourth message of a kind in an hour is not sent', async () => {
    const { sent, connect } = recorder();
    const mailer = createMailer(mongo.db, 'smtp', { from: FROM, smtp: SMTP, connect });
    const results = [];
    for (let i = 0; i < 4; i++) results.push(await mailer.deliver(mailTemplates('en').deliveryTest(), { address: 'limits@example.com' }));
    expect(results).toEqual(['sent', 'sent', 'sent', 'throttled']);
    expect(sent).toHaveLength(3);
    // One connection, opened when the first message went out.
    expect(connect).toHaveBeenCalledTimes(1);
  });

  it('checks the provider without sending anything', async () => {
    const ok = createMailer(mongo.db, 'smtp', { from: FROM, smtp: SMTP, connect: () => ({ sendMail: vi.fn(), verify: async () => true }) });
    expect(await ok.check()).toEqual({ ok: true });
    const badLogin = Object.assign(new Error('Invalid login: 535 5.7.8 Authentication failed'), { code: 'EAUTH', responseCode: 535 });
    const refused = createMailer(mongo.db, 'smtp', { from: FROM, smtp: SMTP, connect: () => ({ sendMail: vi.fn(), verify: async () => Promise.reject(badLogin) }) });
    expect(await refused.check()).toEqual({ ok: false, reason: 'EAUTH · 535 · Invalid login: 535 5.7.8 Authentication failed' });
    expect(await createMailer(mongo.db, 'outbox').check()).toEqual({ ok: false, reason: 'MAIL_TRANSPORT is "outbox": nothing to connect to' });
  });
});

describe('the delivery test message', () => {
  it('says what it is, in English and Hebrew, with no link to follow', () => {
    const en = mailTemplates('en').deliveryTest();
    expect(en).toMatchObject({ template: 'delivery_test', subject: 'Studio Companion: email delivery test', links: [] });
    expect(en.text).toContain('No account was created or changed.');
    const he = mailTemplates('he').deliveryTest();
    expect(he.subject).toBe('Studio Companion: בדיקת שליחת אימייל');
    expect(he.html).toContain('dir="rtl"');
  });
});
