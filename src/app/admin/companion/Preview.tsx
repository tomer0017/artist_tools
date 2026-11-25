'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { IntlProvider } from 'use-intl';
import { Moon, Play, Smartphone, Monitor, Sun } from 'lucide-react';
import { ANIMATIONS, ANIMATION_LABELS, type AnimationId, type CompanionTip } from '@/lib/companion/model';
import { companionEn, companionHe } from '@/i18n/messages/companion';
import { Sign } from '@/components/companion/Sign';
import { Sketchy, type SketchyHandle } from '@/components/companion/Sketchy';
import { CLIPS } from '@/components/companion/clips';
import { BASE_HEIGHT, WIDTH_RATIO, signPlacement } from '@/components/companion/geometry';

// The preview stage of Admin → Companion (ADR-0024): the real Sketchy and
// his real sign, as the studio shows them (the sign on the post he holds), on
// a dark or a light background, at a phone's or a desktop's width, in English
// or Hebrew. Any tip shows at once, from its row below or from the list here,
// with no pace or cooldown; the preview comes into view when asked for.
// Nothing here is saved: it is for looking before people see it.

export interface PreviewRequest {
  animation: AnimationId;
  tip: Pick<CompanionTip, 'id' | 'title' | 'text' | 'action'> | null;
  /** Bumped to replay the same request. */
  nonce: number;
}

const control = 'inline-flex h-9 items-center gap-1.5 rounded-lg border border-border px-3 text-sm font-medium text-foreground hover:bg-secondary aria-pressed:border-primary aria-pressed:bg-primary/15';

export function CompanionPreview({
  request,
  onPlay,
  size,
  reducedMotion,
  tips = [],
  onTip,
}: {
  request: PreviewRequest;
  onPlay: (animation: AnimationId) => void;
  size: number;
  reducedMotion: boolean;
  /** Tips to show from here at once (no pace, no cooldown). */
  tips?: CompanionTip[];
  onTip?: (tip: CompanionTip) => void;
}) {
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');
  const [width, setWidth] = useState<'phone' | 'desktop'>('desktop');
  const [locale, setLocale] = useState<'en' | 'he'>('en');
  const fox = useRef<SketchyHandle>(null);
  const section = useRef<HTMLElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const signEl = useRef<HTMLDivElement>(null);
  const [signAt, setSignAt] = useState<{ left: number; top: number; width: number; maxHeight: number | null } | null>(null);

  useEffect(() => {
    const id = window.requestAnimationFrame(() => {
      const clip = CLIPS[request.animation];
      if (request.tip && request.animation !== 'holdSign') {
        // A tip opens with its own move, then he holds up the sign.
        fox.current?.play(request.animation, { restart: true, onEnd: () => fox.current?.play('holdSign') });
        if (clip.loop) window.setTimeout(() => fox.current?.play('holdSign'), 1600);
      } else fox.current?.play(request.animation, { restart: true, params: request.animation === 'point' ? { aim: 35 } : undefined, onEnd: () => fox.current?.play(request.tip ? 'holdSign' : 'idle') });
    });
    return () => window.cancelAnimationFrame(id);
  }, [request]);

  // Asked for from far down the page: the preview comes into view.
  useEffect(() => {
    if (request.nonce > 0) section.current?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' });
  }, [request.nonce]);

  // His standard size in Home's hero: a phone's, or a desktop's.
  const height = Math.round((width === 'phone' ? BASE_HEIGHT.narrow : BASE_HEIGHT.wide) * (size / 100));
  const rtl = locale === 'he';
  const boxHeight = request.tip ? 380 : 300;

  // The sign where the studio puts it: on the top of the post in his paw, beside his head.
  useLayoutEffect(() => {
    const room = stage.current;
    const sign = signEl.current;
    if (!request.tip || !room || !sign) return setSignAt(null);
    const place = () => {
      const w = room.clientWidth;
      const foxWidth = height * WIDTH_RATIO;
      const left = rtl ? 24 : w - 24 - foxWidth;
      const at = { left, right: left + foxWidth, top: boxHeight - 12 - height, height };
      const limits = { width: w, topLimit: 8, floor: boxHeight - 12 };
      const facing = rtl ? 'right' : 'left';
      const first = signPlacement(at, sign.offsetHeight, limits, facing);
      sign.style.width = `${first.width}px`;
      const placed = signPlacement(at, sign.offsetHeight, limits, facing);
      setSignAt({ left: placed.left, top: placed.below ? 8 : placed.top, width: placed.width, maxHeight: placed.maxHeight });
    };
    place();
    const observer = new ResizeObserver(place);
    observer.observe(room);
    return () => observer.disconnect();
  }, [request, height, rtl, width, boxHeight]);

  return (
    <section ref={section} aria-label="Preview" className="scroll-mt-4 rounded-2xl border border-border bg-card p-4 md:p-5" data-companion-preview>
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="me-auto text-base font-semibold text-foreground">Preview</h2>
        <button type="button" className={control} aria-pressed={theme === 'dark'} onClick={() => setTheme('dark')}>
          <Moon className="h-4 w-4" aria-hidden="true" /> Dark
        </button>
        <button type="button" className={control} aria-pressed={theme === 'light'} onClick={() => setTheme('light')}>
          <Sun className="h-4 w-4" aria-hidden="true" /> Light
        </button>
        <button type="button" className={control} aria-pressed={width === 'desktop'} onClick={() => setWidth('desktop')}>
          <Monitor className="h-4 w-4" aria-hidden="true" /> Desktop
        </button>
        <button type="button" className={control} aria-pressed={width === 'phone'} onClick={() => setWidth('phone')}>
          <Smartphone className="h-4 w-4" aria-hidden="true" /> Phone
        </button>
        <button type="button" className={control} aria-pressed={locale === 'en'} onClick={() => setLocale('en')}>
          English
        </button>
        <button type="button" className={control} aria-pressed={locale === 'he'} onClick={() => setLocale('he')}>
          עברית
        </button>
      </div>
      <div className="mt-3 overflow-x-auto">
        <div
          ref={stage}
          lang={locale}
          dir={rtl ? 'rtl' : 'ltr'}
          className="relative mx-auto overflow-hidden rounded-xl border border-border"
          style={{ width: width === 'phone' ? 390 : '100%', maxWidth: 900, height: boxHeight, background: theme === 'dark' ? '#18181b' : '#fafaf7' }}
          data-preview-theme={theme}
        >
          <IntlProvider locale={locale} messages={{ companion: locale === 'he' ? companionHe : companionEn }} timeZone="UTC">
            {request.tip && (
              <Sign
                key={`${request.tip.id}-${request.nonce}`}
                ref={signEl}
                tip={request.tip}
                locale={locale}
                actionable
                onAction={() => {}}
                onDismiss={() => {}}
                onClose={() => {}}
                style={signAt ? { left: signAt.left, top: signAt.top, width: signAt.width, ...(signAt.maxHeight ? { maxHeight: signAt.maxHeight, display: 'flex' } : {}) } : { left: -10000, top: 0, visibility: 'hidden' }}
              />
            )}
            <div className="absolute bottom-3" style={{ [rtl ? 'left' : 'right']: 24 }}>
              <Sketchy ref={fox} height={height} facing={rtl ? 'right' : 'left'} reducedMotion={reducedMotion} />
            </div>
          </IntlProvider>
        </div>
      </div>
      {onTip && tips.length > 0 && (
        <label className="mt-3 flex flex-wrap items-center gap-2 text-sm text-foreground">
          <span className="font-medium">Show a sign now</span>
          <select
            className="h-9 min-w-0 max-w-full flex-1 rounded-lg border border-border bg-background px-2 text-sm"
            value={request.tip?.id ?? ''}
            onChange={(e) => {
              const tip = tips.find((tp) => tp.id === e.target.value);
              if (tip) onTip(tip);
            }}
            data-preview-tip
          >
            <option value="" disabled>
              Choose a tip…
            </option>
            {tips.map((tp) => (
              <option key={tp.id} value={tp.id}>
                {tp.id} · {(tp.title?.en || tp.text.en).slice(0, 60)}
              </option>
            ))}
          </select>
        </label>
      )}
      <div className="mt-3 flex flex-wrap gap-1.5" aria-label="Play an animation">
        {ANIMATIONS.map((id) => (
          <button key={id} type="button" onClick={() => onPlay(id)} className="inline-flex h-8 items-center gap-1 rounded-lg border border-border px-2.5 text-xs font-semibold text-foreground hover:bg-secondary" data-preview-play={id}>
            <Play className="h-3 w-3" aria-hidden="true" /> {ANIMATION_LABELS[id]}
          </button>
        ))}
      </div>
    </section>
  );
}
