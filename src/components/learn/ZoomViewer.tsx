import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslations } from 'use-intl';
import { Maximize2, Minus, Plus, X } from 'lucide-react';

// A reference full screen (S3: "tap for full screen and zoom"): pinch, scroll
// or double-tap to zoom, drag to move, buttons and keys for the same. The
// image is the one the card already shows (the same authorized address).

const MAX_SCALE = 6;
const clampScale = (s: number) => Math.min(MAX_SCALE, Math.max(1, s));

type View = { scale: number; x: number; y: number };
const FIT: View = { scale: 1, x: 0, y: 0 };

export default function ZoomViewer({ src, alt, onClose }: { src: string; alt: string; onClose: () => void }) {
  const t = useTranslations('learn.zoom');
  const [view, setView] = useState<View>(FIT);
  const stage = useRef<HTMLDivElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ distance: number; view: View; mid: { x: number; y: number } } | null>(null);

  /** A point on screen, relative to the stage's centre. */
  const local = useCallback((clientX: number, clientY: number) => {
    const box = stage.current?.getBoundingClientRect();
    return box ? { x: clientX - box.left - box.width / 2, y: clientY - box.top - box.height / 2 } : { x: 0, y: 0 };
  }, []);

  /** Keep the picture on screen: it may move only as far as it is larger than the stage. */
  const bound = useCallback((next: View): View => {
    const box = stage.current?.getBoundingClientRect();
    if (!box || next.scale <= 1) return FIT;
    const limitX = ((next.scale - 1) * box.width) / 2;
    const limitY = ((next.scale - 1) * box.height) / 2;
    return { scale: next.scale, x: Math.max(-limitX, Math.min(limitX, next.x)), y: Math.max(-limitY, Math.min(limitY, next.y)) };
  }, []);

  /** Zoom to `scale`, keeping the point `at` (stage coordinates) where it is. */
  const zoomTo = useCallback(
    (scale: number, at = { x: 0, y: 0 }, from?: View) =>
      setView((current) => {
        const base = from ?? current;
        const s = clampScale(scale);
        return bound({ scale: s, x: at.x - ((at.x - base.x) * s) / base.scale, y: at.y - ((at.y - base.y) * s) / base.scale });
      }),
    [bound],
  );

  // Focus moves into the viewer when it opens and back where it was when it closes.
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    closeButton.current?.focus();
    return () => previous?.focus?.();
  }, []);

  const scale = useRef(view.scale);
  scale.current = view.scale;
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
      else if (event.key === '+' || event.key === '=') zoomTo(scale.current * 1.5);
      else if (event.key === '-') zoomTo(scale.current / 1.5);
      else if (event.key === '0') setView(FIT);
      else if (event.key.startsWith('Arrow')) {
        const step = 60;
        const dx = event.key === 'ArrowLeft' ? step : event.key === 'ArrowRight' ? -step : 0;
        const dy = event.key === 'ArrowUp' ? step : event.key === 'ArrowDown' ? -step : 0;
        setView((v) => bound({ ...v, x: v.x + dx, y: v.y + dy }));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [bound, onClose, zoomTo]);

  const onPointerDown = (event: React.PointerEvent) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      pinch.current = { distance: Math.hypot(a.x - b.x, a.y - b.y) || 1, view, mid: local((a.x + b.x) / 2, (a.y + b.y) / 2) };
    }
  };
  const onPointerMove = (event: React.PointerEvent) => {
    const last = pointers.current.get(event.pointerId);
    if (!last) return;
    const now = { x: event.clientX, y: event.clientY };
    pointers.current.set(event.pointerId, now);
    if (pointers.current.size >= 2 && pinch.current) {
      const [a, b] = [...pointers.current.values()];
      const start = pinch.current;
      zoomTo((start.view.scale * Math.hypot(a.x - b.x, a.y - b.y)) / start.distance, start.mid, start.view);
    } else if (pointers.current.size === 1) {
      setView((v) => bound({ ...v, x: v.x + now.x - last.x, y: v.y + now.y - last.y }));
    }
  };
  const onPointerUp = (event: React.PointerEvent) => {
    pointers.current.delete(event.pointerId);
    if (pointers.current.size < 2) pinch.current = null;
  };

  const iconButton =
    'flex h-11 w-11 items-center justify-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white';

  return (
    <div role="dialog" aria-modal="true" aria-label={t('title')} data-zoom-viewer className="fixed inset-0 z-[70] flex flex-col bg-black/95" style={{ paddingTop: 'env(safe-area-inset-top)' }}>
      <div className="flex items-center gap-2 px-3 py-2">
        <p className="min-w-0 flex-1 truncate text-sm text-white/80">{alt}</p>
        <button type="button" onClick={() => zoomTo(view.scale / 1.5)} aria-label={t('zoomOut')} className={iconButton} disabled={view.scale <= 1}>
          <Minus className="h-5 w-5" aria-hidden="true" />
        </button>
        <button type="button" onClick={() => zoomTo(view.scale * 1.5)} aria-label={t('zoomIn')} className={iconButton} disabled={view.scale >= MAX_SCALE}>
          <Plus className="h-5 w-5" aria-hidden="true" />
        </button>
        <button type="button" onClick={() => setView(FIT)} aria-label={t('reset')} className={iconButton}>
          <Maximize2 className="h-5 w-5" aria-hidden="true" />
        </button>
        <button ref={closeButton} type="button" onClick={onClose} aria-label={t('close')} className={iconButton}>
          <X className="h-5 w-5" aria-hidden="true" />
        </button>
      </div>
      <div
        ref={stage}
        className="relative flex min-h-0 flex-1 touch-none select-none items-center justify-center overflow-hidden"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onWheel={(event) => {
          const at = local(event.clientX, event.clientY);
          zoomTo(view.scale * Math.exp(-event.deltaY * 0.0025), at);
        }}
        onDoubleClick={(event) => (view.scale > 1 ? setView(FIT) : zoomTo(2.5, local(event.clientX, event.clientY)))}
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- a private image from the authorized Learn route */}
        <img
          src={src}
          alt={alt}
          draggable={false}
          className="max-h-full max-w-full object-contain"
          style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})`, transformOrigin: 'center' }}
        />
      </div>
      <p className="px-3 pb-[calc(env(safe-area-inset-bottom)+10px)] pt-2 text-center text-xs text-white/70">{t('hint')}</p>
    </div>
  );
}
