'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, ImagePlus, Loader2, RefreshCw, Trash2, Upload } from 'lucide-react';
import { EMPTY, type Loc, type PictureForm } from './form';
import { ImageError, UploadError, defaultLicence, prepareImage, uploadAsset, type LicenceForm, type LicenceKind } from './images';

// The editor's parts (ADR-0023): a text in English and Hebrew side by side
// (Hebrew right to left), pictures with their description, and the rights
// new uploads are recorded with.

/**
 * Radix modals switch the page's pointer events off while open and back on
 * when the last one closes; with a confirmation over the editor, the page
 * could stay unclickable after both had closed. Once none of ours is open
 * and no dialog is left on the page, the page takes clicks again.
 */
export function useReleaseAfterDialogs(open: boolean) {
  useEffect(() => {
    if (open) return;
    const timer = window.setTimeout(() => {
      if (!document.querySelector('[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"]') && document.body.style.pointerEvents === 'none') {
        document.body.style.pointerEvents = '';
      }
    }, 400);
    return () => window.clearTimeout(timer);
  }, [open]);
}

export { EMPTY, type Loc, type PictureForm };

export const inputClass = 'w-full rounded-lg border border-border bg-background px-3 py-2 text-base text-foreground md:text-sm disabled:opacity-60';
export const smallButton = 'inline-flex h-8 items-center gap-1 rounded-lg border border-border px-2.5 text-xs font-semibold text-foreground hover:bg-secondary disabled:pointer-events-none disabled:opacity-50';

const length = (text: string) => [...text].length;

/** A text in both languages: English (left to right) and Hebrew (right to left), each with its counter when it has a limit. */
export function LocField({
  label,
  value,
  onChange,
  multiline = false,
  limit,
  required = false,
  hint,
  rows = 3,
}: {
  label: string;
  value: Loc;
  onChange: (value: Loc) => void;
  multiline?: boolean;
  limit?: number;
  /** Needed in both languages before the item can be Free or Pro. */
  required?: boolean;
  hint?: string;
  rows?: number;
}) {
  const id = useId();
  const field = (lang: 'en' | 'he') => {
    const text = value[lang];
    const over = limit !== undefined && length(text) > limit;
    const props = {
      id: `${id}-${lang}`,
      value: text,
      dir: lang === 'he' ? ('rtl' as const) : ('ltr' as const),
      lang,
      'aria-describedby': hint ? `${id}-hint` : undefined,
      'aria-invalid': over || undefined,
      onChange: (e: { target: { value: string } }) => onChange({ ...value, [lang]: e.target.value }),
      className: `${inputClass} ${over ? 'border-destructive' : ''}`,
    };
    return (
      <div className="min-w-0">
        <div className="mb-1 flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
          <label htmlFor={`${id}-${lang}`}>
            {label} · {lang === 'en' ? 'English' : 'עברית'}
          </label>
          {limit !== undefined && (
            <span className={over ? 'font-semibold text-red-300' : ''}>
              {length(text)}/{limit}
            </span>
          )}
        </div>
        {multiline ? <textarea rows={rows} {...props} /> : <input type="text" {...props} />}
      </div>
    );
  };
  const missing = required && (!value.en.trim() || !value.he.trim());
  return (
    <fieldset className="space-y-1">
      <legend className="text-sm font-medium text-foreground">
        {label}
        {required && <span className="ml-1 text-xs font-normal text-muted-foreground">(both languages for Free or Pro)</span>}
        {missing && <span className="ml-2 rounded bg-amber-500/15 px-1.5 py-0.5 text-[11px] font-semibold text-amber-300">missing</span>}
      </legend>
      {hint && (
        <p id={`${id}-hint`} className="text-xs text-muted-foreground">
          {hint}
        </p>
      )}
      <div className="grid gap-2 md:grid-cols-2">
        {field('en')}
        {field('he')}
      </div>
    </fieldset>
  );
}

/** Where the rights of new uploads are set: own work unless said otherwise. */
export function RightsPanel({ value, onChange }: { value: LicenceForm; onChange: (value: LicenceForm) => void }) {
  const set = (patch: Partial<LicenceForm>) => onChange({ ...value, ...patch });
  const kinds: [LicenceKind, string][] = [
    ['own', 'My own work (drawn or photographed for Studio Companion)'],
    ['commissioned', 'Made for Studio Companion by someone else'],
    ['cc0', 'CC0 (public domain dedication)'],
    ['public-domain', 'Public domain'],
    ['licensed', 'Licensed to us'],
  ];
  const needsSource = value.kind !== 'own' && value.kind !== 'commissioned';
  return (
    <details className="rounded-xl border border-border bg-background p-3 text-sm">
      <summary className="cursor-pointer font-medium text-foreground">
        Rights for new uploads: <span className="font-normal text-muted-foreground">{kinds.find(([k]) => k === value.kind)?.[1]}</span>
      </summary>
      <div className="mt-3 grid gap-3 md:grid-cols-2">
        <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground md:col-span-2">
          Whose picture is it?
          <select value={value.kind} onChange={(e) => set({ kind: e.target.value as LicenceKind })} className={inputClass}>
            {kinds.map(([kind, label]) => (
              <option key={kind} value={kind}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
          Author
          <input value={value.author} onChange={(e) => set({ author: e.target.value })} className={inputClass} />
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
          Title of the work
          <input value={value.title} onChange={(e) => set({ title: e.target.value })} className={inputClass} />
        </label>
        {needsSource && (
          <>
            <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
              Source page (https)
              <input value={value.source} onChange={(e) => set({ source: e.target.value })} placeholder="https://…" className={inputClass} />
            </label>
            <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
              Licence page (https{value.kind === 'public-domain' ? ', optional' : ''})
              <input value={value.licenceUrl} onChange={(e) => set({ licenceUrl: e.target.value })} placeholder="https://…" className={inputClass} />
            </label>
          </>
        )}
        <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground md:col-span-2">
          What the source says about the rights
          <textarea rows={2} value={value.rights} onChange={(e) => set({ rights: e.target.value })} className={inputClass} />
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground md:col-span-2">
          Credit line the source asks for (optional)
          <input value={value.attribution} onChange={(e) => set({ attribution: e.target.value })} className={inputClass} />
        </label>
      </div>
    </details>
  );
}

/** Choose a file and store it (pictures re-saved in the browser first); reports the stored picture or what went wrong. */
export function UploadButton({
  label,
  kind = 'image',
  licence,
  title,
  onUploaded,
  onError,
  icon = 'add',
  disabled = false,
}: {
  label: string;
  kind?: 'image' | 'pdf';
  licence: LicenceForm;
  /** The work's title when the rights panel leaves it empty (the item's title). */
  title: string;
  onUploaded: (uploaded: { assetId: string; thumbnailAssetId: string | null; previewUrl?: string; name: string }) => void;
  onError: (message: string, issues?: string[]) => void;
  icon?: 'add' | 'replace';
  disabled?: boolean;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  async function upload(file: File) {
    setBusy(true);
    try {
      const rights = { ...licence, title: licence.title.trim() || title || file.name.replace(/\.[^.]+$/, '') };
      if (kind === 'pdf') {
        if (file.type !== 'application/pdf' && !/\.pdf$/i.test(file.name)) throw new ImageError('Choose a PDF file.');
        const stored = await uploadAsset({ role: 'worksheet', main: file, thumbnail: null, licence: rights, name: file.name });
        onUploaded({ assetId: stored.assetId, thumbnailAssetId: null, name: file.name });
      } else {
        const prepared = await prepareImage(file);
        const stored = await uploadAsset({ role: 'reference', main: prepared.main, thumbnail: prepared.thumbnail, licence: rights, name: file.name.replace(/\.[^.]+$/, '') + (prepared.main.type === 'image/png' ? '.png' : '.jpg') });
        onUploaded({ assetId: stored.assetId, thumbnailAssetId: stored.thumbnailAssetId, previewUrl: prepared.previewUrl, name: file.name });
      }
    } catch (error) {
      if (error instanceof UploadError) onError(error.message, error.issues);
      else if (error instanceof ImageError) onError(error.message);
      else onError('The file could not be prepared. Try another one.');
    } finally {
      setBusy(false);
      if (input.current) input.current.value = '';
    }
  }
  const Icon = busy ? Loader2 : icon === 'replace' ? RefreshCw : kind === 'pdf' ? Upload : ImagePlus;
  return (
    <>
      {/* Visually hidden, not display:none: Safari opens the picker only for a file input that is rendered. */}
      <input
        ref={input}
        type="file"
        tabIndex={-1}
        aria-hidden="true"
        className="sr-only"
        accept={kind === 'pdf' ? 'application/pdf,.pdf' : 'image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif'}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void upload(file);
        }}
      />
      <button type="button" className={smallButton} disabled={busy || disabled} onClick={() => input.current?.click()}>
        <Icon className={`h-3.5 w-3.5 ${busy ? 'animate-spin' : ''}`} aria-hidden="true" /> {busy ? 'Uploading…' : label}
      </button>
    </>
  );
}

/** A picture: its thumbnail, its description in both languages (and an optional credit), with Replace and Remove. */
export function PictureEditor({
  picture,
  label,
  licence,
  title,
  onChange,
  onRemove,
  onError,
  extra,
  required = false,
}: {
  picture: PictureForm;
  label: string;
  licence: LicenceForm;
  title: string;
  onChange: (picture: PictureForm) => void;
  onRemove: () => void;
  onError: (message: string, issues?: string[]) => void;
  extra?: React.ReactNode;
  required?: boolean;
}) {
  const src = picture.previewUrl ?? (picture.thumbnailAssetId ? `/api/learn/assets/${picture.thumbnailAssetId}` : null);
  return (
    <div className="rounded-xl border border-border bg-background p-3" data-picture={picture.assetId}>
      <div className="flex flex-wrap items-start gap-3">
        {src ? (
          <a href={`/api/learn/assets/${picture.assetId}`} target="_blank" rel="noopener" className="shrink-0" title="Open the full picture">
            {/* eslint-disable-next-line @next/next/no-img-element -- served by the authorized asset route, or a local preview */}
            <img src={src} alt={picture.alt.en || label} className="h-24 w-24 rounded-lg border border-border object-cover" />
          </a>
        ) : (
          <span className="flex h-24 w-24 shrink-0 items-center justify-center rounded-lg border border-dashed border-border text-xs text-muted-foreground">no preview</span>
        )}
        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium text-foreground">{label}</span>
            <UploadButton label="Replace" icon="replace" licence={licence} title={title} onError={onError} onUploaded={(u) => onChange({ ...picture, assetId: u.assetId, thumbnailAssetId: u.thumbnailAssetId, previewUrl: u.previewUrl })} />
            <button type="button" className={smallButton} onClick={onRemove}>
              <Trash2 className="h-3.5 w-3.5" aria-hidden="true" /> Remove
            </button>
            {extra}
          </div>
          <LocField label="Description for screen readers" value={picture.alt} onChange={(alt) => onChange({ ...picture, alt })} required={required} />
          <LocField label="Credit (optional)" value={picture.credit} onChange={(credit) => onChange({ ...picture, credit })} />
        </div>
      </div>
    </div>
  );
}

/** A list of pictures in order: add, replace, move and remove. */
export function PictureList({
  label,
  pictures,
  onChange,
  licence,
  title,
  onError,
  max = 20,
}: {
  label: string;
  pictures: PictureForm[];
  onChange: (pictures: PictureForm[]) => void;
  licence: LicenceForm;
  title: string;
  onError: (message: string, issues?: string[]) => void;
  max?: number;
}) {
  const move = (from: number, to: number) => {
    const next = [...pictures];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    onChange(next);
  };
  return (
    <div className="space-y-2">
      {pictures.map((picture, i) => (
        <PictureEditor
          key={`${picture.assetId}-${i}`}
          picture={picture}
          label={`${label} ${i + 1}`}
          licence={licence}
          title={title}
          required
          onError={onError}
          onChange={(p) => onChange(pictures.map((x, j) => (j === i ? p : x)))}
          onRemove={() => onChange(pictures.filter((_, j) => j !== i))}
          extra={
            <>
              <button type="button" className={smallButton} aria-label={`Move ${label.toLowerCase()} ${i + 1} up`} disabled={i === 0} onClick={() => move(i, i - 1)}>
                <ArrowUp className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
              <button type="button" className={smallButton} aria-label={`Move ${label.toLowerCase()} ${i + 1} down`} disabled={i === pictures.length - 1} onClick={() => move(i, i + 1)}>
                <ArrowDown className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            </>
          }
        />
      ))}
      {pictures.length < max && (
        <UploadButton
          label={pictures.length === 0 ? `Add ${label.toLowerCase()}` : `Add another ${label.toLowerCase()}`}
          licence={licence}
          title={title}
          onError={onError}
          onUploaded={(u) => onChange([...pictures, { assetId: u.assetId, thumbnailAssetId: u.thumbnailAssetId, previewUrl: u.previewUrl, alt: { en: title, he: '' }, credit: EMPTY }])}
        />
      )}
    </div>
  );
}

/** A section of the editor. */
export function Section({ title, children, hint }: { title: string; children: React.ReactNode; hint?: string }) {
  return (
    <section className="space-y-3 rounded-2xl border border-border bg-card p-4">
      <div>
        <h3 className="text-base font-semibold text-foreground">{title}</h3>
        {hint && <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>}
      </div>
      {children}
    </section>
  );
}

export { defaultLicence };
