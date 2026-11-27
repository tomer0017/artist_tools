'use client';

import { useEffect, useMemo, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { toast } from 'sonner';
import { AlertTriangle, ArrowDown, ArrowUp, Eye, History, Loader2, Plus, Trash2, X } from 'lucide-react';
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
import { TOOL_IDS, type ToolId } from '@/lib/account';
import {
  ACCESS_LABELS,
  ACCESS_MODES,
  CHALLENGE_LEVELS,
  COLLECTION_LABELS,
  GRID_DIVISIONS,
  MEDIUMS,
  REFERENCE_KINDS,
  STUDY_LEVELS,
  type AccessMode,
  type AssetRef,
  type LearnChallenge,
  type LearnCollection,
  type LearnExercise,
  type LearnItem,
} from '@/lib/learn/model';
import { itemPath } from '@/lib/learn/routes';
import { loadLearnItem, restoreLearnItem, saveLearnItem, type ImageInfo, type LoadedItem } from './actions';
import { EMPTY, LocField, PictureEditor, PictureList, RightsPanel, Section, UploadButton, defaultLicence, inputClass, smallButton, useReleaseAfterDialogs } from './fields';
import { blankForm, fieldsOf, formOf, type ChallengeForm, type ExerciseForm, type Form, type StepForm } from './form';
import type { LicenceForm } from './images';
import { ACCESS_HINTS, accessStyle } from './LearnManager';
import type { GroupOption, LessonOption } from './types';

// Admin → Learn's editor (ADR-0023): one lesson or challenge, every part in
// English and Hebrew. Save publishes it at once (live in the studio on the
// next request); if someone changed it since it opened, nothing is saved and
// the typed text stays here. History lists the versions that changed it;
// restoring one brings back its texts and pictures.

export type EditorTarget = { mode: 'edit'; id: string } | { mode: 'new'; kind: 'exercise' | 'challenge'; collection: LearnCollection; groupId: string };

const TOOL_LABELS: Record<ToolId, string> = { measure: 'Measure & Plan', value: 'Study & Simplify', color: 'Color & Mixing', grid: 'Create a Grid', compare: 'Compare & Correct', wall: 'Art on Your Wall' };
/** The tools a lesson or challenge can open (Art on Your Wall takes no reference picture). */
const LEARN_TOOLS = TOOL_IDS.filter((tool) => tool !== 'wall');
const LEVEL_LABELS: Record<(typeof CHALLENGE_LEVELS)[number], string> = { beginner: 'Light (a quick, easy one)', intermediate: 'Create (make something)', advanced: 'Challenge (a stretch)' };
const REFERENCE_LABELS: Record<(typeof REFERENCE_KINDS)[number], string> = { life: 'From life (something real in front of you)', own_photo: 'From your own photo', provided: 'From a picture we provide', memory: 'From memory or imagination' };
const MEDIUM_LABELS: Record<(typeof MEDIUMS)[number], string> = { pencil: 'Pencil', both: 'Pencil, or colour if you like' };
const LIMITS = { skill: 60, objective: 120, caption: 160, step: 160, create: 140, focus: 140, twist: 140, why: 400 };

/** A server message about a field, in the editor's words. */
function readable(issue: string): string {
  const n = (i: string) => String(Number(i) + 1);
  return issue
    .replace(/^(?:[DC]-[A-Z]{2,8}-\d{2}|CH-\d{3}): /, '')
    .replace(/references\.(\d+)\.alt/g, (_, i) => `reference picture ${n(i)}: description`)
    .replace(/references\.(\d+)\.credit/g, (_, i) => `reference picture ${n(i)}: credit`)
    .replace(/demo\.(\d+)\.image\.alt/g, () => 'lesson picture: description')
    .replace(/demo\.(\d+)\.caption/g, () => 'lesson picture: caption')
    .replace(/steps\.(\d+)\.image\.alt/g, (_, i) => `task line ${n(i)}: picture description`)
    .replace(/steps\.(\d+)\.tool\.label/g, (_, i) => `task line ${n(i)}: tool button text`)
    .replace(/steps\.(\d+)\.text/g, (_, i) => `task line ${n(i)}`)
    .replace(/mistake\.image\.alt/g, 'mistake picture: description')
    .replace(/mistake\.mistake/g, 'common mistake')
    .replace(/mistake\.fix/g, 'how to fix it')
    .replace(/^guide\b/, 'why it works')
    .replace(/^success\b/, 'done when')
    .replace(/^instruction\b/, 'short description')
    .replace(/^materials\b/, 'what you need')
    .replace(/^create\b/, 'make something')
    .replace(/^focus\b/, 'tip');
}

export function ItemEditor({
  target,
  groups,
  lessons,
  locked,
  onClose,
  onSaved,
}: {
  target: EditorTarget | null;
  groups: GroupOption[];
  lessons: LessonOption[];
  locked: string | null;
  onClose: () => void;
  onSaved: (id: string) => void;
}) {
  const [loaded, setLoaded] = useState<LoadedItem | null>(null);
  const [form, setForm] = useState<Form | null>(null);
  const [initial, setInitial] = useState('');
  const [error, setError] = useState<{ message: string; issues: string[]; conflict?: boolean } | null>(null);
  const [saving, setSaving] = useState(false);
  const [tab, setTab] = useState<'content' | 'history'>('content');
  const [confirmClose, setConfirmClose] = useState(false);
  const [restoring, setRestoring] = useState<number | null>(null);
  const [licence, setLicence] = useState<LicenceForm>(defaultLicence(''));
  const [loadError, setLoadError] = useState<string | null>(null);

  const editId = target?.mode === 'edit' ? target.id : null;
  useReleaseAfterDialogs(target !== null || confirmClose || restoring !== null);
  const targetKey = target ? (target.mode === 'edit' ? `edit:${target.id}` : `new:${target.kind}:${target.collection}:${target.groupId}`) : '';

  async function load(id: string) {
    setLoadError(null);
    const result = await loadLearnItem({ id });
    if (!('loaded' in result)) {
      setLoadError(result.message);
      return;
    }
    const next = formOf(result.loaded.item, result.loaded.images, result.loaded.access);
    setLoaded(result.loaded);
    setForm(next);
    setInitial(JSON.stringify(next));
  }

  useEffect(() => {
    setError(null);
    setTab('content');
    setLoaded(null);
    if (!target) {
      setForm(null);
      return;
    }
    if (target.mode === 'new') {
      const next = blankForm(target.kind, target.collection, target.groupId);
      setForm(next);
      setInitial(JSON.stringify(next));
      return;
    }
    setForm(null);
    void load(target.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reload only when the target changes
  }, [targetKey]);

  const dirty = form !== null && JSON.stringify(form) !== initial;
  const title = form ? form.title.en || form.title.he : '';
  const collection: LearnCollection | null = form ? (form.kind === 'challenge' ? 'challenges' : form.collection) : null;
  const groupOptions = useMemo(() => groups.filter((g) => g.collection === collection).sort((a, b) => a.order - b.order), [groups, collection]);
  const update = <F extends Form>(patch: Partial<F>) => setForm((f) => (f ? ({ ...f, ...patch } as Form) : f));
  const uploadFailed = (message: string, issues?: string[]) => toast.error(message, { description: issues?.map(readable).slice(0, 4).join(' · '), duration: 9000 });

  function requestClose() {
    if (dirty) setConfirmClose(true);
    else onClose();
  }

  async function save() {
    if (!form || !target) return;
    setSaving(true);
    setError(null);
    try {
      const result = await saveLearnItem({
        id: target.mode === 'edit' ? target.id : null,
        kind: form.kind,
        collection: form.kind === 'exercise' ? form.collection : 'challenges',
        baseHash: loaded?.hash,
        fields: fieldsOf(form),
      });
      if (!result.ok) {
        setError({ message: result.message, issues: (result.issues ?? []).map(readable), conflict: result.conflict });
        return;
      }
      toast.success(target.mode === 'new' ? `Added ${result.id}` : `Saved ${result.id}`, { description: result.message });
      setInitial(JSON.stringify(form));
      onSaved(result.id!);
      if (target.mode === 'edit') await load(target.id);
    } finally {
      setSaving(false);
    }
  }

  async function restore(version: number) {
    if (!editId) return;
    const result = await restoreLearnItem({ id: editId, version });
    if (result.ok) {
      toast.success(`Restored ${editId} from version ${version}`, { description: result.message });
      onSaved(editId);
      await load(editId);
      setTab('content');
    } else toast.error(result.message, { description: result.issues?.map(readable).slice(0, 4).join(' · ') });
  }

  const heading = target?.mode === 'new' ? `New ${target.kind === 'challenge' ? 'challenge' : 'lesson'}` : editId ?? '';
  return (
    <>
      <Dialog.Root open={target !== null} onOpenChange={(open) => !open && requestClose()}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-40 bg-black/60" />
          <Dialog.Content
            aria-describedby={undefined}
            onEscapeKeyDown={(e) => {
              if (dirty) {
                e.preventDefault();
                setConfirmClose(true);
              }
            }}
            onPointerDownOutside={(e) => {
              if (dirty) {
                e.preventDefault();
                setConfirmClose(true);
              }
            }}
            className="fixed inset-0 z-50 flex flex-col bg-background shadow-xl md:inset-y-0 md:left-auto md:right-0 md:w-[min(60rem,100vw)] md:border-l md:border-border"
            data-learn-editor={editId ?? 'new'}
          >
            <header className="flex items-center justify-between gap-3 border-b border-border px-4 py-3" style={{ paddingTop: 'max(0.75rem, env(safe-area-inset-top))' }}>
              <div className="min-w-0">
                <Dialog.Title className="truncate text-lg font-semibold text-foreground">
                  {heading}
                  {title && <span className="ml-2 font-normal text-muted-foreground">{title}</span>}
                </Dialog.Title>
                {form && (
                  <p className="text-xs text-muted-foreground">
                    {collection ? COLLECTION_LABELS[collection] : ''} · {loaded ? `live version ${loaded.version ?? '—'}` : 'not saved yet'}
                    {dirty && <span className="ml-1 font-semibold text-amber-300">· unsaved changes</span>}
                  </p>
                )}
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {editId && (
                  <a
                    href={`${itemPath(editId)}?preview=1`}
                    target="_blank"
                    rel="noopener"
                    className={`${smallButton} h-9`}
                    title={dirty ? 'Preview shows what is saved: save first to see your changes' : 'Open it in the studio as learners see it'}
                  >
                    <Eye className="h-4 w-4" aria-hidden="true" /> Preview
                  </a>
                )}
                <button type="button" onClick={requestClose} className="inline-flex h-9 w-9 items-center justify-center rounded-lg hover:bg-secondary" aria-label="Close the editor">
                  <X className="h-5 w-5" aria-hidden="true" />
                </button>
              </div>
            </header>

            {editId && (
              <div role="tablist" aria-label="Editor" className="flex gap-1 border-b border-border px-4 pt-2">
                {(['content', 'history'] as const).map((t) => (
                  <button
                    key={t}
                    type="button"
                    role="tab"
                    aria-selected={tab === t}
                    onClick={() => setTab(t)}
                    className={`rounded-t-lg px-3 py-2 text-sm font-medium ${tab === t ? 'border-b-2 border-primary text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
                  >
                    {t === 'content' ? 'Content' : `History${loaded ? ` (${loaded.history.length})` : ''}`}
                  </button>
                ))}
              </div>
            )}

            <div className="flex-1 overflow-y-auto px-4 py-4">
              {loadError && (
                <p role="alert" className="rounded-xl border border-destructive/40 bg-destructive/5 p-3 text-sm text-foreground">
                  {loadError}
                </p>
              )}
              {!form && !loadError && (
                <p className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Loading…
                </p>
              )}
              {error && (
                <div role="alert" className={`mb-4 rounded-xl border p-3 text-sm text-foreground ${error.conflict ? 'border-amber-500/60 bg-amber-500/10' : 'border-destructive/40 bg-destructive/5'}`}>
                  <p className="flex items-start gap-2 font-medium">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" /> {error.message}
                  </p>
                  {error.issues.length > 0 && (
                    <ul className="mt-2 list-disc space-y-0.5 pl-6">
                      {error.issues.slice(0, 12).map((issue) => (
                        <li key={issue}>{issue}</li>
                      ))}
                    </ul>
                  )}
                  {error.conflict && editId && (
                    <button type="button" className={`${smallButton} mt-2`} onClick={() => void load(editId).then(() => setError(null))}>
                      Load the latest version (your changes here are dropped)
                    </button>
                  )}
                </div>
              )}

              {form && tab === 'content' && (
                <div className="space-y-4">
                  <Section title="Basics">
                    <LocField label="Title" value={form.title} onChange={(title) => update({ title })} required />
                    <div className="grid gap-3 md:grid-cols-2">
                      <label className="flex flex-col gap-1 text-sm font-medium text-foreground">
                        {form.kind === 'challenge' ? 'Category' : 'Unit'}
                        <select value={form.groupId} onChange={(e) => update({ groupId: e.target.value })} className={inputClass}>
                          {groupOptions.map((g) => (
                            <option key={g.id} value={g.id}>
                              {g.title.en} · {g.title.he}
                            </option>
                          ))}
                        </select>
                        <span className="text-xs font-normal text-muted-foreground">Moving it to another {form.kind === 'challenge' ? 'category' : 'unit'} puts it at that one’s end.</span>
                      </label>
                      <label className="flex flex-col gap-1 text-sm font-medium text-foreground">
                        Access
                        <select value={form.access} onChange={(e) => update({ access: e.target.value as AccessMode })} className={`${inputClass} font-semibold ${accessStyle[form.access]}`}>
                          {ACCESS_MODES.map((mode) => (
                            <option key={mode} value={mode}>
                              {ACCESS_LABELS[mode]} — {ACCESS_HINTS[mode]}
                            </option>
                          ))}
                        </select>
                        <span className="text-xs font-normal text-muted-foreground">Free and Pro need every text in both languages.</span>
                      </label>
                    </div>
                    {form.kind === 'exercise' ? (
                      <>
                        <LocField label="Skill (one short line, for the course list)" value={form.skill} onChange={(skill) => update({ skill })} limit={LIMITS.skill} />
                        <div className="flex flex-wrap gap-4">
                          <label className="flex items-center gap-2 text-sm text-foreground">
                            <input type="checkbox" checked={form.optional} onChange={(e) => update({ optional: e.target.checked })} className="h-4 w-4" />
                            Optional (not numbered, skipped by “Next lesson”)
                          </label>
                          <label className="flex items-center gap-2 text-sm text-foreground">
                            Minutes on paper
                            <input type="number" inputMode="numeric" min={5} max={120} value={form.minutes} onChange={(e) => update({ minutes: e.target.value })} className={`${inputClass} w-24`} placeholder="—" />
                          </label>
                        </div>
                      </>
                    ) : (
                      <div className="grid gap-3 md:grid-cols-3">
                        <label className="flex flex-col gap-1 text-sm font-medium text-foreground">
                          Effort
                          <select value={form.level} onChange={(e) => update({ level: e.target.value as ChallengeForm['level'] })} className={inputClass}>
                            {CHALLENGE_LEVELS.map((level) => (
                              <option key={level} value={level}>
                                {LEVEL_LABELS[level]}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label className="flex flex-col gap-1 text-sm font-medium text-foreground">
                          Medium
                          <select value={form.medium} onChange={(e) => update({ medium: e.target.value as ChallengeForm['medium'] })} className={inputClass}>
                            {MEDIUMS.map((medium) => (
                              <option key={medium} value={medium}>
                                {MEDIUM_LABELS[medium]}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label className="flex items-center gap-2 self-end pb-2 text-sm text-foreground">
                          <input type="checkbox" checked={form.quick} onChange={(e) => update({ quick: e.target.checked })} className="h-4 w-4" /> Quick (about 10 minutes)
                        </label>
                      </div>
                    )}
                  </Section>

                  <RightsPanel value={licence} onChange={setLicence} />

                  {form.kind === 'exercise' ? (
                    <ExerciseParts form={form} update={update} licence={licence} title={title} onError={uploadFailed} />
                  ) : (
                    <ChallengeParts form={form} update={update} licence={licence} title={title} lessons={lessons} onError={uploadFailed} />
                  )}
                </div>
              )}

              {form && tab === 'history' && loaded && (
                <section aria-label="History of this item" className="space-y-2">
                  <p className="text-sm text-muted-foreground">
                    Every version that changed {editId}, newest first. Restoring a copy brings back its texts and pictures; its unit, place and access stay as they
                    are now. The whole content’s history is at the bottom of the page.
                  </p>
                  {loaded.history.length === 0 && <p className="text-sm text-muted-foreground">No recorded changes yet.</p>}
                  <ul className="divide-y divide-border rounded-2xl border border-border bg-card">
                    {loaded.history.map((entry) => (
                      <li key={entry.version} className="flex flex-wrap items-center justify-between gap-3 px-3 py-2.5 text-sm">
                        <span className="min-w-0">
                          <span className="font-medium text-foreground">Version {entry.version}</span>
                          {entry.live && <span className="ml-2 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[11px] font-semibold text-emerald-300">live</span>}
                          <span className="block text-xs text-muted-foreground">
                            {entry.at ? new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(entry.at)) : '—'} · {entry.by ?? '—'}
                            {entry.note ? ` · ${entry.note}` : ''}
                          </span>
                        </span>
                        {!entry.live && (
                          <button type="button" className={smallButton} disabled={locked !== null} onClick={() => setRestoring(entry.version)}>
                            <History className="h-3.5 w-3.5" aria-hidden="true" /> Restore this copy
                          </button>
                        )}
                      </li>
                    ))}
                  </ul>
                </section>
              )}
            </div>

            <footer className="flex flex-wrap items-center justify-end gap-2 border-t border-border bg-background px-4 py-3" style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))' }}>
              {locked && <p className="mr-auto text-xs text-muted-foreground">{locked}</p>}
              <button type="button" onClick={requestClose} className="h-11 rounded-xl border border-border px-5 text-sm font-medium text-foreground hover:bg-secondary">
                {dirty ? 'Cancel' : 'Close'}
              </button>
              <button type="button" onClick={() => void save()} disabled={!form || saving || locked !== null || (!dirty && target?.mode === 'edit')} className="inline-flex h-11 items-center gap-2 rounded-xl bg-primary px-6 text-sm font-semibold text-primary-foreground disabled:opacity-60">
                {saving && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
                {target?.mode === 'new' ? 'Add' : 'Save'}
              </button>
            </footer>
            {/* Inside the editor, so the confirmations stack on it (a sibling left the page unclickable once both closed). */}
            <AlertDialog open={confirmClose} onOpenChange={setConfirmClose}>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Discard your changes?</AlertDialogTitle>
                  <AlertDialogDescription>What you typed since the last save is not kept. Nothing live changes.</AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Keep editing</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={() => {
                      setConfirmClose(false);
                      onClose();
                    }}
                  >
                    Discard
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>

            <AlertDialog open={restoring !== null} onOpenChange={(open) => !open && setRestoring(null)}>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>
                    Restore {editId} from version {restoring}?
                  </AlertDialogTitle>
                  <AlertDialogDescription>
                    Its texts and pictures go back to that copy, live at once. Its unit, place and access stay as they are now. This is a new version: you can undo it
                    from this history too.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={() => {
                      if (restoring !== null) void restore(restoring);
                      setRestoring(null);
                    }}
                  >
                    Restore
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

    </>
  );
}

type Update = <F extends Form>(patch: Partial<F>) => void;

function ToolChoices({ value, onChange }: { value: ToolId[]; onChange: (tools: ToolId[]) => void }) {
  return (
    <fieldset>
      <legend className="text-sm font-medium text-foreground">Tool shortcuts on the page</legend>
      <div className="mt-2 flex flex-wrap gap-3">
        {LEARN_TOOLS.map((tool) => (
          <label key={tool} className="flex items-center gap-2 text-sm text-foreground">
            <input type="checkbox" checked={value.includes(tool)} onChange={(e) => onChange(e.target.checked ? [...value, tool] : value.filter((t) => t !== tool))} className="h-4 w-4" />
            {TOOL_LABELS[tool]}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function ExerciseParts({ form, update, licence, title, onError }: { form: ExerciseForm; update: Update; licence: LicenceForm; title: string; onError: (message: string, issues?: string[]) => void }) {
  const setSteps = (steps: StepForm[]) => update<ExerciseForm>({ steps });
  const setStep = (i: number, patch: Partial<StepForm>) => setSteps(form.steps.map((s, j) => (j === i ? { ...s, ...patch } : s)));
  const moveStep = (from: number, to: number) => {
    const next = [...form.steps];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    setSteps(next);
  };
  return (
    <>
      <Section title="The lesson" hint="What a learner sees, top to bottom. A Free or Pro lesson has exactly one picture and a task of one to three lines.">
        <LocField label="What you will learn (objective)" value={form.objective} onChange={(objective) => update<ExerciseForm>({ objective })} limit={LIMITS.objective} required multiline rows={2} />
        <div className="space-y-2">
          <p className="text-sm font-medium text-foreground">Lesson picture</p>
          {form.demo.map((frame, i) => (
            <div key={`${frame.image.assetId}-${i}`} className="space-y-2">
              <PictureEditor
                picture={frame.image}
                label={form.demo.length > 1 ? `Picture ${i + 1}` : 'The picture'}
                licence={licence}
                title={title}
                required
                onError={onError}
                onChange={(image) => update<ExerciseForm>({ demo: form.demo.map((f, j) => (j === i ? { ...f, image } : f)) })}
                onRemove={() => update<ExerciseForm>({ demo: form.demo.filter((_, j) => j !== i) })}
              />
              <LocField label="Caption under the picture" value={frame.caption} onChange={(caption) => update<ExerciseForm>({ demo: form.demo.map((f, j) => (j === i ? { ...f, caption } : f)) })} limit={LIMITS.caption} required multiline rows={2} />
            </div>
          ))}
          {form.demo.length === 0 && (
            <UploadButton label="Add the lesson picture" licence={licence} title={title} onError={onError} onUploaded={(u) => update<ExerciseForm>({ demo: [{ image: { assetId: u.assetId, thumbnailAssetId: u.thumbnailAssetId, previewUrl: u.previewUrl, alt: { en: title, he: '' }, credit: EMPTY }, caption: EMPTY }] })} />
          )}
        </div>
        <div className="space-y-3">
          <p className="text-sm font-medium text-foreground">Your task (one line each)</p>
          {form.steps.map((step, i) => (
            <div key={i} className="space-y-2 rounded-xl border border-border p-3" data-step={i + 1}>
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-semibold text-foreground">Line {i + 1}</span>
                <span className="flex gap-1">
                  <button type="button" className={smallButton} aria-label={`Move line ${i + 1} up`} disabled={i === 0} onClick={() => moveStep(i, i - 1)}>
                    <ArrowUp className="h-3.5 w-3.5" aria-hidden="true" />
                  </button>
                  <button type="button" className={smallButton} aria-label={`Move line ${i + 1} down`} disabled={i === form.steps.length - 1} onClick={() => moveStep(i, i + 1)}>
                    <ArrowDown className="h-3.5 w-3.5" aria-hidden="true" />
                  </button>
                  <button type="button" className={smallButton} aria-label={`Remove line ${i + 1}`} onClick={() => setSteps(form.steps.filter((_, j) => j !== i))}>
                    <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                  </button>
                </span>
              </div>
              <LocField label={`Line ${i + 1}`} value={step.text} onChange={(text) => setStep(i, { text })} limit={LIMITS.step} required multiline rows={2} />
              {step.image ? (
                <PictureEditor picture={step.image} label={`Picture for line ${i + 1}`} licence={licence} title={title} required onError={onError} onChange={(image) => setStep(i, { image })} onRemove={() => setStep(i, { image: null })} />
              ) : (
                <UploadButton label={`Add a picture to line ${i + 1}`} licence={licence} title={title} onError={onError} onUploaded={(u) => setStep(i, { image: { assetId: u.assetId, thumbnailAssetId: u.thumbnailAssetId, previewUrl: u.previewUrl, alt: { en: title, he: '' }, credit: EMPTY } })} />
              )}
              <div className="grid gap-2 md:grid-cols-3">
                <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
                  Tool button
                  <select value={step.tool} onChange={(e) => setStep(i, { tool: e.target.value as ToolId | '' })} className={inputClass}>
                    <option value="">None</option>
                    {LEARN_TOOLS.map((tool) => (
                      <option key={tool} value={tool}>
                        {TOOL_LABELS[tool]}
                      </option>
                    ))}
                  </select>
                </label>
                {step.tool === 'value' && (
                  <>
                    <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
                      Values
                      <select value={step.levels} onChange={(e) => setStep(i, { levels: e.target.value })} className={inputClass}>
                        <option value="">As the person last chose</option>
                        {STUDY_LEVELS.map((n) => (
                          <option key={n} value={n}>
                            {n}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="flex items-center gap-2 self-end pb-2 text-sm text-foreground">
                      <input type="checkbox" checked={step.squint} disabled={!step.levels} onChange={(e) => setStep(i, { squint: e.target.checked })} className="h-4 w-4" /> Squint
                    </label>
                  </>
                )}
                {step.tool === 'grid' && (
                  <>
                    <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
                      Columns
                      <input type="number" min={GRID_DIVISIONS.min} max={GRID_DIVISIONS.max} value={step.columns} onChange={(e) => setStep(i, { columns: e.target.value })} className={inputClass} />
                    </label>
                    <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
                      Rows
                      <input type="number" min={GRID_DIVISIONS.min} max={GRID_DIVISIONS.max} value={step.rows} onChange={(e) => setStep(i, { rows: e.target.value })} className={inputClass} />
                    </label>
                  </>
                )}
              </div>
              {step.tool && <LocField label="Tool button text" value={step.toolLabel} onChange={(toolLabel) => setStep(i, { toolLabel })} required />}
            </div>
          ))}
          {form.steps.length < 3 && (
            <button type="button" className={smallButton} onClick={() => setSteps([...form.steps, { text: EMPTY, image: null, tool: '', toolLabel: EMPTY, levels: '', squint: false, columns: '', rows: '', worksheet: false }])}>
              <Plus className="h-3.5 w-3.5" aria-hidden="true" /> Add a line
            </button>
          )}
        </div>
        <LocField label="Make something (one small creative line, optional)" value={form.create} onChange={(create) => update<ExerciseForm>({ create })} limit={LIMITS.create} multiline rows={2} />
        <LocField label="Done when" value={form.success} onChange={(success) => update<ExerciseForm>({ success })} required multiline rows={2} />
      </Section>

      <Section title="In lists" hint="The short description on cards and in the course list.">
        <LocField label="Short description" value={form.instruction} onChange={(instruction) => update<ExerciseForm>({ instruction })} required multiline rows={2} />
      </Section>

      <Section title="Need help?" hint="Behind the “Need help?” button.">
        <LocField label="Why it works (optional)" value={form.guide} onChange={(guide) => update<ExerciseForm>({ guide })} limit={LIMITS.why} multiline rows={3} />
        <LocField label="Common mistake" value={form.mistake} onChange={(mistake) => update<ExerciseForm>({ mistake })} required multiline rows={2} />
        <LocField label="How to fix it" value={form.fix} onChange={(fix) => update<ExerciseForm>({ fix })} required multiline rows={2} />
        {form.mistakeImage ? (
          <PictureEditor picture={form.mistakeImage} label="Mistake picture" licence={licence} title={title} required onError={onError} onChange={(mistakeImage) => update<ExerciseForm>({ mistakeImage })} onRemove={() => update<ExerciseForm>({ mistakeImage: null })} />
        ) : (
          <UploadButton label="Add a mistake picture" licence={licence} title={title} onError={onError} onUploaded={(u) => update<ExerciseForm>({ mistakeImage: { assetId: u.assetId, thumbnailAssetId: u.thumbnailAssetId, previewUrl: u.previewUrl, alt: { en: title, he: '' }, credit: EMPTY } })} />
        )}
        <LocField label="What you need" value={form.materials} onChange={(materials) => update<ExerciseForm>({ materials })} required multiline rows={2} />
      </Section>

      <Section title="Reference photos" hint="The subject to draw from, in this order (optional for a lesson).">
        <PictureList label="Reference photo" pictures={form.references} onChange={(references) => update<ExerciseForm>({ references })} licence={licence} title={title} onError={onError} />
      </Section>

      <Section title="Practice sheet and tools">
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium text-foreground">Practice sheet</legend>
          {(['none', 'generated', 'static'] as const).map((kind) => (
            <label key={kind} className="flex items-center gap-2 text-sm text-foreground">
              <input
                type="radio"
                name="worksheet"
                checked={form.worksheet.kind === kind}
                disabled={kind === 'static' && form.worksheet.kind !== 'static'}
                onChange={() => update<ExerciseForm>({ worksheet: kind === 'static' ? form.worksheet : { kind } })}
                className="h-4 w-4"
              />
              {kind === 'none' ? 'None' : kind === 'generated' ? 'Made from the picture (Prepare Worksheets)' : 'A PDF sheet'}
            </label>
          ))}
          <div className="flex flex-wrap items-center gap-2">
            {form.worksheet.kind === 'static' && (
              <a href={`/api/learn/assets/${form.worksheet.assetId}`} className="text-sm text-primary underline" target="_blank" rel="noopener">
                Open the PDF{form.worksheet.name ? ` (${form.worksheet.name})` : ''}
              </a>
            )}
            <UploadButton
              label={form.worksheet.kind === 'static' ? 'Replace the PDF' : 'Upload a PDF sheet'}
              kind="pdf"
              icon={form.worksheet.kind === 'static' ? 'replace' : 'add'}
              licence={licence}
              title={title}
              onError={onError}
              onUploaded={(u) => update<ExerciseForm>({ worksheet: { kind: 'static', assetId: u.assetId, name: u.name } })}
            />
          </div>
        </fieldset>
        <ToolChoices value={form.tools} onChange={(tools) => update<ExerciseForm>({ tools })} />
      </Section>
    </>
  );
}

function ChallengeParts({
  form,
  update,
  licence,
  title,
  lessons,
  onError,
}: {
  form: ChallengeForm;
  update: Update;
  licence: LicenceForm;
  title: string;
  lessons: LessonOption[];
  onError: (message: string, issues?: string[]) => void;
}) {
  return (
    <>
      <Section title="The challenge">
        <LocField label="Prompt" value={form.prompt} onChange={(prompt) => update<ChallengeForm>({ prompt })} required multiline rows={3} />
        <LocField label="Tip (focus, optional)" value={form.focus} onChange={(focus) => update<ChallengeForm>({ focus })} limit={LIMITS.focus} multiline rows={2} />
        <LocField label="Twist (optional)" value={form.twist} onChange={(twist) => update<ChallengeForm>({ twist })} limit={LIMITS.twist} multiline rows={2} />
        <LocField label="Skill" value={form.skill} onChange={(skill) => update<ChallengeForm>({ skill })} required />
        <label className="flex max-w-xs flex-col gap-1 text-sm font-medium text-foreground">
          Skill area (1–10)
          <select value={form.skillArea} onChange={(e) => update<ChallengeForm>({ skillArea: Number(e.target.value) })} className={inputClass}>
            {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
      </Section>

      <Section title="What to draw from">
        <label className="flex flex-col gap-1 text-sm font-medium text-foreground">
          Reference
          <select value={form.reference} onChange={(e) => update<ChallengeForm>({ reference: e.target.value as ChallengeForm['reference'] })} className={inputClass}>
            {REFERENCE_KINDS.map((kind) => (
              <option key={kind} value={kind}>
                {REFERENCE_LABELS[kind]}
              </option>
            ))}
          </select>
          {form.reference === 'provided' && form.references.length === 0 && <span className="text-xs font-normal text-amber-300">“A picture we provide” needs at least one picture below.</span>}
        </label>
        <PictureList label="Reference picture" pictures={form.references} onChange={(references) => update<ChallengeForm>({ references })} licence={licence} title={title} onError={onError} />
      </Section>

      <Section title="Builds on (up to 3 lessons)" hint="Shown as “Builds on: Lesson 3”; its skill filter follows their units.">
        <div className="space-y-2">
          {form.lessons.map((id, i) => (
            <div key={`${id}-${i}`} className="flex items-center gap-2">
              <select value={id} onChange={(e) => update<ChallengeForm>({ lessons: form.lessons.map((l, j) => (j === i ? e.target.value : l)) })} className={inputClass}>
                {lessons.map((lesson) => (
                  <option key={lesson.id} value={lesson.id}>
                    {lesson.number ? `Lesson ${lesson.number} · ` : ''}
                    {lesson.title.en} ({lesson.id})
                  </option>
                ))}
              </select>
              <button type="button" className={smallButton} aria-label={`Remove ${id}`} onClick={() => update<ChallengeForm>({ lessons: form.lessons.filter((_, j) => j !== i) })}>
                <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            </div>
          ))}
          {form.lessons.length < 3 && lessons.length > 0 && (
            <button type="button" className={smallButton} onClick={() => update<ChallengeForm>({ lessons: [...form.lessons, lessons.find((l) => !form.lessons.includes(l.id))?.id ?? lessons[0].id] })}>
              <Plus className="h-3.5 w-3.5" aria-hidden="true" /> Add a lesson
            </button>
          )}
        </div>
      </Section>

      <Section title="Tools">
        <ToolChoices value={form.tools} onChange={(tools) => update<ChallengeForm>({ tools })} />
      </Section>
    </>
  );
}
