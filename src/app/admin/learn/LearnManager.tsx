'use client';

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { ArrowDown, ArrowUp, Copy, Eye, Pencil, Plus, RotateCcw, Search, Archive } from 'lucide-react';
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
import { Toaster } from '@/components/ui/sonner';
import { ACCESS_LABELS, ACCESS_MODES, COLLECTION_LABELS, LEARN_COLLECTIONS, type AccessMode, type LearnCollection } from '@/lib/learn/model';
import { itemPath } from '@/lib/learn/routes';
import { archiveLearnItem, duplicateLearnItem, moveLearnItem, setLearnAccess, type LearnActionResult } from './actions';
import { useReleaseAfterDialogs } from './fields';
import { ItemEditor, type EditorTarget } from './ItemEditor';
import type { GroupOption, LearnRow, LessonOption } from './types';

// Admin → Learn's tables (ADR-0023): every lesson and challenge with its
// place, access and state, searched and filtered here in the browser; each
// change goes to the server at once and is live when it says so.

export const ACCESS_HINTS: Record<AccessMode, string> = {
  free: 'Everyone signed in',
  pro: 'Pro accounts (paid, given or assigned); others see it locked',
  admin: 'Admins only, for checking',
  blocked: 'Nobody in the studio, admins included',
};

export const accessStyle: Record<AccessMode, string> = {
  free: 'border-emerald-500/50 bg-emerald-500/10 text-emerald-300',
  pro: 'border-amber-500/60 bg-amber-500/10 text-amber-300',
  admin: 'border-sky-500/50 bg-sky-500/10 text-sky-300',
  blocked: 'border-red-500/50 bg-red-500/10 text-red-300',
};

type StatusFilter = 'live' | 'archived' | 'all';

const ADD_LABEL: Record<LearnCollection, string> = { curriculum: 'Add lesson', color: 'Add colour exercise', challenges: 'Add challenge' };
const control = 'h-9 rounded-lg border border-border bg-background px-2 text-base text-foreground md:text-sm disabled:opacity-60';
const iconButton = 'inline-flex h-8 w-8 items-center justify-center rounded-lg border border-border text-foreground hover:bg-secondary disabled:pointer-events-none disabled:opacity-40';

const matches = (row: LearnRow, query: string) => {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return row.id.toLowerCase().includes(q) || row.title.en.toLowerCase().includes(q) || row.title.he.includes(query.trim());
};

export function LearnManager({
  rows,
  groups,
  lessons,
  counts,
  liveVersion,
  locked,
}: {
  rows: LearnRow[];
  groups: GroupOption[];
  lessons: LessonOption[];
  counts: Record<AccessMode | 'archived', number>;
  liveVersion: number | null;
  /** Why nothing can be saved now (an imported draft waits). */
  locked: string | null;
}) {
  const router = useRouter();
  const [, startRefresh] = useTransition();
  const [query, setQuery] = useState('');
  const [group, setGroup] = useState('all');
  const [access, setAccess] = useState<AccessMode | 'all'>('all');
  const [status, setStatus] = useState<StatusFilter>('live');
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const [editor, setEditor] = useState<EditorTarget | null>(null);
  const [archiving, setArchiving] = useState<LearnRow | null>(null);
  const [announce, setAnnounce] = useState('');
  useReleaseAfterDialogs(archiving !== null || editor !== null);

  const groupTitle = useMemo(() => new Map(groups.map((g) => [g.id, g.title.en])), [groups]);
  const shown = rows.filter(
    (row) =>
      matches(row, query) &&
      (group === 'all' || row.groupId === group) &&
      (access === 'all' || row.access === access) &&
      (status === 'all' || (status === 'archived' ? row.archived : !row.archived)),
  );

  const refresh = () => startRefresh(() => router.refresh());

  /** Run one change for a row: its controls wait, the result is said, the page refreshes. */
  async function act(id: string, work: () => Promise<LearnActionResult>, options: { success?: (result: LearnActionResult) => void } = {}) {
    setBusy((b) => new Set(b).add(id));
    try {
      const result = await work();
      setAnnounce(result.message);
      if (result.ok) {
        if (options.success) options.success(result);
        else toast.success(result.message);
        refresh();
      } else {
        toast.error(result.message, { description: result.issues?.slice(0, 4).join(' · '), duration: 9000 });
      }
      return result;
    } finally {
      setBusy((b) => {
        const next = new Set(b);
        next.delete(id);
        return next;
      });
    }
  }

  const changeAccess = (row: LearnRow, mode: AccessMode) =>
    act(row.id, () => setLearnAccess({ id: row.id, access: mode }), {
      success: (result) =>
        toast.success(`${row.id} is now ${ACCESS_LABELS[mode]}`, {
          description: result.message,
          action: { label: 'Undo', onClick: () => void act(row.id, () => setLearnAccess({ id: row.id, access: row.access })) },
        }),
    });

  const archive = (row: LearnRow, archived: boolean) =>
    act(row.id, () => archiveLearnItem({ id: row.id, archived }), {
      success: (result) =>
        toast.success(archived ? `${row.id} archived: in the studio for nobody` : `${row.id} restored (${ACCESS_LABELS[row.access]})`, {
          description: result.message,
          action: { label: 'Undo', onClick: () => void act(row.id, () => archiveLearnItem({ id: row.id, archived: !archived })) },
        }),
    });

  const duplicate = (row: LearnRow) =>
    act(row.id, () => duplicateLearnItem({ id: row.id }), {
      success: (result) =>
        toast.success(`Added ${result.id}, a copy of ${row.id} (Admin only)`, {
          description: 'Edit it, then set its access when it is ready.',
          action: result.id ? { label: 'Edit', onClick: () => setEditor({ mode: 'edit', id: result.id! }) } : undefined,
        }),
    });

  const move = (row: LearnRow, direction: 'up' | 'down') => act(row.id, () => moveLearnItem({ id: row.id, direction }), { success: (result) => setAnnounce(result.message) });

  const collections = LEARN_COLLECTIONS.filter((c) => c !== 'color' || rows.some((r) => r.collection === 'color'));

  return (
    <div className="mt-5">
      <Toaster position="top-center" richColors closeButton />
      <p className="sr-only" role="status" aria-live="polite">
        {announce}
      </p>

      <section aria-label="Summary" className="flex flex-wrap items-center gap-2 text-xs">
        {ACCESS_MODES.map((mode) => (
          <button
            key={mode}
            type="button"
            onClick={() => setAccess(access === mode ? 'all' : mode)}
            aria-pressed={access === mode}
            className={`rounded-full border px-3 py-1 font-semibold ${accessStyle[mode]} ${access === mode ? 'ring-2 ring-ring' : ''}`}
          >
            {ACCESS_LABELS[mode]} {counts[mode]}
          </button>
        ))}
        <button type="button" onClick={() => setStatus(status === 'archived' ? 'live' : 'archived')} aria-pressed={status === 'archived'} className={`rounded-full border border-border px-3 py-1 font-semibold text-muted-foreground ${status === 'archived' ? 'ring-2 ring-ring' : ''}`}>
          Archived {counts.archived}
        </button>
        <span className="text-muted-foreground">· live content version {liveVersion ?? '—'}</span>
      </section>

      {locked && (
        <p role="alert" className="mt-3 rounded-xl border border-primary/40 bg-primary/5 p-3 text-sm text-foreground">
          {locked}
        </p>
      )}

      <div role="search" className="mt-4 flex flex-wrap items-end gap-2 rounded-2xl border border-border bg-card p-3">
        <label className="flex min-w-[14rem] flex-1 flex-col gap-1 text-xs font-medium text-muted-foreground">
          Search
          <span className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" aria-hidden="true" />
            <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="ID, English or Hebrew title" className={`${control} w-full pl-8`} />
          </span>
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
          Group
          <select value={group} onChange={(e) => setGroup(e.target.value)} className={control}>
            <option value="all">All groups</option>
            {collections.map((c) => (
              <optgroup key={c} label={COLLECTION_LABELS[c]}>
                {groups
                  .filter((g) => g.collection === c)
                  .sort((a, b) => a.order - b.order)
                  .map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.title.en}
                    </option>
                  ))}
              </optgroup>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
          Access
          <select value={access} onChange={(e) => setAccess(e.target.value as AccessMode | 'all')} className={control}>
            <option value="all">Any access</option>
            {ACCESS_MODES.map((mode) => (
              <option key={mode} value={mode}>
                {ACCESS_LABELS[mode]}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
          Status
          <select value={status} onChange={(e) => setStatus(e.target.value as StatusFilter)} className={control}>
            <option value="live">Live (not archived)</option>
            <option value="archived">Archived</option>
            <option value="all">Everything</option>
          </select>
        </label>
        {(query || group !== 'all' || access !== 'all' || status !== 'live') && (
          <button
            type="button"
            onClick={() => {
              setQuery('');
              setGroup('all');
              setAccess('all');
              setStatus('live');
            }}
            className="h-9 rounded-lg px-3 text-sm text-primary hover:bg-secondary"
          >
            Clear filters
          </button>
        )}
      </div>

      {collections.map((collection) => {
        const list = shown.filter((row) => row.collection === collection);
        const total = rows.filter((row) => row.collection === collection && !row.archived).length;
        const kind = collection === 'challenges' ? 'challenge' : 'exercise';
        const firstGroup = groups.filter((g) => g.collection === collection).sort((a, b) => a.order - b.order)[0]?.id ?? null;
        return (
          <section key={collection} aria-labelledby={`learn-${collection}`} className="mt-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 id={`learn-${collection}`} className="text-lg font-semibold text-foreground">
                {COLLECTION_LABELS[collection]} <span className="text-sm font-normal text-muted-foreground">({list.length === total ? total : `${list.length} of ${total}`})</span>
              </h2>
              <button
                type="button"
                disabled={locked !== null || !firstGroup}
                onClick={() => setEditor({ mode: 'new', kind, collection, groupId: group !== 'all' && groups.some((g) => g.id === group && g.collection === collection) ? group : firstGroup! })}
                className="inline-flex h-10 items-center gap-1.5 rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground disabled:opacity-60"
              >
                <Plus className="h-4 w-4" aria-hidden="true" /> {ADD_LABEL[collection]}
              </button>
            </div>
            <div className="relative mt-3 overflow-x-auto rounded-2xl border border-border bg-card">
              <table className="w-full min-w-[56rem] text-left text-sm">
                <caption className="sr-only">{COLLECTION_LABELS[collection]}</caption>
                <thead className="text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th scope="col" className="px-3 py-2">#</th>
                    <th scope="col" className="px-3 py-2">Item</th>
                    <th scope="col" className="px-3 py-2">Group</th>
                    <th scope="col" className="px-3 py-2">Access</th>
                    <th scope="col" className="px-3 py-2">Status</th>
                    <th scope="col" className="px-3 py-2">
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {list.length === 0 && (
                    <tr>
                      <td colSpan={6} className="px-3 py-6 text-center text-muted-foreground">
                        {total === 0 ? 'Nothing here yet.' : 'Nothing matches these filters.'}
                      </td>
                    </tr>
                  )}
                  {list.map((row) => {
                    const waiting = busy.has(row.id) || locked !== null;
                    return (
                      <tr key={row.id} data-learn-row={row.id} data-access={row.access} data-archived={row.archived || undefined} className="border-t border-border align-middle">
                        <td className="px-3 py-2">
                          <div className="flex items-center gap-1">
                            <span className="w-7 text-center font-mono text-xs text-muted-foreground" title={row.optional ? 'Optional: not numbered' : undefined}>
                              {row.number ?? (row.optional ? 'opt' : '—')}
                            </span>
                            <button type="button" className={iconButton} aria-label={`Move ${row.id} up`} disabled={waiting || !row.canMove.up} onClick={() => void move(row, 'up')}>
                              <ArrowUp className="h-4 w-4" aria-hidden="true" />
                            </button>
                            <button type="button" className={iconButton} aria-label={`Move ${row.id} down`} disabled={waiting || !row.canMove.down} onClick={() => void move(row, 'down')}>
                              <ArrowDown className="h-4 w-4" aria-hidden="true" />
                            </button>
                          </div>
                        </td>
                        <td className="px-3 py-2">
                          <div className="flex items-center gap-3">
                            {row.thumbnailAssetId ? (
                              // eslint-disable-next-line @next/next/no-img-element -- served by the authorized asset route, never from public/
                              <img src={`/api/learn/assets/${row.thumbnailAssetId}`} alt="" loading="lazy" className="h-12 w-12 shrink-0 rounded-lg border border-border object-cover" />
                            ) : (
                              <span className="h-12 w-12 shrink-0 rounded-lg border border-dashed border-border" aria-hidden="true" />
                            )}
                            <div className="min-w-0">
                              <button type="button" onClick={() => setEditor({ mode: 'edit', id: row.id })} className="text-left font-medium text-foreground hover:underline">
                                {row.title.en || <span className="italic text-muted-foreground">No English title</span>}
                              </button>
                              <span className="block text-muted-foreground" dir="rtl" lang="he">
                                {row.title.he || '—'}
                              </span>
                              <span className="font-mono text-xs text-muted-foreground">{row.id}</span>
                            </div>
                          </div>
                        </td>
                        <td className="px-3 py-2 text-muted-foreground">{groupTitle.get(row.groupId) ?? row.groupId}</td>
                        <td className="px-3 py-2">
                          <label className="sr-only" htmlFor={`access-${row.id}`}>
                            Access of {row.id}
                          </label>
                          <select
                            id={`access-${row.id}`}
                            value={row.access}
                            disabled={waiting || row.archived}
                            title={ACCESS_HINTS[row.access]}
                            onChange={(e) => void changeAccess(row, e.target.value as AccessMode)}
                            className={`${control} font-semibold ${accessStyle[row.access]}`}
                          >
                            {ACCESS_MODES.map((mode) => (
                              <option key={mode} value={mode}>
                                {ACCESS_LABELS[mode]}
                              </option>
                            ))}
                          </select>
                          {!row.explicit && <span className="mt-1 block text-[11px] text-muted-foreground">from the old plan rules</span>}
                        </td>
                        <td className="px-3 py-2">
                          {row.archived ? (
                            <span className="rounded-full border border-border px-2 py-0.5 text-xs font-semibold text-muted-foreground">Archived</span>
                          ) : (
                            <span className="rounded-full border border-emerald-500/40 px-2 py-0.5 text-xs font-semibold text-emerald-300">Live</span>
                          )}
                          {row.missing.length > 0 && (
                            <span className="mt-1 block max-w-[12rem] text-[11px] text-amber-300" title={row.missing.join('\n')}>
                              Not ready for Free or Pro: {row.missing.length} {row.missing.length === 1 ? 'thing' : 'things'} missing
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-2">
                          <div className="flex items-center justify-end gap-1">
                            <button type="button" className="inline-flex h-8 items-center gap-1 rounded-lg border border-border px-2.5 text-xs font-semibold text-foreground hover:bg-secondary" onClick={() => setEditor({ mode: 'edit', id: row.id })}>
                              <Pencil className="h-3.5 w-3.5" aria-hidden="true" /> Edit
                            </button>
                            <a href={`${itemPath(row.id)}?preview=1`} target="_blank" rel="noopener" className={iconButton} aria-label={`Preview ${row.id} as learners see it`} title="Preview in the studio">
                              <Eye className="h-4 w-4" aria-hidden="true" />
                            </a>
                            <button type="button" className={iconButton} aria-label={`Duplicate ${row.id}`} title="Duplicate" disabled={waiting} onClick={() => void duplicate(row)}>
                              <Copy className="h-4 w-4" aria-hidden="true" />
                            </button>
                            {row.archived ? (
                              <button type="button" className={iconButton} aria-label={`Restore ${row.id} from the archive`} title="Restore" disabled={waiting} onClick={() => void archive(row, false)}>
                                <RotateCcw className="h-4 w-4" aria-hidden="true" />
                              </button>
                            ) : (
                              <button type="button" className={iconButton} aria-label={`Archive ${row.id}`} title="Archive (delete, recoverable)" disabled={waiting} onClick={() => setArchiving(row)}>
                                <Archive className="h-4 w-4" aria-hidden="true" />
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        );
      })}

      <AlertDialog open={archiving !== null} onOpenChange={(open) => !open && setArchiving(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Archive {archiving?.id}?</AlertDialogTitle>
            <AlertDialogDescription>
              “{archiving?.title.en || archiving?.title.he}” disappears from the studio for everyone, admins included. Its progress, pictures and history are
              kept, and you can restore it any time from Archived.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (archiving) void archive(archiving, true);
                setArchiving(null);
              }}
            >
              Archive
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <ItemEditor
        target={editor}
        groups={groups}
        lessons={lessons}
        locked={locked}
        onClose={() => setEditor(null)}
        onSaved={(id) => {
          refresh();
          setEditor({ mode: 'edit', id });
        }}
      />
    </div>
  );
}
