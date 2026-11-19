import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'use-intl';
import { Check, ChevronDown, Dices, Layers, Loader2, Lock, Printer } from 'lucide-react';
import { useProject } from '@/hooks/useProjectStore';
import type { LearnReturn } from '@/hooks/useLearnReturn';
import { activeControls, resolveSketch } from '@/lib/sketch/settings';
import { matchesFilters, pickChallenge, DEFAULT_FILTERS } from '@/lib/learn/pick';
import type { ToolLink } from '@/lib/learn/model';
import { itemPath, learnPath } from '@/lib/learn/routes';
import { useAccount, useHasFeature } from '@/components/shell/account';
import { TOOLS } from '@/components/shell/tools';
import PrepareWorksheets from '@/components/worksheets/PrepareWorksheets';
import { LearnRequestError, assetUrl, localDay, referenceDataUrl, useCompletionChanges, useCompletions, useLearnList, type ImageView, type OpenItem } from './data';
import { useClassMode } from './ClassMode';
import { ReplaceDialog, useToolHandoff } from './handoff';
import { recentlyDone } from './LearnHome';
import { useStoredFilters } from './ChallengesScreen';
import { DoneTick, buttonPrimary, buttonSecondary, chip, useLocalized } from './parts';

// What an exercise's card, a lesson and a challenge share (ADR-0018,
// ADR-0019): the worksheets, "Mark as completed", "Another one", the tool
// shortcuts and the picture credits. One implementation each, whichever page
// shows them.

/**
 * The item's worksheets, offered as in the tools (shown if any plan has the
 * feature, locked when this one does not): Prepare worksheets from the
 * reference (M3's sheet, fitted to Create a Grid's canvas), the static sheet
 * (a PDF in the content), or "Use my photo" for a challenge drawn from one's
 * own photo. The sheet itself opens over the page.
 */
export function useWorksheets(item: OpenItem) {
  const t = useTranslations('learn.item');
  const tw = useTranslations('worksheets');
  const router = useRouter();
  const classMode = useClassMode();
  const { gridSettings, valueSettings } = useProject();
  const offer = useAccount()?.account.offer;
  const canWorksheets = useHasFeature('export.worksheets');
  const offered = canWorksheets || offer?.free.includes('export.worksheets') === true || offer?.pro.includes('export.worksheets') === true;
  const reference = item.references[0] ?? null;
  const generated = offered && reference !== null && (item.kind === 'exercise' ? item.worksheet.kind === 'generated' : item.reference === 'provided');
  const staticSheet = item.kind === 'exercise' && item.worksheet.kind === 'static' ? item.worksheet.assetId : null;
  const ownPhoto = offered && item.kind === 'challenge' && item.reference === 'own_photo';
  const [sheet, setSheet] = useState<{ image: string; learnItem: string | null } | null>(null);
  const [preparing, setPreparing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The canvas and grid are Create a Grid's; the picture is fitted to the canvas (as from Study).
  const settings = useMemo(() => ({ ...gridSettings, rotation: 0 as const, imageScale: 1, imageOffsetX: 0, imageOffsetY: 0 }), [gridSettings]);
  const outline = useMemo(() => activeControls({ ...resolveSketch(valueSettings), style: 'outline' }), [valueSettings]);

  const prepare = async () => {
    if (!reference || preparing) return;
    setError(null);
    setPreparing(true);
    try {
      setSheet({ image: await referenceDataUrl(reference.assetId), learnItem: item.id });
    } catch (failure) {
      setError(failure instanceof LearnRequestError && failure.status === 403 ? t('handoffLocked') : t('handoffFailed'));
    } finally {
      setPreparing(false);
    }
  };
  const usePhoto = (file: File | undefined) => {
    if (!file || !file.type.startsWith('image/')) return;
    const reader = new FileReader();
    reader.onload = () => setSheet({ image: reader.result as string, learnItem: null });
    reader.readAsDataURL(file);
  };
  // Class mode: the next student starts from the library again, with the same sheet choices.
  const nextStudent = () => {
    setSheet(null);
    router.push(learnPath({ screen: item.kind === 'challenge' ? 'challenges' : 'curriculum' }));
  };

  const view = sheet ? (
    <PrepareWorksheets
      from="grid"
      image={sheet.image}
      settings={settings}
      fitted
      outline={outline}
      learnItem={sheet.learnItem}
      lead={sheet.learnItem ? tw('fromReference') : undefined}
      onNext={classMode.on ? nextStudent : undefined}
      onClose={() => setSheet(null)}
    />
  ) : null;

  return { canWorksheets, generated, staticSheet, ownPhoto, preparing, error, prepare, usePhoto, view };
}

export type Worksheets = ReturnType<typeof useWorksheets>;

/** "Prepare worksheets" (locked when the plan lacks the feature). */
export function PrepareButton({ sheets, primary = true }: { sheets: Worksheets; primary?: boolean }) {
  const t = useTranslations('learn.item');
  return (
    <button type="button" onClick={() => void sheets.prepare()} disabled={sheets.preparing} className={primary ? buttonPrimary : buttonSecondary} data-learn-worksheets>
      {sheets.preparing ? <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" /> : sheets.canWorksheets ? <Layers className="h-5 w-5" aria-hidden="true" /> : <Lock className="h-5 w-5" aria-hidden="true" />}
      {sheets.canWorksheets ? t('worksheets') : t('worksheetsLocked')}
    </button>
  );
}

/** "Print worksheet": the item's static sheet, from the authorized route. */
export function PrintSheet({ assetId, primary = true }: { assetId: string; primary?: boolean }) {
  const t = useTranslations('learn.item');
  return (
    <a href={assetUrl(assetId)} download className={primary ? buttonPrimary : buttonSecondary} data-learn-print-worksheet>
      <Printer className="h-5 w-5" aria-hidden="true" /> {t('printWorksheet')}
    </a>
  );
}

/** "Mark as completed": optional; once a day; "Undo" for a few seconds afterwards. Never shown in class mode. */
export function MarkDone({ itemId }: { itemId: string }) {
  const t = useTranslations('learn.item');
  const completions = useCompletions(true);
  const { mark, remove } = useCompletionChanges();
  const [undoable, setUndoable] = useState<string | null>(null);
  const [status, setStatus] = useState<'marked' | 'undone' | 'failed' | null>(null);
  const entry = completions.data?.summary.items[itemId];
  const today = entry ? localDay(entry.last) === localDay(new Date()) : false;

  useEffect(() => {
    if (!undoable) return;
    const timer = window.setTimeout(() => setUndoable(null), 8000);
    return () => window.clearTimeout(timer);
  }, [undoable]);

  const onMark = () =>
    mark.mutate(itemId, {
      onSuccess: ({ completion }) => {
        setUndoable(completion.id);
        setStatus('marked');
      },
      onError: () => setStatus('failed'),
    });
  const onUndo = () => {
    if (!undoable) return;
    remove.mutate(undoable, {
      onSuccess: () => {
        setUndoable(null);
        setStatus('undone');
      },
      onError: () => setStatus('failed'),
    });
  };

  return (
    <div className="flex flex-col gap-1.5">
      <button type="button" onClick={onMark} disabled={today || mark.isPending || completions.isPending} className={buttonSecondary} data-mark-done={today ? 'today' : 'ready'}>
        {mark.isPending ? <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" /> : <Check className="h-5 w-5" aria-hidden="true" />}
        {mark.isPending ? t('marking') : today ? t('doneToday') : t('markDone')}
      </button>
      <span className="flex min-h-[20px] flex-wrap items-center gap-2" aria-live="polite">
        {entry && <DoneTick count={entry.count} />}
        {status === 'marked' && undoable && (
          <>
            <span className="text-sm text-foreground">{t('marked')}</span>
            <button
              type="button"
              onClick={onUndo}
              disabled={remove.isPending}
              className="min-h-[36px] rounded-lg px-2 text-sm font-semibold text-primary underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              data-undo
            >
              {t('undo')}
            </button>
          </>
        )}
        {status === 'undone' && <span className="text-sm text-foreground">{t('undone')}</span>}
        {status === 'failed' && <span className="text-sm text-destructive">{t('markFailed')}</span>}
      </span>
    </div>
  );
}

/** Whether the item was marked as completed today (a lesson's "Next" then leads). */
export function useDoneToday(itemId: string, enabled: boolean): boolean {
  const completions = useCompletions(enabled);
  const entry = completions.data?.summary.items[itemId];
  return entry ? localDay(entry.last) === localDay(new Date()) : false;
}

/** "Another one": a new pick the way this one was reached (all challenges, or the filters; quick or not), never this one. */
export function AnotherOne({ currentId, unitsOf }: { currentId: string; unitsOf?: (lessons: string[] | undefined) => string[] }) {
  const t = useTranslations('learn.item');
  const router = useRouter();
  const params = useSearchParams();
  const classMode = useClassMode();
  const list = useLearnList('challenges');
  const completions = useCompletions(!classMode.on);
  const [stored] = useStoredFilters();
  // How this challenge was reached, from a fixed set (anything else is ignored).
  const asked = params.get('pick');
  const how = asked === 'all' || asked === 'quick' || asked === 'filters' || asked === 'filters-quick' ? asked : null;
  const quickOnly = how === 'quick' || how === 'filters-quick';
  const filters = how === 'all' || how === 'quick' ? DEFAULT_FILTERS : stored;
  const items = list.data?.items ?? [];
  const another = items.some((e) => e.open && e.id !== currentId && matchesFilters(e, quickOnly ? { ...filters, quick: true } : filters, unitsOf));
  const go = () => {
    const id = pickChallenge(items, {
      filters,
      quickOnly,
      exclude: currentId,
      recentlyDone: classMode.on ? [] : recentlyDone(completions.data),
      recentlySeen: classMode.recent,
      unitsOf,
    });
    if (id && id !== currentId) router.push(`${itemPath(id)}${how ? `?pick=${how}` : ''}`);
  };
  return (
    <button type="button" onClick={go} disabled={!another} className={buttonSecondary} data-another>
      <Dices className="h-5 w-5" aria-hidden="true" /> {t('another')}
    </button>
  );
}

/** "Tools that help": each opens its tool with the item's reference already in it, and the way back. */
export function ToolShortcuts({ item, back }: { item: OpenItem; back?: LearnReturn }) {
  const t = useTranslations('learn.item');
  const tg = useTranslations();
  const handoff = useToolHandoff();
  if (item.tools.length === 0) return null;
  return (
    <section aria-labelledby="learn-tools-title" className="mt-6" data-learn-tools>
      <h2 id="learn-tools-title" className="mb-2 text-sm font-semibold text-muted-foreground">
        {t('tools')}
      </h2>
      <div className="flex flex-wrap gap-2">
        {item.tools.map((tool) => {
          const Icon = TOOLS[tool].icon;
          return (
            <button key={tool} type="button" onClick={() => void handoff.open(tool, item, { back })} disabled={handoff.busy !== null} className={chip} data-open-in={tool}>
              {handoff.busy === tool ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Icon className="h-4 w-4 text-primary" aria-hidden="true" />}
              {handoff.busy === tool ? t('opening') : t('openIn', { tool: tg(`tools.${tool}.title`) })}
            </button>
          );
        })}
      </div>
      {handoff.error && (
        <p role="alert" className="mt-2 text-sm text-destructive">
          {handoff.error}
        </p>
      )}
      {handoff.confirming && (
        <ReplaceDialog
          toolName={tg(`tools.${handoff.confirming.tool}.title`)}
          onReplace={() => void handoff.open(handoff.confirming!.tool, handoff.confirming!.item, handoff.confirming!.options, true)}
          onCancel={handoff.cancel}
        />
      )}
    </section>
  );
}

/** A tool link inside a lesson's step: what it is for, and the tool set as the step needs it. */
export function StepToolLink({ item, link, back }: { item: OpenItem; link: ToolLink; back: LearnReturn }) {
  const t = useTranslations('learn.item');
  const tg = useTranslations();
  const loc = useLocalized();
  const handoff = useToolHandoff();
  const Icon = TOOLS[link.tool].icon;
  return (
    <div className="mt-2">
      <button
        type="button"
        onClick={() => void handoff.open(link.tool, item, { preset: link.preset, back })}
        disabled={handoff.busy !== null}
        className={chip}
        data-step-tool={link.tool}
      >
        {handoff.busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Icon className="h-4 w-4 text-primary" aria-hidden="true" />}
        <span>
          {handoff.busy ? t('opening') : loc(link.label)}
          <span className="sr-only"> ({tg(`tools.${link.tool}.title`)})</span>
        </span>
      </button>
      {handoff.error && (
        <p role="alert" className="mt-1.5 text-sm text-destructive">
          {handoff.error}
        </p>
      )}
      {handoff.confirming && (
        <ReplaceDialog
          toolName={tg(`tools.${handoff.confirming.tool}.title`)}
          onReplace={() => void handoff.open(handoff.confirming!.tool, handoff.confirming!.item, handoff.confirming!.options, true)}
          onCancel={handoff.cancel}
        />
      )}
    </div>
  );
}

/** The picture credits of an item, folded: only the credits fold, never the teaching (ADR-0019). */
export function Credits({ images }: { images: ImageView[] }) {
  const t = useTranslations('learn.item');
  const loc = useLocalized();
  const lines = [...new Set(images.flatMap((image) => (image.credit ? [loc(image.credit)] : [])))];
  if (lines.length === 0) return null;
  return (
    <details className="group mt-6 rounded-2xl border border-border bg-card" data-learn-credits>
      <summary className="flex min-h-[44px] cursor-pointer list-none items-center justify-between gap-2 rounded-2xl px-4 text-sm font-semibold text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
        {t('credits')}
        <ChevronDown className="h-4 w-4 shrink-0 transition-transform group-open:rotate-180" aria-hidden="true" />
      </summary>
      <ul className="space-y-1 px-4 pb-3 text-xs leading-relaxed text-muted-foreground">
        {lines.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
    </details>
  );
}

/** A picture inside the page that opens full screen on a tap. */
export function useOpenFull() {
  const [open, setOpen] = useState<ImageView | null>(null);
  return { open, show: setOpen, hide: () => setOpen(null) };
}

/** The photo input of "Use my photo" (the picture never leaves the device). */
export function useOwnPhotoInput(onFile: (file: File | undefined) => void) {
  const input = useRef<HTMLInputElement>(null);
  const element = (
    <input
      ref={input}
      type="file"
      accept="image/*"
      className="sr-only"
      tabIndex={-1}
      aria-hidden="true"
      onChange={(event) => {
        onFile(event.target.files?.[0]);
        event.target.value = '';
      }}
    />
  );
  return { open: () => input.current?.click(), element };
}
