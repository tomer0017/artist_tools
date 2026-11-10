import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { ExternalLink, MailWarning } from 'lucide-react';
import { getDb } from '@/server/db/client';
import { collections } from '@/server/db/collections';
import { authConfig } from '@/server/env';
import { requireAdmin } from '@/server/session';
import { AdminShell } from '../AdminShell';
import { dateTime } from '../format';

// The staging mail outbox (ADR-0004): account emails the app would have sent
// (confirmations, password resets, security notices), kept for 24 hours so
// sign-up and reset can be tested without a mail provider. Exists only while
// MAIL_TRANSPORT=outbox, which the configuration refuses in production; 404
// for everyone who is not an admin.

export const metadata: Metadata = { title: 'Test mail · Studio Companion admin', robots: { index: false, follow: false } };

export const dynamic = 'force-dynamic';

export default async function AdminMailPage() {
  await requireAdmin('/admin/mail');
  if (authConfig().mail.transport !== 'outbox') notFound();
  const messages = await collections(getDb()).mailOutbox.find({}, { sort: { createdAt: -1 }, limit: 50 }).toArray();

  return (
    <AdminShell active="mail">
      <h1 className="mt-6 text-2xl font-bold tracking-tight text-foreground">Test mail</h1>
      <div className="mt-3 flex items-start gap-3 rounded-xl border border-primary/30 bg-primary/5 p-4 text-sm text-foreground">
        <MailWarning className="mt-0.5 h-5 w-5 shrink-0 text-primary" aria-hidden="true" />
        <p>
          These emails were <strong>not sent</strong>: this server keeps them here instead, for testing. They disappear after 24 hours. Their links are
          real — open them only for your own test accounts. A confirmation link signs this browser in to that account; sign back in as yourself
          afterwards (or open it in a private tab).
        </p>
      </div>
      {messages.length === 0 ? (
        <p className="mt-6 text-sm text-muted-foreground">No emails in the last 24 hours.</p>
      ) : (
        <ul aria-label="Test emails" className="mt-4 space-y-3">
          {messages.map((m) => (
            <li key={m._id!.toHexString()}>
              <details className="group rounded-2xl border border-border bg-card p-4">
                <summary className="cursor-pointer list-none">
                  <p className="text-sm font-semibold text-foreground">{m.subject}</p>
                  <p className="mt-0.5 break-all text-xs text-muted-foreground">
                    To {m.to} · {dateTime(m.createdAt)}
                  </p>
                </summary>
                <pre className="mt-3 whitespace-pre-wrap break-words rounded-lg bg-secondary/40 p-3 text-xs leading-relaxed text-foreground">{m.text}</pre>
                {m.links.length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {m.links.map((link) => (
                      <a
                        key={link.url}
                        href={link.url}
                        rel="noreferrer"
                        className="inline-flex h-11 items-center gap-2 rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground hover:bg-primary/90"
                      >
                        <ExternalLink className="h-4 w-4" aria-hidden="true" /> {link.label}
                      </a>
                    ))}
                  </div>
                )}
              </details>
            </li>
          ))}
        </ul>
      )}
    </AdminShell>
  );
}
