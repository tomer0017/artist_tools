'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { ReauthPanel } from '@/components/account/parts';
import type { Viewer } from './AdminControls';
import type { ActionResult } from './actions';
import { discardConfigDraft, publishConfig, restoreConfig, startDraft } from './config-actions';

// Draft → review → publish for versioned configuration (docs/adr/0006). The
// editors save drafts; these controls start, discard and publish them, and
// list earlier versions that can be restored (as a new draft).

function Result({ result }: { result: ActionResult | null }) {
  if (!result) return null;
  return (
    <p role="status" className={`mt-2 text-sm ${result.ok ? 'text-primary' : 'text-destructive'}`}>
      {result.message}
    </p>
  );
}

export function DraftBar({
  kind,
  draftVersion,
  publishedVersion,
  changes,
  viewer,
}: {
  kind: 'catalog' | 'pricing';
  draftVersion: number | null;
  publishedVersion: number | null;
  /** What publishing the draft would change, in words. */
  changes: string[];
  viewer: Viewer;
}) {
  const [result, setResult] = useState<ActionResult | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const run = (action: () => Promise<ActionResult>) =>
    startTransition(async () => {
      setResult(await action());
      router.refresh();
    });

  if (draftVersion === null) {
    return (
      <div className="rounded-xl border border-border bg-card p-4">
        <p className="text-sm text-foreground">
          Live: <strong>version {publishedVersion ?? '—'}</strong>. To change anything, start a draft: nothing applies until you publish it.
        </p>
        <button type="button" disabled={pending} onClick={() => run(() => startDraft({ kind }))} className="mt-3 h-10 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground disabled:opacity-60">
          Start a draft
        </button>
        <Result result={result} />
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-primary/40 bg-primary/5 p-4">
      <p className="text-sm text-foreground">
        Editing <strong>draft version {draftVersion}</strong> (live: version {publishedVersion ?? '—'}). Save your edits below, then publish.
      </p>
      <div className="mt-3">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Publishing would</p>
        {changes.length === 0 ? (
          <p className="mt-1 text-sm text-muted-foreground">change nothing yet.</p>
        ) : (
          <ul aria-label="Changes in this draft" className="mt-1 list-disc space-y-0.5 pl-5 text-sm text-foreground">
            {changes.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
        )}
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" disabled={pending || changes.length === 0} onClick={() => setConfirm(true)} className="h-10 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground disabled:opacity-60">
          Publish version {draftVersion}
        </button>
        <button type="button" disabled={pending} onClick={() => run(() => discardConfigDraft({ kind }))} className="h-10 rounded-lg border border-border px-4 text-sm text-foreground hover:bg-secondary disabled:opacity-60">
          Discard draft
        </button>
      </div>
      <Result result={result} />
      {result?.reauth && (
        <ReauthPanel email={viewer.email} hasPassword={viewer.hasPassword} returnTo={viewer.returnTo} onConfirmed={() => { setResult(null); setConfirm(true); }} onCancel={() => setResult(null)} />
      )}
      <AlertDialog open={confirm} onOpenChange={setConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Publish version {draftVersion}?</AlertDialogTitle>
            <AlertDialogDescription>
              It applies to everyone from their next request. You can go back by restoring an earlier version. Recorded in the activity log.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <ul className="list-disc space-y-0.5 pl-5 text-sm text-foreground">
            {changes.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => run(() => publishConfig({ kind }))}>Publish</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

export interface VersionRow {
  version: number;
  status: 'published' | 'archived';
  publishedAt: string | null;
  publishedBy: string;
  note: string | null;
}

export function VersionHistory({ kind, versions }: { kind: 'catalog' | 'pricing'; versions: VersionRow[] }) {
  const [result, setResult] = useState<ActionResult | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const when = (iso: string | null) => (iso ? new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' }).format(new Date(iso)) + ' UTC' : '—');
  return (
    <section aria-label="Version history" className="mt-6 rounded-2xl border border-border bg-card p-4 md:p-5">
      <h2 className="text-base font-semibold text-foreground">Version history</h2>
      <ul className="mt-2 divide-y divide-border">
        {versions.map((v) => (
          <li key={v.version} className="flex flex-wrap items-center justify-between gap-3 py-2.5 text-sm">
            <span className="min-w-0">
              <span className="font-medium text-foreground">Version {v.version}</span>{' '}
              <span className="text-muted-foreground">
                · {v.status === 'published' ? 'live' : 'earlier'} · published {when(v.publishedAt)} by {v.publishedBy}
                {v.note ? ` · ${v.note}` : ''}
              </span>
            </span>
            {v.status === 'archived' && (
              <button
                type="button"
                disabled={pending}
                onClick={() =>
                  startTransition(async () => {
                    setResult(await restoreConfig({ kind, version: v.version }));
                    router.refresh();
                  })
                }
                className="rounded-lg border border-border px-3 py-1.5 text-xs font-semibold text-foreground hover:bg-secondary disabled:opacity-60"
              >
                Restore as draft
              </button>
            )}
          </li>
        ))}
      </ul>
      <Result result={result} />
    </section>
  );
}
