import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslations } from 'use-intl';
import { Download, Loader2, Share2, X } from 'lucide-react';
import type { GridSettings } from '@/types/project';
import type { SketchControls } from '@/lib/sketch/styles';
import { useSaveMedia } from '@/components/common/SaveMedia';
import { canShareFiles, downloadBlob, isIOS, isTouchDevice, makeShareFile, shareFiles } from '@/lib/saveMedia';
import {
  CHOICES_KEY,
  SHEET_ORDER,
  VALUE_LEVELS,
  orderedSheets,
  otherToolNeeded,
  readChoices,
  type SheetKind,
  type WorksheetChoices,
} from '@/lib/worksheets/sheets';
import { makeWorksheets, type WorksheetSheet } from '@/lib/worksheets/browser';

// Prepare Worksheets (Learn plan M3): practice sheets from the photo open in
// Create a Grid or Study & Simplify, saved as PNG images that line up (same
// size, same crop). The server is asked first, for both tools whose work the
// sheets are and for Worksheets and Saved images; no answer makes nothing.
// The choice of sheets is remembered on this device; the photo is not stored.

interface Props {
  /** The tool it was opened from. */
  from: 'grid' | 'value';
  /** The photo (it stays on this device). */
  image: string;
  /** Canvas, grid and framing: Create a Grid's settings. */
  settings: GridSettings;
  /** The photo is not Create a Grid's: it was fitted to the canvas. */
  fitted?: boolean;
  /** Clean Outline's controls, as set in Study & Simplify. */
  outline: SketchControls;
  onClose: () => void;
}

function rememberedChoices(): WorksheetChoices {
  try {
    return readChoices(JSON.parse(localStorage.getItem(CHOICES_KEY) ?? 'null'));
  } catch {
    return readChoices(null);
  }
}

type Made = { sheet: WorksheetSheet; thumbnail: string };

/** Between the downloads of Save all (see saveAll). */
const DOWNLOAD_SPACING_MS = 400;

export default function PrepareWorksheets({ from, image, settings, fitted = false, outline, onClose }: Props) {
  const t = useTranslations('worksheets');
  const { authorize } = useSaveMedia();
  const [choices, setChoices] = useState<WorksheetChoices>(rememberedChoices);
  const [phase, setPhase] = useState<'choose' | 'making' | 'done'>('choose');
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [made, setMade] = useState<Made[]>([]);
  const [error, setError] = useState<string | null>(null);
  const stop = useRef<AbortController | null>(null);
  const dialog = useRef<HTMLDivElement>(null);

  useEffect(() => {
    try {
      localStorage.setItem(CHOICES_KEY, JSON.stringify(choices));
    } catch {
      /* private browsing: the choices are simply not remembered */
    }
  }, [choices]);
  // The latest onClose, so the effect below runs once: on opening (focus) and closing (stop).
  const close = useRef(onClose);
  useEffect(() => {
    close.current = onClose;
  }, [onClose]);
  useEffect(() => {
    dialog.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close.current();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      // Closed while making: stop between sheets.
      stop.current?.abort();
    };
  }, []);
  useEffect(() => () => made.forEach((m) => URL.revokeObjectURL(m.thumbnail)), [made]);

  const chosen = orderedSheets(choices.sheets);
  const name = (kind: SheetKind) => t(`sheets.${kind}.name`);
  const grid =
    settings.cellMode === 'square'
      ? t('gridSquares', { size: `${settings.cellSize}`, unit: settings.unit })
      : t('gridDivisions', { columns: `${settings.columns}`, rows: `${settings.rows}` });
  const hint = (kind: SheetKind) =>
    kind === 'grid'
      ? t('sheets.grid.hint', { grid, width: `${settings.canvasWidth}`, height: `${settings.canvasHeight}`, unit: settings.unit })
      : t(`sheets.${kind}.hint`);
  const toggle = (kind: SheetKind) =>
    setChoices((c) => ({ ...c, sheets: c.sheets.includes(kind) ? c.sheets.filter((k) => k !== kind) : orderedSheets([...c.sheets, kind]) }));

  const make = useCallback(async () => {
    if (chosen.length === 0 || phase !== 'choose') return;
    setError(null);
    // The other tool whose work the sheets are is checked alone (nothing is
    // counted); then this tool with Worksheets and Saved images (counted).
    const other = otherToolNeeded(from, chosen);
    if (other && !(await authorize({ tool: other, features: [] }))) return;
    if (!(await authorize({ tool: from, features: ['export.worksheets', 'export.image'] }))) return;
    const controller = new AbortController();
    stop.current = controller;
    setProgress({ done: 0, total: chosen.length });
    setPhase('making');
    try {
      const sheets = await makeWorksheets(image, {
        gs: settings,
        sheets: chosen,
        levels: choices.levels,
        outline,
        signal: controller.signal,
        onProgress: (done, total) => setProgress({ done, total }),
      });
      if (controller.signal.aborted) return;
      setMade(sheets.map((sheet) => ({ sheet, thumbnail: URL.createObjectURL(sheet.thumbnail) })));
      setPhase('done');
    } catch (err) {
      if (controller.signal.aborted) return;
      console.error('[Worksheets] The sheets could not be made:', err);
      setError(t('failed'));
      setPhase('choose');
    }
  }, [authorize, chosen, choices.levels, from, image, outline, phase, settings, t]);

  const files = useMemo(() => made.map(({ sheet }) => makeShareFile(sheet.blob, sheet.filename, 'image/png')), [made]);
  // Phones and tablets: one share sheet for all (Save Images, Save to Files, Print).
  const preferShare = useMemo(() => canShareFiles(files) && (isIOS() || isTouchDevice()), [files]);
  const share = async (which: File[]) => {
    setError(null);
    const result = await shareFiles(which);
    if (result === 'error' || result === 'unsupported') setError(t('shareFailed'));
  };
  // WebKit (Safari) keeps only the last of several downloads started at once: they go 400 ms apart.
  const saveAll = () =>
    made.forEach(({ sheet }, index) => {
      if (index === 0) downloadBlob(sheet.blob, sheet.filename);
      else window.setTimeout(() => downloadBlob(sheet.blob, sheet.filename), index * DOWNLOAD_SPACING_MS);
    });
  const saveOne = (index: number) => {
    if (preferShare) void share([files[index]]);
    else downloadBlob(made[index].sheet.blob, made[index].sheet.filename);
  };
  const again = () => {
    setMade([]);
    setError(null);
    setPhase('choose');
  };

  const secondary = 'flex min-h-[44px] flex-1 items-center justify-center gap-1.5 rounded-xl bg-secondary px-3 text-sm font-medium text-foreground active:scale-95';
  const primary = 'flex min-h-[48px] w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground active:scale-95 disabled:opacity-50';

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center">
      <button className="absolute inset-0 bg-black/60" aria-label={t('close')} tabIndex={-1} onClick={onClose} />
      <div
        ref={dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby="worksheets-title"
        tabIndex={-1}
        data-worksheets={phase}
        className="relative z-10 flex max-h-[92dvh] w-full max-w-md flex-col rounded-t-2xl border-t border-border bg-card shadow-2xl outline-none sm:rounded-2xl sm:border"
      >
        <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
          <h2 id="worksheets-title" className="text-base font-semibold text-foreground">{t('title')}</h2>
          <button onClick={onClose} aria-label={t('close')} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-secondary text-muted-foreground active:scale-95">
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
          {phase === 'choose' && (
            <>
              <p className="text-sm text-muted-foreground">{t('lead')}</p>
              <fieldset className="mt-3">
                <legend className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">{t('sheetsLabel')}</legend>
                <ul className="space-y-2">
                  {SHEET_ORDER.map((kind) => {
                    const on = choices.sheets.includes(kind);
                    return (
                      <li key={kind}>
                        <label className={`flex min-h-[52px] cursor-pointer items-start gap-3 rounded-xl border px-3 py-2.5 ${on ? 'border-primary/60 bg-primary/5' : 'border-border bg-secondary/30'}`}>
                          <input type="checkbox" checked={on} onChange={() => toggle(kind)} className="mt-0.5 h-5 w-5 shrink-0 accent-primary" />
                          <span className="min-w-0">
                            <span className="block text-sm font-medium text-foreground">{name(kind)}</span>
                            <span className="block text-xs text-muted-foreground">{hint(kind)}</span>
                          </span>
                        </label>
                        {kind === 'values' && on && (
                          <fieldset className="mt-2 ps-11">
                            <legend className="sr-only">{t('levelsLabel')}</legend>
                            <div className="flex gap-2">
                              {VALUE_LEVELS.map((count) => (
                                <label
                                  key={count}
                                  className={`flex min-h-[40px] flex-1 cursor-pointer items-center justify-center rounded-lg border text-sm font-medium ${
                                    choices.levels === count ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-secondary/40 text-foreground'
                                  }`}
                                >
                                  <input
                                    type="radio"
                                    name="worksheet-levels"
                                    value={count}
                                    checked={choices.levels === count}
                                    onChange={() => setChoices((c) => ({ ...c, levels: count }))}
                                    className="sr-only"
                                  />
                                  {t('levels', { count: `${count}` })}
                                </label>
                              ))}
                            </div>
                          </fieldset>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </fieldset>
              <p className="mt-3 text-xs text-muted-foreground">{fitted ? t('framingFitted') : t('framing')}</p>
            </>
          )}

          {phase === 'making' && (
            <div role="status" aria-live="polite" className="flex flex-col items-center gap-3 py-12 text-sm text-foreground">
              <Loader2 className="h-6 w-6 animate-spin" aria-hidden="true" />
              {t('making', { current: `${Math.min(progress.done + 1, progress.total)}`, total: `${progress.total}` })}
            </div>
          )}

          {phase === 'done' && (
            <>
              <p role="status" className="text-sm font-medium text-foreground">{t('ready', { count: `${made.length}` })}</p>
              <ul className="mt-3 grid grid-cols-2 gap-3">
                {made.map(({ sheet, thumbnail }, index) => (
                  <li key={sheet.filename} className="flex flex-col gap-1.5 rounded-xl border border-border bg-secondary/30 p-2">
                    {/* eslint-disable-next-line @next/next/no-img-element -- a picture made on this device (blob URL) */}
                    <img src={thumbnail} alt={t('preview', { number: `${index + 1}`, name: name(sheet.kind) })} className="max-h-40 w-full rounded-md bg-white object-contain" />
                    <div className="flex items-center justify-between gap-2">
                      <span className="min-w-0 truncate text-xs text-foreground" aria-hidden="true">
                        {index + 1}. {name(sheet.kind)}
                      </span>
                      <button
                        onClick={() => saveOne(index)}
                        aria-label={t('saveOne', { name: name(sheet.kind) })}
                        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-secondary text-foreground active:scale-95"
                      >
                        {preferShare ? <Share2 className="h-4 w-4" aria-hidden="true" /> : <Download className="h-4 w-4" aria-hidden="true" />}
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
              {preferShare && <p className="mt-3 text-center text-xs text-muted-foreground">{t('shareHint')}</p>}
            </>
          )}
          {error && (
            <p role="alert" className="mt-3 text-sm text-destructive">
              {error}
            </p>
          )}
        </div>

        <div className="space-y-2 border-t border-border px-4 pb-[calc(env(safe-area-inset-bottom)+12px)] pt-3">
          {phase === 'choose' && (
            <button onClick={() => void make()} disabled={chosen.length === 0} className={primary}>
              {t('make', { count: `${chosen.length}` })}
            </button>
          )}
          {phase === 'making' && (
            <button disabled aria-busy="true" className={primary}>
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              {t('make', { count: `${progress.total}` })}
            </button>
          )}
          {phase === 'done' && (
            <>
              {preferShare ? (
                <button onClick={() => void share(files)} className={primary}>
                  <Share2 className="h-4 w-4" aria-hidden="true" /> {t('shareAll')}
                </button>
              ) : (
                <button onClick={saveAll} className={primary}>
                  <Download className="h-4 w-4" aria-hidden="true" /> {t('saveAll')}
                </button>
              )}
              <div className="flex gap-2">
                {preferShare && (
                  <button onClick={saveAll} className={secondary}>
                    <Download className="h-4 w-4" aria-hidden="true" /> {t('saveFiles')}
                  </button>
                )}
                <button onClick={again} className={secondary}>
                  {t('again')}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
