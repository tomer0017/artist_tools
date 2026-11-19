// Shared "Save to Photos" experience for every image/GIF export in the app.
//
// A single provider renders ONE preview/share sheet. Any surface calls
// `useSaveMedia().save({ blob, filename, tool })` after generating media.
// Every save is authorized by the server first (src/app/api/usage/route.ts):
// the tool it comes from must still be included in the account's plan, and
// saving an image or a GIF must be too (each save is counted). Only a yes
// opens the sheet; a refusal, or no answer at all, saves nothing and says why
// (fail closed). The sheet then shows the ACTUAL image/GIF plus the clearest
// save path for the platform:
//  • Touch / iOS  → "Save to Photos" (native share, file only) with guidance to
//    choose "Save Image", plus a full-screen long-press fallback.
//  • Desktop      → a standard "Save Image" / "Save GIF" download, with Share
//    offered when the browser supports sharing files.
// A PDF (authorized as `export.pdf`) is shown as a picture of its pages: it is
// saved, shared (on phones, the share sheet also prints), or opened in a new
// tab to print, with a reminder to print at 100 %.

import {
  ReactNode,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import Link from 'next/link';
import { Download, ExternalLink, Image as ImageIcon, Lock, Printer, Share2, X } from 'lucide-react';
import { useLocale, useTranslations } from 'use-intl';
import { useAccount } from '@/components/shell/account';
import { pathForView } from '@/components/shell/tools';
import type { ToolId } from '@/lib/account';
import { authorizeUse, type FeatureDecision } from '@/lib/features-client';
import { TOOL_FEATURES, isToolFeature, type ExportFeatureId, type FeatureId } from '@/lib/plans';
import {
  canShareFile,
  downloadBlob,
  isGif,
  isIOS,
  isPdf,
  isTouchDevice,
  makeShareFile,
  mimeForFilename,
  shareFile,
} from '@/lib/saveMedia';

export interface SaveMediaInput {
  blob: Blob;
  /** Filename WITH extension (drives MIME + the saved file's name). */
  filename: string;
  /** Optional explicit MIME; inferred from the filename otherwise. */
  mime?: string;
  /** Optional heading shown on the sheet. */
  title?: string;
  /** The tool it comes from: its plan must still include that tool. */
  tool: ToolId;
  /** Export features beyond the image or GIF itself (a large GIF…), authorized with it. */
  features?: ExportFeatureId[];
  /**
   * The server already authorized (and counted) this very export, just before
   * the work of making it (a GIF, a PDF): it is not asked twice.
   */
  authorized?: boolean;
  /** For a file the sheet cannot show itself (a PDF): a picture of it. */
  preview?: Blob;
}

/** A protected operation of a tool: the tool, and what it exports (none, e.g. a project file). */
export interface ToolUse {
  tool: ToolId;
  features: ExportFeatureId[];
}

interface SaveMediaContextValue {
  /** Authorize with the server, then show the save sheet; resolves whether it was allowed. */
  save: (media: SaveMediaInput) => Promise<boolean>;
  /** Authorize a protected operation with the server; on a refusal (or no answer) explain why. Resolves whether it may go ahead. */
  authorize: (use: ToolUse) => Promise<boolean>;
}

/** Why something was not saved, as the sheet explains it. */
interface Refusal {
  decision: FeatureDecision;
  use: ToolUse;
  /** For "Try again" after no answer. */
  retry: (() => void) | null;
}

const SaveMediaContext = createContext<SaveMediaContextValue | null>(null);

export function useSaveMedia(): SaveMediaContextValue {
  const ctx = useContext(SaveMediaContext);
  if (!ctx) throw new Error('useSaveMedia must be used inside <SaveMediaProvider>');
  return ctx;
}

interface ActiveMedia extends SaveMediaInput {
  mime: string;
  url: string;
  /** The picture shown for it (the media itself, or its preview). */
  previewUrl: string;
}

export function SaveMediaProvider({ children }: { children: ReactNode }) {
  const [active, setActive] = useState<ActiveMedia | null>(null);
  const [refusal, setRefusal] = useState<Refusal | null>(null);
  const refresh = useAccount()?.refresh;

  const ask = useCallback(
    async (use: ToolUse, retry: (() => void) | null): Promise<boolean> => {
      const decision = await authorizeUse({ tool: TOOL_FEATURES[use.tool], features: use.features });
      if (decision.access === 'ok') return true;
      // Signed out: already on the way to sign in.
      if (decision.access !== 'signed_out') setRefusal({ decision, use, retry: decision.access === 'unavailable' ? retry : null });
      // The plan changed: bring the studio's copy up to date (a tool no longer included locks).
      if (decision.access === 'locked') void refresh?.();
      return false;
    },
    [refresh],
  );

  const authorize = useCallback((use: ToolUse) => ask(use, null), [ask]);

  const save = useCallback(
    async (media: SaveMediaInput): Promise<boolean> => {
      const mime = media.mime ?? mimeForFilename(media.filename);
      if (!media.authorized) {
        const use: ToolUse = { tool: media.tool, features: [isGif(mime) ? 'export.gif' : isPdf(mime) ? 'export.pdf' : 'export.image', ...(media.features ?? [])] };
        if (!(await ask(use, () => void save(media)))) return false;
      }
      const url = URL.createObjectURL(media.blob);
      setActive({ ...media, mime, url, previewUrl: media.preview ? URL.createObjectURL(media.preview) : url });
      return true;
    },
    [ask],
  );

  const close = useCallback(() => {
    setActive((cur) => {
      if (cur) URL.revokeObjectURL(cur.url);
      if (cur && cur.previewUrl !== cur.url) URL.revokeObjectURL(cur.previewUrl);
      return null;
    });
  }, []);

  // Safety net: revoke on unmount if a sheet is still open.
  useEffect(() => {
    return () => {
      if (active) URL.revokeObjectURL(active.url);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const value = useMemo(() => ({ save, authorize }), [save, authorize]);

  return (
    <SaveMediaContext.Provider value={value}>
      {children}
      {active && (isPdf(active.mime) ? <PdfSheet media={active} onClose={close} /> : <SaveMediaSheet media={active} onClose={close} />)}
      {refusal && <RefusalSheet refusal={refusal} onClose={() => setRefusal(null)} />}
    </SaveMediaContext.Provider>
  );
}

/** A feature's name in the page language, as the account page shows it. */
function useFeatureName() {
  const t = useTranslations();
  return (feature: FeatureId): string => {
    switch (feature) {
      case 'export.image':
        return t('account.features.exportImage');
      case 'export.gif':
        return t('account.features.exportGif');
      case 'export.gif_large':
        return t('account.features.exportGifLarge');
      case 'export.gif_difference':
        return t('account.features.exportGifDifference');
      case 'export.worksheets':
        return t('account.features.exportWorksheets');
      case 'learn.curriculum':
        return t('account.features.learnCurriculum');
      case 'learn.color':
        return t('account.features.learnColor');
      case 'learn.challenges':
        return t('account.features.learnChallenges');
      case 'export.pdf':
        return t('account.features.exportPdf');
      case 'tool.measure':
        return t('tools.measure.title');
      case 'tool.study':
        return t('tools.value.title');
      case 'tool.color':
        return t('tools.color.title');
      case 'tool.grid':
        return t('tools.grid.title');
      case 'tool.compare':
        return t('tools.compare.title');
    }
  };
}

/** Nothing was saved: the plan does not include it, its limit is used up, or the server could not be asked. */
function RefusalSheet({ refusal, onClose }: { refusal: Refusal; onClose: () => void }) {
  const t = useTranslations('toolsCommon.access');
  const name = useFeatureName();
  const { decision, use, retry } = refusal;
  // What the server named; the tool first (if it is the tool, nothing of it can be saved now).
  const tool = decision.missing.find(isToolFeature) ?? null;
  const feature = decision.missing.find((f) => !isToolFeature(f)) ?? use.features[0] ?? 'export.image';
  const content =
    decision.access === 'unavailable'
      ? { title: t('unavailableTitle'), body: t('unavailableBody') }
      : decision.access === 'limit'
        ? { title: t('limitTitle'), body: t('limitBody', { feature: name(feature) }) }
        : tool
          ? { title: t('lockedTitle'), body: t('lockedTool', { tool: name(tool) }) }
          : { title: t('lockedTitle'), body: t('lockedExport', { feature: name(feature) }) };
  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center sm:items-center">
      <button className="absolute inset-0 bg-black/60" aria-label={t('close')} onClick={onClose} />
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="save-refused-title"
        aria-describedby="save-refused-body"
        data-save-refused={decision.access}
        className="relative z-10 w-full max-w-md rounded-t-2xl border-t border-border bg-card p-5 pb-[calc(env(safe-area-inset-bottom)+20px)] shadow-2xl sm:rounded-2xl sm:border sm:pb-5"
      >
        <div className="flex items-start gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-secondary text-foreground">
            <Lock className="h-4 w-4" aria-hidden="true" />
          </span>
          <div className="min-w-0 flex-1">
            <p id="save-refused-title" className="text-base font-semibold text-foreground">{content.title}</p>
            <p id="save-refused-body" className="mt-1 text-sm leading-relaxed text-muted-foreground">{content.body}</p>
          </div>
        </div>
        <div className="mt-4 flex flex-col gap-2 sm:flex-row-reverse">
          {retry ? (
            <button
              type="button"
              autoFocus
              onClick={() => {
                onClose();
                retry();
              }}
              className="flex h-11 flex-1 items-center justify-center rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground active:scale-95"
            >
              {t('tryAgain')}
            </button>
          ) : decision.access !== 'unavailable' ? (
            <Link
              href={pathForView('plans')}
              onClick={onClose}
              className="flex h-11 flex-1 items-center justify-center rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground active:scale-95"
            >
              {t('comparePlans')}
            </Link>
          ) : null}
          <button
            type="button"
            autoFocus={!retry}
            onClick={onClose}
            className="flex h-11 flex-1 items-center justify-center rounded-xl bg-secondary px-4 text-sm font-medium text-foreground active:scale-95"
          >
            {t('close')}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * A PDF: a picture of its pages, then save it (download), share it (on phones
 * and tablets the share sheet also prints and saves to Files), or open it in a
 * new tab to print from the browser's viewer. Printing at 100 % keeps it to
 * scale; the bar on each page shows whether it was.
 */
function PdfSheet({ media, onClose }: { media: ActiveMedia; onClose: () => void }) {
  const t = useTranslations('toolsCommon.save');
  const [error, setError] = useState<string | null>(null);
  const [sharing, setSharing] = useState(false);
  const file = useMemo(() => makeShareFile(media.blob, media.filename, media.mime), [media.blob, media.filename, media.mime]);
  const canShare = useMemo(() => canShareFile(file), [file]);
  const preferShare = canShare && (isIOS() || isTouchDevice());

  const runShare = useCallback(async () => {
    setError(null);
    setSharing(true);
    const result = await shareFile(file);
    setSharing(false);
    if (result === 'shared') onClose();
    else if (result === 'error' || result === 'unsupported') setError(t('pdfShareFailed'));
  }, [file, onClose, t]);
  const runDownload = useCallback(() => {
    downloadBlob(media.blob, media.filename);
    onClose();
  }, [media.blob, media.filename, onClose]);
  // The browser's own PDF viewer, in a new tab: it prints at actual size when asked.
  const openToPrint = useCallback(() => {
    window.open(media.url, '_blank', 'noopener');
  }, [media.url]);

  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center sm:items-center">
      <button className="absolute inset-0 bg-black/60" aria-label={t('dismiss')} onClick={onClose} />
      <div role="dialog" aria-modal="true" aria-labelledby="save-pdf-title" className="relative z-10 w-full max-w-md rounded-t-2xl border-t border-border bg-card p-4 pb-[calc(env(safe-area-inset-bottom)+16px)] shadow-2xl sm:rounded-2xl sm:border sm:pb-4">
        <div className="mb-3 flex items-center justify-between">
          <p id="save-pdf-title" className="text-sm font-semibold text-foreground">{media.title ?? t('pdfTitle')}</p>
          <button onClick={onClose} className="flex h-9 w-9 items-center justify-center rounded-full bg-secondary text-muted-foreground active:scale-95" aria-label={t('close')}>
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
        <div className="mb-3 flex max-h-[38vh] items-center justify-center overflow-hidden rounded-lg bg-black/30 p-2">
          <img src={media.previewUrl} alt={t('pdfPreviewAlt')} className="max-h-[36vh] w-auto max-w-full object-contain" />
        </div>
        <p className="mb-3 text-center text-xs text-muted-foreground">{t('printHint')}</p>
        {preferShare ? (
          <>
            <button onClick={runShare} disabled={sharing} className="flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-3 py-3 text-sm font-semibold text-primary-foreground active:scale-95 disabled:opacity-60">
              <Share2 className="h-4 w-4" aria-hidden="true" /> {t('sharePdf')}
            </button>
            <p className="mt-1.5 text-center text-[11px] text-muted-foreground">{t('pdfNextScreen')}</p>
          </>
        ) : (
          <button onClick={runDownload} className="flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-3 py-3 text-sm font-semibold text-primary-foreground active:scale-95">
            <Download className="h-4 w-4" aria-hidden="true" /> {t('savePdf')}
          </button>
        )}
        <div className="mt-2 flex gap-2">
          <button onClick={openToPrint} className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-secondary px-3 py-2.5 text-sm font-medium text-foreground active:scale-95">
            <Printer className="h-4 w-4" aria-hidden="true" /> {t('openPdf')}
          </button>
          {canShare && !preferShare && (
            <button onClick={runShare} disabled={sharing} className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-secondary px-3 py-2.5 text-sm font-medium text-foreground active:scale-95 disabled:opacity-60">
              <Share2 className="h-4 w-4" aria-hidden="true" /> {t('share')}
            </button>
          )}
          {preferShare && (
            <button onClick={runDownload} className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-secondary px-3 py-2.5 text-sm font-medium text-foreground active:scale-95">
              <Download className="h-4 w-4" aria-hidden="true" /> {t('saveFile')}
            </button>
          )}
        </div>
        {error && <p className="mt-2 text-center text-[11px] text-destructive">{error}</p>}
      </div>
    </div>
  );
}

function SaveMediaSheet({ media, onClose }: { media: ActiveMedia; onClose: () => void }) {
  const t = useTranslations('toolsCommon.save');
  // The small Hebrew hints under the English instructions are for English pages; Hebrew pages say it all in Hebrew.
  const english = useLocale() === 'en';
  const [fullscreen, setFullscreen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sharing, setSharing] = useState(false);

  const gif = isGif(media.mime);
  const kind = gif ? 'gif' : 'image';
  const file = useMemo(
    () => makeShareFile(media.blob, media.filename, media.mime),
    [media.blob, media.filename, media.mime],
  );
  const canShare = useMemo(() => canShareFile(file), [file]);
  const preferShare = canShare && (isIOS() || isTouchDevice());

  const runShare = useCallback(async () => {
    setError(null);
    setSharing(true);
    const result = await shareFile(file);
    setSharing(false);
    if (result === 'shared') {
      onClose();
    } else if (result === 'unsupported') {
      setFullscreen(true);
    } else if (result === 'error') {
      setError(t('shareFailed'));
    }
    // 'cancelled' → leave the sheet open so the user can retry.
  }, [file, onClose, t]);

  const runDownload = useCallback(
    (thenClose = false) => {
      downloadBlob(media.blob, media.filename);
      if (thenClose) onClose();
    },
    [media.blob, media.filename, onClose],
  );

  // ── Full-screen long-press fallback ────────────────────────────────────────
  if (fullscreen) {
    return (
      <div className="fixed inset-0 z-[60] flex flex-col bg-black">
        <div className="flex items-center justify-between px-4 py-3">
          <p className="text-sm font-medium text-white/90">{t('toPhotos')}</p>
          <button
            onClick={onClose}
            className="flex h-9 w-9 items-center justify-center rounded-full bg-white/15 text-white active:scale-95"
            aria-label={t('closePreview')}
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="flex flex-1 items-center justify-center overflow-auto px-3">
          <img
            src={media.url}
            alt={t('toSaveAlt', { kind })}
            className="max-h-full max-w-full select-auto object-contain"
            style={{ WebkitTouchCallout: 'default' } as React.CSSProperties}
          />
        </div>
        <div className="space-y-1 px-5 pb-[calc(env(safe-area-inset-bottom)+16px)] pt-3 text-center">
          <p className="text-sm text-white/90">{t('pressAndHold', { kind })}</p>
          {english && (
            <p className="text-xs text-white/60" dir="rtl">
              יש ללחוץ לחיצה ארוכה על התמונה ואז לבחור שמירה בתמונות.
            </p>
          )}
        </div>
      </div>
    );
  }

  // ── Preview + actions sheet ────────────────────────────────────────────────
  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center sm:items-center">
      <button className="absolute inset-0 bg-black/60" aria-label={t('dismiss')} onClick={onClose} />
      <div className="relative z-10 w-full max-w-md rounded-t-2xl border-t border-border bg-card p-4 shadow-2xl sm:rounded-2xl sm:border">
        <div className="mb-3 flex items-center justify-between">
          <p className="text-sm font-semibold text-foreground">{media.title ?? t('title', { kind })}</p>
          <button
            onClick={onClose}
            className="flex h-9 w-9 items-center justify-center rounded-full bg-secondary text-muted-foreground active:scale-95"
            aria-label={t('close')}
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Actual media preview (renders animated GIFs too). */}
        <div className="mb-3 flex max-h-[42vh] items-center justify-center overflow-hidden rounded-lg bg-black/30">
          <img
            src={media.url}
            alt={t('previewAlt', { kind })}
            className="max-h-[42vh] w-auto max-w-full object-contain"
            style={{ WebkitTouchCallout: 'default' } as React.CSSProperties}
          />
        </div>

        {/* Primary action */}
        {preferShare ? (
          <>
            <button
              onClick={runShare}
              disabled={sharing}
              className="flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-3 py-3 text-sm font-semibold text-primary-foreground active:scale-95 disabled:opacity-60"
            >
              <ImageIcon className="h-4 w-4" /> {t('toPhotos')}
            </button>
            <p className="mt-1.5 text-center text-[11px] text-muted-foreground">{t('nextScreen', { kind })}</p>
            {english && (
              <p className="text-center text-[11px] text-muted-foreground" dir="rtl">
                במסך הבא יש לבחור שמירת התמונה.
              </p>
            )}
          </>
        ) : (
          <button
            onClick={() => runDownload(true)}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-3 py-3 text-sm font-semibold text-primary-foreground active:scale-95"
          >
            <Download className="h-4 w-4" /> {t('saveKind', { kind })}
          </button>
        )}

        {/* Secondary actions */}
        <div className="mt-2 flex gap-2">
          <button
            onClick={() => setFullscreen(true)}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-secondary px-3 py-2.5 text-sm font-medium text-foreground active:scale-95"
          >
            <ExternalLink className="h-4 w-4" /> {t('open', { kind })}
          </button>
          {canShare && !preferShare && (
            <button
              onClick={runShare}
              disabled={sharing}
              className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-secondary px-3 py-2.5 text-sm font-medium text-foreground active:scale-95 disabled:opacity-60"
            >
              <Share2 className="h-4 w-4" /> {t('share')}
            </button>
          )}
          {preferShare && (
            <button
              onClick={() => runDownload(false)}
              className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-secondary px-3 py-2.5 text-sm font-medium text-foreground active:scale-95"
            >
              <Download className="h-4 w-4" /> {t('saveFile')}
            </button>
          )}
        </div>

        {error && <p className="mt-2 text-center text-[11px] text-destructive">{error}</p>}
      </div>
    </div>
  );
}
