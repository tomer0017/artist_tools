import { useId } from 'react';
import { Check, X } from 'lucide-react';
import { useTranslations } from 'use-intl';
import { hueOnWheel, inkOn, type Harmony, type HarmonyColor, type HarmonyId } from './harmonies';
import type { CopyResult } from './useCopyHex';

// Every harmony of the selected colour at once, as compact cards. A card
// shows its colours on the wheel (tap it again to hide them); a colour copies
// its HEX. Each card carries a small ring with its colours at their hues, so
// the relationship reads even when the wheel is scrolled away on a phone.

type ColorT = ReturnType<typeof useTranslations<'colorTool'>>;

/** A colour's tag in the current language (−30° stays as written). */
export const tagText = (c: HarmonyColor, t: ColorT) => ('key' in c.tag ? t(`tags.${c.tag.key}`) : c.tag.value);

/** The key a swatch reports when it copies (see useCopyHex). */
export const swatchKey = (id: HarmonyId, index: number) => `${id}:${index}`;

function HarmonyRing({ colors, active }: { colors: HarmonyColor[]; active: boolean }) {
  const R = 8.5;
  return (
    <svg viewBox="0 0 24 24" className="h-6 w-6 shrink-0" aria-hidden="true">
      <circle cx="12" cy="12" r={R} fill="none" strokeWidth="1.5" className={active ? 'stroke-primary' : 'stroke-muted-foreground/40'} />
      {colors.map((c, i) => {
        const hue = hueOnWheel(c.hex);
        if (hue === null) return null;
        const a = ((hue - 90) * Math.PI) / 180;
        return (
          <circle
            key={i}
            cx={12 + Math.cos(a) * R}
            cy={12 + Math.sin(a) * R}
            r={c.base ? 3.4 : 2.7}
            fill={c.hex}
            stroke="hsl(var(--card))"
            strokeWidth="1.2"
          />
        );
      })}
    </svg>
  );
}

function SwatchButton({ color, label, copied, onCopy }: {
  color: HarmonyColor;
  label: string;
  copied: CopyResult | null;
  onCopy: () => void;
}) {
  const t = useTranslations('colorTool.copy');
  const hex = color.hex.toUpperCase();
  const ink = inkOn(color.hex);
  // Named by what it shows ("Copy Tri A #7BD482"; the verb is for screen
  // readers only). The name stays the same while "Copied" is shown: the HEX is
  // only hidden from sight, and the status line reads the result out.
  return (
    <button
      type="button"
      onClick={onCopy}
      className="group pointer-events-auto flex min-w-0 flex-col items-center gap-1 rounded-md py-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
    >
      <span className="sr-only">{t('verb')} </span>
      <span
        className="relative flex aspect-square w-full max-w-10 items-center justify-center rounded-md border border-border/60 transition-transform group-hover:scale-105 group-active:scale-95"
        style={{ backgroundColor: color.hex }}
      >
        {copied && (copied.ok
          ? <Check className="h-4 w-4" strokeWidth={3} style={{ color: ink }} aria-hidden="true" />
          : <X className="h-4 w-4" strokeWidth={3} style={{ color: ink }} aria-hidden="true" />)}
      </span>
      <span dir={'value' in color.tag ? 'ltr' : undefined} className="w-full truncate text-center text-[10px] leading-tight text-muted-foreground">
        {label}
      </span>{' '}
      <span
        dir="ltr"
        className={copied ? 'sr-only' : 'w-full whitespace-nowrap text-center font-mono text-[10px] leading-tight tracking-tight text-foreground/80 max-[359px]:text-[9px]'}
      >
        {hex}
      </span>
      {copied && (
        <span aria-hidden="true" className={`w-full truncate text-center text-[10px] font-semibold leading-tight ${copied.ok ? 'text-primary' : 'text-red-400'}`}>
          {copied.ok ? t('copied') : t('notCopied')}
        </span>
      )}
    </button>
  );
}

export default function HarmonyCards({ harmonies, active, onToggle, copied, onCopy }: {
  harmonies: Harmony[];
  active: HarmonyId | null;
  onToggle: (id: HarmonyId) => void;
  copied: CopyResult | null;
  onCopy: (hex: string, key: string) => void;
}) {
  const t = useTranslations('colorTool');
  const hintId = useId();
  return (
    <>
      <p id={hintId} className="sr-only">{t('harmonyCard')}</p>
      <ul data-onboarding="color-harmony" className="grid grid-cols-2 gap-2.5 md:gap-3">
        {harmonies.map((h) => {
          const on = active === h.id;
          return (
            <li
              key={h.id}
              data-harmony={h.id}
              className={`relative flex flex-col rounded-lg border bg-card p-2.5 transition-colors sm:p-3 ${
                on ? 'border-primary/80 shadow-[0_0_0_1px_hsl(var(--primary)/0.35)]' : 'border-border hover:border-primary/40'
              }`}
            >
              {/* The whole card is this button (its ::after covers the card); the swatches sit above it. */}
              <button
                type="button"
                aria-pressed={on}
                aria-describedby={hintId}
                onClick={() => onToggle(h.id)}
                className="flex w-full items-start justify-between gap-2 text-start after:absolute after:inset-0 after:rounded-lg after:content-[''] focus-visible:outline-none focus-visible:after:ring-2 focus-visible:after:ring-primary"
              >
                <span className={`min-w-0 pt-0.5 text-[11px] font-medium uppercase leading-tight tracking-wider ${on ? 'text-foreground' : 'text-muted-foreground'}`}>
                  {t(`harmonies.${h.id}`)}
                </span>
                <HarmonyRing colors={h.colors} active={on} />
              </button>
              {/* At the bottom, so the swatches line up across a row when one title takes two lines. */}
              <div className="pointer-events-none relative z-10 mt-auto grid grid-cols-3 gap-1 pt-1.5">
                {h.colors.map((c, i) => {
                  const key = swatchKey(h.id, i);
                  return (
                    <SwatchButton
                      key={key}
                      color={c}
                      label={tagText(c, t)}
                      copied={copied?.key === key ? copied : null}
                      onCopy={() => onCopy(c.hex, key)}
                    />
                  );
                })}
              </div>
            </li>
          );
        })}
      </ul>
    </>
  );
}
