'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import type { ActionResult } from '../actions';
import { checkWithPayPal, decideRefund, saveBillingAccess } from './actions';

// Admin → Billing controls: who may subscribe (owner), refund decisions
// (owner; the refund itself is made in PayPal, which reports it back), and an
// immediate check with PayPal (any admin).

function Result({ result }: { result: ActionResult | null }) {
  if (!result) return null;
  return (
    <p role={result.ok ? 'status' : 'alert'} className="mt-2 text-sm text-foreground">
      {result.message}
    </p>
  );
}

export function BillingAccessForm({ openToEveryone, testerEmails, editable }: { openToEveryone: boolean; testerEmails: string[]; editable: boolean }) {
  const [open, setOpen] = useState(openToEveryone);
  const [emails, setEmails] = useState(testerEmails.join('\n'));
  const [result, setResult] = useState<ActionResult | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  return (
    <form
      aria-label="Who can subscribe"
      onSubmit={(event) => {
        event.preventDefault();
        startTransition(async () => {
          setResult(await saveBillingAccess({ openToEveryone: open, testerEmails: emails }));
          router.refresh();
        });
      }}
      className="mt-3 space-y-3"
    >
      <label className="flex items-start gap-2 text-sm text-foreground">
        <input type="checkbox" checked={open} disabled={!editable || pending} onChange={(e) => setOpen(e.target.checked)} className="mt-0.5 h-4 w-4" />
        <span>
          <span className="font-medium">Open to everyone</span>
          <span className="block text-xs text-muted-foreground">Until this is on, only administrators and the testers below can subscribe.</span>
        </span>
      </label>
      <label className="block text-xs font-medium text-muted-foreground">
        Tester email addresses (one per line)
        <textarea value={emails} disabled={!editable || pending} onChange={(e) => setEmails(e.target.value)} rows={3} className="mt-1 block w-full rounded-lg border border-border bg-background px-2 py-1.5 text-sm text-foreground" />
      </label>
      {editable && (
        <button type="submit" disabled={pending} className="h-9 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground disabled:opacity-50">
          Save
        </button>
      )}
      <Result result={result} />
    </form>
  );
}

export function RefundDecision({ requestId, editable }: { requestId: string; editable: boolean }) {
  const [note, setNote] = useState('');
  const [result, setResult] = useState<ActionResult | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  if (!editable) return null;
  const decide = (outcome: 'refunded' | 'declined') =>
    startTransition(async () => {
      setResult(await decideRefund({ requestId, outcome, note: note.trim() || undefined }));
      router.refresh();
    });
  return (
    <div className="mt-2">
      <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} placeholder="Note (optional)" aria-label="Note" className="h-9 w-full rounded-lg border border-border bg-background px-2 text-sm text-foreground" />
      <div className="mt-2 flex flex-wrap gap-2">
        <button type="button" disabled={pending} onClick={() => decide('refunded')} className="h-9 rounded-lg border border-border px-3 text-sm font-medium text-foreground hover:bg-secondary">
          Mark refunded
        </button>
        <button type="button" disabled={pending} onClick={() => decide('declined')} className="h-9 rounded-lg border border-border px-3 text-sm font-medium text-foreground hover:bg-secondary">
          Decline
        </button>
      </div>
      <Result result={result} />
    </div>
  );
}

export function CheckWithPayPal() {
  const [result, setResult] = useState<ActionResult | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  return (
    <div>
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            setResult(await checkWithPayPal());
            router.refresh();
          })
        }
        className="h-9 rounded-lg border border-border px-3 text-sm font-medium text-foreground hover:bg-secondary disabled:opacity-50"
      >
        {pending ? 'Checking…' : 'Check with PayPal now'}
      </button>
      <Result result={result} />
    </div>
  );
}
