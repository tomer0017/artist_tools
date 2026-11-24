import { forwardRef } from 'react';
import { useTranslations } from 'use-intl';
import { X } from 'lucide-react';
import type { CompanionTip } from '@/lib/companion/model';

// The sign Sketchy holds up (ADR-0024): a small wooden-framed board with the
// tip in the page's language, its one button and "Not now". Real text (never
// part of a picture), dark on parchment in either theme, reachable from the
// keyboard; the stage places it beside his raised paw and announces it once.

export const signButton =
  'inline-flex min-h-[40px] items-center justify-center rounded-lg px-3 text-[14px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#8b5a2b] focus-visible:ring-offset-2 focus-visible:ring-offset-[#f7ecd6]';

export interface SignProps {
  tip: Pick<CompanionTip, 'id' | 'title' | 'text' | 'action'>;
  locale: 'en' | 'he';
  /** The button's action can run for this person now (otherwise it is left out). */
  actionable: boolean;
  onAction: () => void;
  onDismiss: () => void;
  onClose: () => void;
  /** "Another tip" (drawing tips asked for from the menu). */
  onAnother?: () => void;
  /** Shown below him (no room beside him): no post, a small notch pointing up at him instead. */
  below?: boolean;
  style?: React.CSSProperties;
}

export const Sign = forwardRef<HTMLDivElement, SignProps>(function Sign({ tip, locale, actionable, onAction, onDismiss, onClose, onAnother, below = false, style }, ref) {
  const t = useTranslations('companion');
  const title = tip.title?.[locale]?.trim();
  const showAction = actionable && tip.action.type !== 'none';
  return (
    <div
      ref={ref}
      role="group"
      aria-label={t('region')}
      data-sketchy-sign={tip.id}
      className={`pointer-events-auto absolute z-30 w-[min(300px,calc(100vw-24px))] transition-none animate-in fade-in-0 zoom-in-95 duration-300 motion-reduce:animate-none ${below ? 'origin-top' : 'origin-bottom'}`}
      style={style}
      data-below={below || undefined}
    >
      <div className="relative rounded-xl border-[5px] border-[#8b5a2b] bg-[#f7ecd6] p-3 pe-9 text-[#3b2416] shadow-[0_10px_30px_rgba(0,0,0,0.45),inset_0_0_0_2px_#c79a62]">
        <span aria-hidden="true" className="absolute -top-1 start-3 h-2 w-2 rounded-full bg-[#5d3518]" />
        <span aria-hidden="true" className="absolute -top-1 end-3 h-2 w-2 rounded-full bg-[#5d3518]" />
        <button
          type="button"
          onClick={onClose}
          className="absolute end-1 top-1 flex h-9 w-9 items-center justify-center rounded-full text-[#6b4423] hover:bg-[#ead9b8] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#8b5a2b]"
          data-sketchy-close
        >
          <X className="h-4 w-4" aria-hidden="true" />
          <span className="sr-only">{t('sign.close')}</span>
        </button>
        <div className="max-h-[min(42vh,260px)] overflow-y-auto">
          {title && <p className="mb-1 text-[15px] font-bold leading-snug">{title}</p>}
          <p className="text-[15px] leading-relaxed" data-sketchy-text>
            {tip.text[locale]}
          </p>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {showAction && (
            <button type="button" onClick={onAction} className={`${signButton} bg-[#8b5a2b] text-[#fff8ec] hover:bg-[#6f4521]`} data-sketchy-action={tip.action.type}>
              {tip.action.label[locale]}
            </button>
          )}
          {onAnother && (
            <button type="button" onClick={onAnother} className={`${signButton} border border-[#8b5a2b] text-[#5d3518] hover:bg-[#ead9b8]`} data-sketchy-another>
              {t('sign.another')}
            </button>
          )}
          <button type="button" onClick={onDismiss} className={`${signButton} text-[#5d3518] underline-offset-2 hover:underline`} data-sketchy-dismiss>
            {t('sign.dismiss')}
          </button>
        </div>
      </div>
    </div>
  );
});
