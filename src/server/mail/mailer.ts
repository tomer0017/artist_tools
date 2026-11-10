import 'server-only';
import type { Db } from 'mongodb';
import { recordAudit } from '@/server/audit';
import { collections, toObjectId } from '@/server/db/collections';
import type { MailTransport } from '@/server/env';
import { log } from '@/server/log';
import { THROTTLES, consumeThrottle } from '@/server/security/throttle';
import type { RenderedMail } from './templates';

// ─── Sending account email ────────────────────────────────────────────────────
// One entry point for every message, whatever carries it (ADR-0004):
// - `disabled`: nothing is sent (email features are off with it);
// - `outbox`: the message is stored for 24 hours and admins read it at
//   /admin/mail — development and staging only, refused in production by the
//   configuration check;
// - a real provider adapter is added here once one is approved.
// Each address gets at most 3 messages of a kind per hour and 10 per day, so
// nobody can use sign-up or reset to flood someone's inbox. Hitting the limit
// is silent to the requester (it must not reveal whether an account exists).

const OUTBOX_LIFETIME_MS = 24 * 60 * 60 * 1000;

export type Delivery = 'sent' | 'throttled' | 'disabled';

export interface Mailer {
  readonly transport: MailTransport;
  deliver(mail: RenderedMail, to: { address: string; userId?: string | null }): Promise<Delivery>;
}

export function createMailer(db: Db, transport: MailTransport): Mailer {
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
  };
}
