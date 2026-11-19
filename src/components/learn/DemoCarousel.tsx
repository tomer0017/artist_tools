import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslations } from 'use-intl';
import { ChevronLeft, ChevronRight, Maximize2 } from 'lucide-react';
import type { Localized } from '@/lib/learn/model';
import { assetUrl, type ImageView } from './data';
import ZoomViewer from './ZoomViewer';
import { useLocalized } from './parts';

// "See it" (ADR-0019): a lesson's demonstration, one picture at a time. Swipe
// on a phone, the buttons or the dots anywhere, a tap for full screen and zoom.
// Every word is in the caption under the picture, never in the picture, so one
// picture serves both languages. The counter says where you are; nothing moves
// by itself.

export default function DemoCarousel({ frames }: { frames: { image: ImageView; caption: Localized }[] }) {
  const t = useTranslations('learn.lesson');
  const loc = useLocalized();
  const track = useRef<HTMLDivElement>(null);
  const [index, setIndex] = useState(0);
  const [zoom, setZoom] = useState<number | null>(null);
  const total = frames.length;

  // The frame most in view is the current one (swiping moves it as well as the buttons).
  useEffect(() => {
    const root = track.current;
    if (!root || total < 2 || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) if (entry.isIntersecting) setIndex(Number((entry.target as HTMLElement).dataset.demoFrame) - 1);
      },
      { root, threshold: 0.6 },
    );
    for (const child of Array.from(root.children)) observer.observe(child);
    return () => observer.disconnect();
  }, [total]);

  const go = useCallback(
    (next: number) => {
      const target = Math.min(total - 1, Math.max(0, next));
      const frame = track.current?.children[target] as HTMLElement | undefined;
      const still = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
      frame?.scrollIntoView({ behavior: still ? 'auto' : 'smooth', inline: 'center', block: 'nearest' });
      setIndex(target);
    },
    [total],
  );

  if (total === 0) return null;
  return (
    <section aria-labelledby="lesson-see-title" className="rounded-2xl border border-border bg-card p-3 md:p-4" data-learn-demo>
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <h2 id="lesson-see-title" className="text-sm font-bold uppercase tracking-wider text-primary">
          {t('seeIt')}
        </h2>
        <span className="flex items-center gap-1">
          {total > 1 && (
            <span className="text-xs tabular-nums text-muted-foreground" aria-live="polite" data-demo-position>
              {t('frame', { number: index + 1, total })}
            </span>
          )}
          {/* Outside the picture: pictures never mirror, so a corner of one may hold content in either direction. */}
          <button
            type="button"
            onClick={() => setZoom(index)}
            aria-label={t('zoomFrame')}
            className="-me-2 flex h-10 w-10 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            data-demo-zoom
          >
            <Maximize2 className="h-4 w-4" aria-hidden="true" />
          </button>
        </span>
      </div>
      <div
        ref={track}
        className="flex snap-x snap-mandatory overflow-x-auto overscroll-x-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        tabIndex={-1}
      >
        {frames.map((frame, i) => (
          <figure key={frame.image.assetId + i} data-demo-frame={i + 1} className="w-full shrink-0 snap-center snap-always" aria-label={total > 1 ? t('frame', { number: i + 1, total }) : undefined}>
            <button
              type="button"
              onClick={() => setZoom(i)}
              aria-label={`${t('zoomFrame')}: ${loc(frame.image.alt)}`}
              className="block w-full cursor-zoom-in overflow-hidden rounded-xl bg-[#f4f1ea] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              tabIndex={-1}
            >
              {/* eslint-disable-next-line @next/next/no-img-element -- a private image from the authorized Learn route */}
              <img
                src={assetUrl(frame.image.assetId)}
                alt={loc(frame.image.alt)}
                width={frame.image.width ?? undefined}
                height={frame.image.height ?? undefined}
                loading={i === 0 ? 'eager' : 'lazy'}
                decoding="async"
                className="mx-auto h-auto max-h-[36vh] w-auto max-w-full object-contain sm:max-h-[44vh] lg:max-h-[56vh]"
              />
            </button>
            <figcaption className="mt-2.5 text-[15px] leading-relaxed text-foreground" data-demo-caption>
              {loc(frame.caption)}
            </figcaption>
          </figure>
        ))}
      </div>
      {total > 1 && (
        <div className="mt-2 flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={() => go(index - 1)}
            disabled={index === 0}
            aria-label={t('previousFrame')}
            className="flex h-11 w-11 items-center justify-center rounded-full border border-border bg-background text-foreground transition-colors hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40"
            data-demo-previous
          >
            <ChevronLeft className="h-5 w-5 rtl:-scale-x-100" aria-hidden="true" />
          </button>
          <div className="flex items-center gap-1.5">
            {frames.map((frame, i) => (
              <button
                key={frame.image.assetId + i}
                type="button"
                onClick={() => go(i)}
                aria-label={t('frame', { number: i + 1, total })}
                aria-current={i === index ? 'true' : undefined}
                className="flex h-11 w-6 items-center justify-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <span className={`block h-2 rounded-full transition-all ${i === index ? 'w-5 bg-primary' : 'w-2 bg-muted-foreground/40'}`} aria-hidden="true" />
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={() => go(index + 1)}
            disabled={index === total - 1}
            aria-label={t('nextFrame')}
            className="flex h-11 w-11 items-center justify-center rounded-full border border-border bg-background text-foreground transition-colors hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40"
            data-demo-next
          >
            <ChevronRight className="h-5 w-5 rtl:-scale-x-100" aria-hidden="true" />
          </button>
        </div>
      )}
      {zoom !== null && <ZoomViewer src={assetUrl(frames[zoom].image.assetId)} alt={loc(frames[zoom].image.alt)} title={t('zoomTitle')} onClose={() => setZoom(null)} />}
    </section>
  );
}
