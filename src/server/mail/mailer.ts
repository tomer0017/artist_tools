import 'server-only';
import nodemailer, { type SendMailOptions } from 'nodemailer';
import type { Db } from 'mongodb';
import { recordAudit } from '@/server/audit';
import { collections, toObjectId } from '@/server/db/collections';
import type { MailTransport, SmtpSettings } from '@/server/env';
import { log } from '@/server/log';
import { THROTTLES, consumeThrottle } from '@/server/security/throttle';
import type { RenderedMail } from './templates';

// ─── Sending account email ────────────────────────────────────────────────────
// One entry point for every message, whatever carries it (ADR-0004):
// - `disabled`: nothing is sent (email features are off with it);
// - `outbox`: the message is stored for 24 hours and admins read it at
//   /admin/mail — development and staging only, refused in production (and
//   with open registration) by the configuration check;
// - `smtp`: the email provider's submission server, always over TLS.
// Each address gets at most 3 messages of a kind per hour and 10 per day, so
// nobody can use sign-up or reset to flood someone's inbox. Hitting the limit
// is silent to the requester (it must not reveal whether an account exists).

const OUTBOX_LIFETIME_MS = 24 * 60 * 60 * 1000;

export type Delivery = 'sent' | 'throttled' | 'disabled' | 'failed';

export interface Mailer {
  readonly transport: MailTransport;
  deliver(mail: RenderedMail, to: { address: string; userId?: string | null }): Promise<Delivery>;
  /** Connects and signs in to the provider without sending anything (smtp only), for the operator's check. */
  check(): Promise<{ ok: true } | { ok: false; reason: string }>;
}

/** The part of a nodemailer transport the mailer uses (a stand-in in tests). */
export interface SmtpConnection {
  sendMail(message: SendMailOptions): Promise<unknown>;
  verify(): Promise<unknown>;
}

/**
 * Always encrypted: implicit TLS on port 465, STARTTLS required on any other
 * port, so the password never crosses the network in clear. One connection
 * per message (account email is rare), with timeouts so a stalled provider
 * cannot pile up connections. Messages are plain text and HTML only, so
 * nodemailer may not read files or fetch URLs for them.
 */
export const smtpOptions = (smtp: SmtpSettings) => ({
  host: smtp.host,
  port: smtp.port,
  secure: smtp.port === 465,
  requireTLS: smtp.port !== 465,
  auth: { user: smtp.user, pass: smtp.password },
  tls: { minVersion: 'TLSv1.2' as const },
  connectionTimeout: 15_000,
  greetingTimeout: 15_000,
  socketTimeout: 30_000,
  disableFileAccess: true,
  disableUrlAccess: true,
});

/**
 * What a provider error says, for logs: the SMTP command and reply codes.
 * Never the message text, which can quote the recipient's address.
 */
export function smtpFailure(error: unknown) {
  const e = (error ?? {}) as { code?: unknown; responseCode?: unknown; command?: unknown };
  const pick = (value: unknown) => (typeof value === 'string' || typeof value === 'number' ? value : undefined);
  return { code: pick(e.code), responseCode: pick(e.responseCode), command: pick(e.command) };
}

interface MailerOptions {
  /** The sender, e.g. `Studio Companion <hello@example.com>` (MAIL_FROM). */
  from?: string;
  smtp?: SmtpSettings | null;
  /** Opens the SMTP connection (nodemailer, unless a test supplies its own). */
  connect?: (smtp: SmtpSettings) => SmtpConnection;
}

export function createMailer(db: Db, transport: MailTransport, options: MailerOptions = {}): Mailer {
  const connect = options.connect ?? ((smtp: SmtpSettings) => nodemailer.createTransport(smtpOptions(smtp)));
  let connection: SmtpConnection | undefined;
  const smtp = () => {
    if (!options.smtp) throw new Error('MAIL_TRANSPORT=smtp needs the SMTP settings');
    connection ??= connect(options.smtp);
    return connection;
  };

  return {
    transport,
    async deliver(mail, to) {
      if (transport === 'disabled') {
        log.warn('mail.not_sent', { template: mail.template, reason: 'transport_disabled' });
        return 'disabled';
      }
      const kind = `mail:${mail.template}`;
      const hourly = await consumeThrottle(db, `${kind}:hour`, to.address, THROTTLES.mailPerHour);
      const daily = await consumeThrottle(db, `${kind}:day`, to.address, THROTTLES.mailPerDay);
      if (!hourly.allowed || !daily.allowed) {
        log.warn('mail.throttled', { template: mail.template });
        await recordAudit(db, { type: 'auth.throttled', userId: to.userId ?? null, actor: 'system', metadata: { purpose: 'mail', template: mail.template } });
        return 'throttled';
      }
      if (transport === 'smtp') {
        try {
          await smtp().sendMail({
            from: options.from,
            to: to.address,
            subject: mail.subject,
            text: mail.text,
            html: mail.html,
            // Automatic messages (RFC 3834): out-of-office replies are not sent back.
            headers: { 'Auto-Submitted': 'auto-generated', 'X-Auto-Response-Suppress': 'All' },
          });
          log.info('mail.sent', { template: mail.template, transport });
          return 'sent';
        } catch (error) {
          log.error('mail.failed', { template: mail.template, transport, ...smtpFailure(error) });
          return 'failed';
        }
      }
      const now = new Date();
      await collections(db).mailOutbox.insertOne({
        template: mail.template,
        to: to.address.trim().toLowerCase(),
        userId: toObjectId(to.userId ?? null),
        subject: mail.subject,
        text: mail.text,
        html: mail.html,
        links: mail.links,
        createdAt: now,
        expiresAt: new Date(now.getTime() + OUTBOX_LIFETIME_MS),
      });
      log.info('mail.queued', { template: mail.template, transport });
      return 'sent';
    },
    async check() {
      if (transport !== 'smtp') return { ok: false, reason: `MAIL_TRANSPORT is "${transport}": nothing to connect to` };
      try {
        await smtp().verify();
        return { ok: true };
      } catch (error) {
        // For the operator at the terminal; no recipient is involved here.
        const { code, responseCode } = smtpFailure(error);
        return { ok: false, reason: [code, responseCode, error instanceof Error ? error.message : null].filter(Boolean).join(' · ') };
      }
    },
  };
}
