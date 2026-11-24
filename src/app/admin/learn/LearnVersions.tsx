'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';
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
import { previewLearnRestore, restoreLearnVersion } from './actions';
import { utcStamp } from '../when';
import type { VersionEntry } from './types';

// The whole Learn content's history (ADR-0023): every save is a version.
// Restoring one makes the content as it was then, live at once, after
// showing what would change; IDs added since are kept, archived, so no
// progress or link is lost. Restoring is itself a new version.

const when = utcStamp;

export function LearnVersions({ versions, locked }: { versions: VersionEntry[]; locked: boolean }) {
  const router = useRouter();
  const [, startRefresh] = useTransition();
  const [asking, setAsking] = useState<{ version: number; changes: string[] } | null>(null);
  const [loading, setLoading] = useState<number | null>(null);

  async function ask(version: number) {
    setLoading(version);
    try {
      const preview = await previewLearnRestore({ version });
      if (!preview.ok) toast.error(preview.message ?? 'That version cannot be restored.');
      else setAsking({ version, changes: preview.changes ?? [] });
    } finally {
      setLoading(null);
    }
  }

  async function restore(version: number) {
    const result = await restoreLearnVersion({ version });
    if (result.ok) {
      toast.success(`Version ${version} restored`, { description: result.message });
      startRefresh(() => router.refresh());
    } else toast.error(result.message, { description: result.issues?.slice(0, 4).join(' · ') });
  }

  return (
    <section aria-label="Version history" className="mt-6 rounded-2xl border border-border bg-card p-4 md:p-5">
      <h2 className="text-base font-semibold text-foreground">History of the whole content</h2>
      <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
        Every save is a version, kept for good. Restoring one makes everything as it was then (texts, pictures, order and access), live at once; items added
        since stay, archived. One item’s own history is in its editor.
      </p>
      <ul className="mt-2 divide-y divide-border">
        {versions.map((v) => (
          <li key={v.version} className="flex flex-wrap items-center justify-between gap-3 py-2.5 text-sm">
            <span className="min-w-0">
              <span className="font-medium text-foreground">Version {v.version}</span>{' '}
              <span className="text-muted-foreground">
                · {v.live ? 'live' : 'earlier'} · {when(v.at)} by {v.by}
                {v.note ? ` · ${v.note}` : ''}
              </span>
            </span>
            {!v.live && (
              <button
                type="button"
                disabled={locked || loading !== null}
                onClick={() => void ask(v.version)}
                className="inline-flex items-center gap-1 rounded-lg border border-border px-3 py-1.5 text-xs font-semibold text-foreground hover:bg-secondary disabled:opacity-60"
              >
                {loading === v.version && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />}
                Restore this version
              </button>
            )}
          </li>
        ))}
      </ul>
      <AlertDialog open={asking !== null} onOpenChange={(open) => !open && setAsking(null)}>
        <AlertDialogContent className="max-h-[85dvh] overflow-y-auto">
          <AlertDialogHeader>
            <AlertDialogTitle>Restore version {asking?.version}?</AlertDialogTitle>
            <AlertDialogDescription>It is live as soon as you confirm. This would:</AlertDialogDescription>
          </AlertDialogHeader>
          {asking && asking.changes.length === 0 ? (
            <p className="text-sm text-muted-foreground">change nothing: the live content already reads like it.</p>
          ) : (
            <ul aria-label="What restoring changes" className="list-disc space-y-0.5 pl-5 text-sm text-foreground">
              {asking?.changes.slice(0, 40).map((c) => (
                <li key={c}>{c}</li>
              ))}
              {asking && asking.changes.length > 40 && <li>…and {asking.changes.length - 40} more</li>}
            </ul>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={!asking || asking.changes.length === 0}
              onClick={() => {
                if (asking) void restore(asking.version);
                setAsking(null);
              }}
            >
              Restore
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
