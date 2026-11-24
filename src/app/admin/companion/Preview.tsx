'use client';

import { useEffect, useRef, useState } from 'react';
import { IntlProvider } from 'use-intl';
import { Moon, Play, Smartphone, Monitor, Sun } from 'lucide-react';
import { ANIMATIONS, ANIMATION_LABELS, type AnimationId, type CompanionTip } from '@/lib/companion/model';
import { companionEn, companionHe } from '@/i18n/messages/companion';
import { Sign } from '@/components/companion/Sign';
import { Sketchy, type SketchyHandle } from '@/components/companion/Sketchy';
import { CLIPS } from '@/components/companion/clips';

// The preview stage of Admin → Companion (ADR-0024): the real Sketchy and
// his real sign, as the studio shows them, on a dark or a light background,
// at a phone's or a desktop's width, in English or Hebrew. Nothing here is
// saved: it is for looking at an animation or a tip before people see it.

export interface PreviewRequest {
  animation: AnimationId;
  tip: Pick<CompanionTip, 'id' | 'title' | 'text' | 'action'> | null;
  /** Bumped to replay the same request. */
  nonce: number;
}

const control = 'inline-flex h-9 items-center gap-1.5 rounded-lg border border-border px-3 text-sm font-medium text-foreground hover:bg-secondary aria-pressed:border-primary aria-pressed:bg-primary/15';

export function CompanionPreview({ request, onPlay, size, reducedMotion }: { request: PreviewRequest; onPlay: (animation: AnimationId) => void; size: number; reducedMotion: boolean }) {
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');
  const [width, setWidth] = useState<'phone' | 'desktop'>('desktop');
  const [locale, setLocale] = useState<'en' | 'he'>('en');
  const fox = useRef<SketchyHandle>(null);

  useEffect(() => {
    const id = window.requestAnimationFrame(() => {
      const clip = CLIPS[request.animation];
      if (request.tip && request.animation !== 'holdSign') {
        // A tip opens with its own move, then he holds up the sign.
        fox.current?.play(request.animation, { restart: true, onEnd: () => fox.current?.play('holdSign') });
        if (clip.loop) window.setTimeout(() => fox.current?.play('holdSign'), 1600);
      } else fox.current?.play(request.animation, { restart: true, params: request.animation === 'point' ? { aim: 35 } : undefined, onEnd: () => fox.current?.play('idle') });
    });
    return () => window.cancelAnimationFrame(id);
  }, [request]);

  const height = Math.round((width === 'phone' ? 104 : 168) * (size / 100));
  const rtl = locale === 'he';
  return (
    <section aria-label="Preview" className="rounded-2xl border border-border bg-card p-4 md:p-5" data-companion-preview>
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
          lang={locale}
          dir={rtl ? 'rtl' : 'ltr'}
          className="relative mx-auto overflow-hidden rounded-xl border border-border"
          style={{ width: width === 'phone' ? 390 : '100%', maxWidth: 900, height: request.tip ? 360 : 280, background: theme === 'dark' ? '#18181b' : '#fafaf7' }}
          data-preview-theme={theme}
        >
          <IntlProvider locale={locale} messages={{ companion: locale === 'he' ? companionHe : companionEn }} timeZone="UTC">
            {request.tip && (
              <Sign
                tip={request.tip}
                locale={locale}
                actionable
                onAction={() => {}}
                onDismiss={() => {}}
                onClose={() => {}}
                style={{ top: 24, [rtl ? 'left' : 'right']: height * 0.85 + 30 }}
              />
            )}
            <div className="absolute bottom-3" style={{ [rtl ? 'left' : 'right']: 24 }}>
              <Sketchy ref={fox} height={height} facing={rtl ? 'right' : 'left'} reducedMotion={reducedMotion} />
            </div>
          </IntlProvider>
        </div>
      </div>
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
