// Shared "Save to Photos" experience for every image/GIF export in the app.
//
// A single provider renders ONE preview/share sheet. Any surface calls
// `useSaveMedia().save({ blob, filename })` after generating media and the sheet
// shows the ACTUAL image/GIF plus the clearest save path for the platform:
//  • Touch / iOS  → "Save to Photos" (native share, file only) with guidance to
//    choose "Save Image", plus a full-screen long-press fallback.
//  • Desktop      → a standard "Save Image" / "Save GIF" download, with Share
//    offered when the browser supports sharing files.

import {
  ReactNode,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { Download, ExternalLink, Image as ImageIcon, Share2, X } from 'lucide-react';
import {
  canShareFile,
  downloadBlob,
  isGif,
  isIOS,
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
}

interface SaveMediaContextValue {
  save: (media: SaveMediaInput) => void;
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
}

export function SaveMediaProvider({ children }: { children: ReactNode }) {
  const [active, setActive] = useState<ActiveMedia | null>(null);

  const save = useCallback((media: SaveMediaInput) => {
    const mime = media.mime ?? mimeForFilename(media.filename);
    const url = URL.createObjectURL(media.blob);
    setActive({ ...media, mime, url });
  }, []);

  const close = useCallback(() => {
    setActive((cur) => {
      if (cur) URL.revokeObjectURL(cur.url);
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

  const value = useMemo(() => ({ save }), [save]);

  return (
    <SaveMediaContext.Provider value={value}>
      {children}
      {active && <SaveMediaSheet media={active} onClose={close} />}
    </SaveMediaContext.Provider>
  );
}

function SaveMediaSheet({ media, onClose }: { media: ActiveMedia; onClose: () => void }) {
  const [fullscreen, setFullscreen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sharing, setSharing] = useState(false);

  const gif = isGif(media.mime);
  const noun = gif ? 'GIF' : 'Image';
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
      setError('Could not open the share sheet. Try “Open” and long-press to save.');
    }
    // 'cancelled' → leave the sheet open so the user can retry.
  }, [file, onClose]);

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
          <p className="text-sm font-medium text-white/90">Save to Photos</p>
          <button
            onClick={onClose}
            className="flex h-9 w-9 items-center justify-center rounded-full bg-white/15 text-white active:scale-95"
            aria-label="Close preview"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="flex flex-1 items-center justify-center overflow-auto px-3">
          <img
            src={media.url}
            alt={`${noun} to save`}
            className="max-h-full max-w-full select-auto object-contain"
            style={{ WebkitTouchCallout: 'default' } as React.CSSProperties}
          />
        </div>
        <div className="space-y-1 px-5 pb-[calc(env(safe-area-inset-bottom)+16px)] pt-3 text-center">
          <p className="text-sm text-white/90">
            Press and hold the {noun.toLowerCase()}, then choose Save to Photos.
          </p>
          <p className="text-xs text-white/60" dir="rtl">
            יש ללחוץ לחיצה ארוכה על התמונה ואז לבחור שמירה בתמונות.
          </p>
        </div>
      </div>
    );
  }

  // ── Preview + actions sheet ────────────────────────────────────────────────
  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center sm:items-center">
      <button className="absolute inset-0 bg-black/60" aria-label="Dismiss" onClick={onClose} />
      <div className="relative z-10 w-full max-w-md rounded-t-2xl border-t border-border bg-card p-4 shadow-2xl sm:rounded-2xl sm:border">
        <div className="mb-3 flex items-center justify-between">
          <p className="text-sm font-semibold text-foreground">{media.title ?? `Save ${noun}`}</p>
          <button
            onClick={onClose}
            className="flex h-9 w-9 items-center justify-center rounded-full bg-secondary text-muted-foreground active:scale-95"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Actual media preview (renders animated GIFs too). */}
        <div className="mb-3 flex max-h-[42vh] items-center justify-center overflow-hidden rounded-lg bg-black/30">
          <img
            src={media.url}
            alt={`${noun} preview`}
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
              <ImageIcon className="h-4 w-4" /> Save to Photos
            </button>
            <p className="mt-1.5 text-center text-[11px] text-muted-foreground">
              In the next screen, choose Save {noun}.
            </p>
            <p className="text-center text-[11px] text-muted-foreground" dir="rtl">
              במסך הבא יש לבחור שמירת התמונה.
            </p>
          </>
        ) : (
          <button
            onClick={() => runDownload(true)}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-3 py-3 text-sm font-semibold text-primary-foreground active:scale-95"
          >
            <Download className="h-4 w-4" /> Save {noun}
          </button>
        )}

        {/* Secondary actions */}
        <div className="mt-2 flex gap-2">
          <button
            onClick={() => setFullscreen(true)}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-secondary px-3 py-2.5 text-sm font-medium text-foreground active:scale-95"
          >
            <ExternalLink className="h-4 w-4" /> Open {noun}
          </button>
          {canShare && !preferShare && (
            <button
              onClick={runShare}
              disabled={sharing}
              className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-secondary px-3 py-2.5 text-sm font-medium text-foreground active:scale-95 disabled:opacity-60"
            >
              <Share2 className="h-4 w-4" /> Share
            </button>
          )}
          {preferShare && (
            <button
              onClick={() => runDownload(false)}
              className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-secondary px-3 py-2.5 text-sm font-medium text-foreground active:scale-95"
            >
              <Download className="h-4 w-4" /> Save file
            </button>
          )}
        </div>

        {error && <p className="mt-2 text-center text-[11px] text-destructive">{error}</p>}
      </div>
    </div>
  );
}
