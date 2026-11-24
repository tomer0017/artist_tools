import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { useLocale, useTranslations } from 'use-intl';
import { Dices, Feather, Layers, Mountain, Palette, Sparkles, X } from 'lucide-react';
import { MOODS, PLAYGROUND_KEYS, effortOf, poolOf, readIds, reelOf, spin, withSpin, type Mood } from '@/lib/learn/roulette';
import { itemPath } from '@/lib/learn/routes';
import { useLearnItem, useLearnList, type ListEntry } from '@/components/learn/data';
import { Sketchy, type SketchyHandle } from './Sketchy';
import { PRIORITY, useSketchyPresence } from './presence';

// Sketchy's challenge roulette (ADR-0024): a wheel of the challenges this
// account may open, read from the Learn API every time it opens (so a
// challenge added, edited, locked or archived in Admin → Learn is reflected
// at once), filtered by mood (Challenges V2's efforts), category and "quick".
// The pick is made first by the same rules as the Challenges playground
// (src/lib/learn/roulette.ts: never a locked one, not the last few spun),
// then the wheel turns to land on it while Sketchy watches and cheers. In
// class mode it offers the challenge's practice sheets (when the account has
// Worksheets and the challenge has a picture or asks for one's own photo).

const MOOD_ICONS = { light: Feather, create: Sparkles, challenge: Mountain, surprise: Dices } as const;
const SPIN_MS = 3400;
const WEDGES = 10;
const COLORS = ['#f07a24', '#f6d49a', '#c9402f', '#8d5532', '#f2a548', '#5f8f9a', '#f3dfbd', '#a96d43', '#e8564c', '#7aa57a'];
const DARK_TEXT = new Set(['#f6d49a', '#f3dfbd', '#f2a548']);

function readLocal<T>(key: string, parse: (value: unknown) => T): T {
  try {
    return parse(JSON.parse(window.localStorage.getItem(key) ?? 'null'));
  } catch {
    return parse(null);
  }
}

function writeLocal(key: string, value: unknown) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Private browsing: remembered for this visit only.
  }
}

const short = (text: string, max = 24) => (text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text);

export interface RouletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mood?: Mood;
  classMode?: boolean;
  /** The account may make worksheets (export.worksheets) and use Create a Grid. */
  worksheets: boolean;
  reducedMotion: boolean;
}

export function Roulette({ open, onOpenChange, mood: initialMood, classMode = false, worksheets, reducedMotion }: RouletteProps) {
  const t = useTranslations('companion.roulette');
  const tp = useTranslations('learn.playground');
  const tl = useTranslations('learn');
  const locale = useLocale() === 'he' ? 'he' : 'en';
  const list = useLearnList('challenges', open);
  const [mood, setMood] = useState<Mood>(initialMood ?? 'surprise');
  const [group, setGroup] = useState('all');
  const [quick, setQuick] = useState(false);
  const [reel, setReel] = useState<ListEntry[]>([]);
  const [rotation, setRotation] = useState(0);
  const [spinning, setSpinning] = useState(false);
  const [picked, setPicked] = useState<ListEntry | null>(null);
  const [empty, setEmpty] = useState(false);
  const [said, setSaid] = useState('');
  const fox = useRef<SketchyHandle>(null);
  const timer = useRef(0);
  // While the roulette is open he stands only beside its wheel: the stage's Sketchy steps aside (presence.ts).
  const ownsFox = useSketchyPresence('roulette', PRIORITY.roulette, open);

  useEffect(() => {
    if (open) {
      setMood(initialMood ?? 'surprise');
      setPicked(null);
      setEmpty(false);
      setSaid('');
      setSpinning(false);
      setReel([]);
      setRotation(0);
    }
    return () => window.clearTimeout(timer.current);
  }, [open, initialMood]);

  const entries = useMemo(() => (list.data?.items ?? []).filter((e) => e.open && (group === 'all' || e.groupId === group) && (!quick || e.quick === true)), [list.data, group, quick]);
  const groups = useMemo(() => list.data?.groups ?? [], [list.data]);
  const groupTitle = useMemo(() => new Map(groups.map((g) => [g.id, g.title[locale]])), [groups, locale]);
  const pool = poolOf(entries, mood);
  // Before the first spin the wheel shows some of what it may land on.
  const wheel = reel.length > 0 ? reel : pool.slice(0, WEDGES);
  const item = useLearnItem(picked?.id ?? 'CH-000', picked !== null);
  const details = item.data?.status === 'open' && item.data.item.kind === 'challenge' ? item.data.item : null;

  const onSpin = () => {
    if (spinning) return;
    const recent = readLocal(PLAYGROUND_KEYS.recent, (v) => readIds(v, 20));
    const pick = spin(entries, mood, { current: picked?.id ?? null, recent });
    if (!pick) {
      setEmpty(true);
      return;
    }
    setEmpty(false);
    writeLocal(PLAYGROUND_KEYS.recent, withSpin(recent, pick.id));
    const next = reelOf(pool, pick, WEDGES);
    // The pick is the last wedge; turn forward (clockwise) at least four times to land its middle under the pointer.
    const slice = 360 / next.length;
    const target = 360 - (next.length - 0.5) * slice + (Math.random() - 0.5) * slice * 0.5;
    const from = rotation % 360;
    const to = rotation + 4 * 360 + ((target - from + 360) % 360);
    setReel(next);
    setPicked(null);
    if (reducedMotion || next.length === 1) {
      setRotation(to);
      land(pick);
      return;
    }
    setSpinning(true);
    setSaid(t('spinning'));
    fox.current?.play('curious');
    // Turn on the next frame so the new wedges are drawn first.
    window.requestAnimationFrame(() => window.requestAnimationFrame(() => setRotation(to)));
    timer.current = window.setTimeout(() => land(pick), SPIN_MS + 120);
  };

  const result = useRef<HTMLElement>(null);
  const land = (pick: ListEntry) => {
    setSpinning(false);
    setPicked(pick);
    setSaid(t('landed', { title: pick.title[locale] }));
    fox.current?.play('celebrate', { onEnd: () => fox.current?.play('idle') });
    // On a phone the result is below the wheel: bring it into view.
    window.requestAnimationFrame(() => result.current?.scrollIntoView({ block: 'nearest', behavior: reducedMotion ? 'auto' : 'smooth' }));
  };

  const sheetsKind = details && worksheets ? (details.reference === 'provided' && details.references.length > 0 ? 'generated' : details.reference === 'own_photo' ? 'ownPhoto' : null) : null;

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm data-[state=open]:animate-in data-[state=open]:fade-in-0" />
        <DialogPrimitive.Content
          className="fixed inset-x-0 bottom-0 z-50 max-h-[92dvh] overflow-y-auto rounded-t-3xl border border-[#a18a66]/50 bg-[radial-gradient(ellipse_at_50%_38%,#40301f_0%,#242124_44%,#19191c_100%)] p-4 pb-[calc(env(safe-area-inset-bottom)+16px)] shadow-2xl outline-none data-[state=open]:animate-in data-[state=open]:slide-in-from-bottom-4 sm:inset-x-auto sm:bottom-auto sm:left-1/2 sm:top-1/2 sm:w-[min(640px,calc(100vw-32px))] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-3xl sm:p-6"
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            (event.currentTarget as HTMLElement).querySelector<HTMLElement>('[data-roulette-spin]')?.focus();
          }}
          data-sketchy-roulette={classMode ? 'class' : 'solo'}
        >
          <div className="flex items-start gap-3">
            <div className="min-w-0 flex-1">
              <DialogPrimitive.Title className="text-xl font-bold text-foreground sm:text-2xl">{classMode ? t('classTitle') : t('title')}</DialogPrimitive.Title>
              <DialogPrimitive.Description className="mt-1 text-[15px] text-foreground/90">{classMode ? t('classLead') : t('lead')}</DialogPrimitive.Description>
            </div>
            <DialogPrimitive.Close className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              <X className="h-5 w-5" aria-hidden="true" />
              <span className="sr-only">{t('close')}</span>
            </DialogPrimitive.Close>
          </div>

          <fieldset className="mt-4" disabled={spinning}>
            <legend className="sr-only">{t('mood')}</legend>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {MOODS.map((option) => {
                const Icon = MOOD_ICONS[option];
                const on = mood === option;
                return (
                  <label
                    key={option}
                    className={`flex min-h-[44px] cursor-pointer items-center gap-1.5 rounded-xl border px-2.5 py-2 text-sm font-semibold transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring ${on ? 'border-primary bg-primary/15 text-foreground' : 'border-border text-foreground/90 hover:border-primary/50'}`}
                    data-roulette-mood={option}
                  >
                    <input type="radio" name="sketchy-roulette-mood" value={option} checked={on} onChange={() => setMood(option)} className="sr-only" />
                    <Icon className={`h-4 w-4 shrink-0 ${on ? 'text-primary' : ''}`} aria-hidden="true" />
                    <span className="min-w-0">{tp(`moods.${option}`)}</span>
                  </label>
                );
              })}
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <label className="flex min-h-[44px] items-center gap-2 text-sm text-foreground">
                <span className="font-medium">{t('category')}</span>
                <select value={group} onChange={(e) => setGroup(e.target.value)} className="min-h-[40px] max-w-[60vw] rounded-lg border border-border bg-background px-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" data-roulette-category>
                  <option value="all">{t('anyCategory')}</option>
                  {groups.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.title[locale]}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex min-h-[44px] cursor-pointer items-center gap-2 text-sm text-foreground">
                <input type="checkbox" checked={quick} onChange={(e) => setQuick(e.target.checked)} className="h-5 w-5 accent-[hsl(var(--primary))]" data-roulette-quick />
                {t('quick')}
              </label>
            </div>
          </fieldset>

          <div className="relative mx-auto mt-3 flex w-full max-w-[480px] items-end justify-center py-3">
            <div className="relative h-[min(64vw,320px)] w-[min(64vw,320px)] drop-shadow-[0_0_24px_#e99b2430]">
              {/* the pointer */}
              <svg viewBox="0 0 24 24" className="absolute left-1/2 top-[-6px] z-10 h-7 w-7 -translate-x-1/2 drop-shadow" aria-hidden="true">
                <path d="M12 22 L3 4 Q12 0 21 4 Z" fill="#fff0c3" stroke="#f5a623" strokeWidth="1.6" strokeLinejoin="round" />
              </svg>
              <div
                className="h-full w-full"
                style={{ transform: `rotate(${rotation}deg)`, transition: spinning ? `transform ${SPIN_MS}ms cubic-bezier(0.12, 0.8, 0.1, 1)` : 'none' }}
                aria-hidden="true"
                data-roulette-wheel
              >
                <Wheel entries={wheel} locale={locale} rotation={rotation} spinning={spinning} />
              </div>
              <div className="pointer-events-none absolute left-1/2 top-1/2 h-12 w-12 -translate-x-1/2 -translate-y-1/2 rounded-full flex items-center justify-center border-[3px] border-[#986329] bg-[radial-gradient(circle_at_35%_25%,#fff2c9,#dfb268)] shadow-[0_2px_8px_#311a12]" aria-hidden="true"><Palette className="h-6 w-6 text-[#744316]" /></div>
            </div>
            <div className="relative -ms-10 mb-[-5px] w-[clamp(92px,24vw,160px)] shrink-0 [&>div]:!h-auto [&>div]:!w-full [&>div]:aspect-[248/292]" aria-hidden="true">
              {ownsFox && <Sketchy ref={fox} height={180} initial="point" facing={locale === 'he' ? 'right' : 'left'} reducedMotion={reducedMotion} />}
            </div>
          </div>

          <p className="mt-1 text-center text-xs text-muted-foreground" data-roulette-count={pool.length}>
            {list.isPending ? t('loading') : list.isError ? '' : t('count', { count: pool.length })}
          </p>
          {list.isError && (
            <p role="alert" className="mt-2 text-center text-sm text-foreground">
              {t('failed')}
            </p>
          )}

          <div className="mt-3 flex justify-center">
            <button
              type="button"
              onClick={onSpin}
              disabled={spinning || list.isPending || list.isError}
              className="inline-flex min-h-[48px] min-w-[14rem] items-center justify-center gap-2 rounded-full border border-[#ffe09a] bg-gradient-to-b from-[#ffd86b] via-[#ffb51f] to-[#d8880d] px-8 text-base font-bold text-primary-foreground shadow-[0_5px_24px_#e9a12435,inset_0_1px_0_#fff3ca] transition-colors hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
              data-roulette-spin
            >
              <Dices className={`h-5 w-5 ${spinning ? 'motion-safe:animate-spin' : ''}`} aria-hidden="true" />
              {spinning ? t('spinning') : picked ? t('again') : t('spin')}
            </button>
          </div>
          {empty && (
            <p role="status" className="mt-2 text-center text-sm text-foreground" data-roulette-empty>
              {t('empty')}
            </p>
          )}

          {picked && (
            <article ref={result} className="mt-4 min-w-0 scroll-m-4 break-words rounded-2xl border border-[#e7b759]/65 bg-[linear-gradient(120deg,#59402555,#211e20_70%)] p-4 sm:p-5 animate-in fade-in-0 slide-in-from-bottom-2 duration-300 motion-reduce:animate-none" data-roulette-result={picked.id}>
              <div className="mb-1 flex flex-wrap items-center gap-1.5">
                {groupTitle.get(picked.groupId) && <span className="text-xs font-semibold uppercase tracking-wider text-foreground">{groupTitle.get(picked.groupId)}</span>}
                {effortOf(picked) && <span className="rounded-full bg-secondary px-2 py-0.5 text-[11px] font-semibold text-foreground">{tl(`challenges.levels.${picked.level!}`)}</span>}
              </div>
              <h3 className="text-xl font-semibold leading-tight text-foreground">{picked.title[locale]}</h3>
              {details ? (
                <>
                  <p className="mt-2 text-[15px] leading-relaxed text-foreground">{details.prompt[locale]}</p>
                  {details.twist && (
                    <p className="mt-2 text-[15px] leading-relaxed text-foreground">
                      <span className="font-semibold">{tp('twist')}:</span> {details.twist[locale]}
                    </p>
                  )}
                </>
              ) : (
                <div className="mt-2 h-5 w-3/4 animate-pulse rounded bg-secondary motion-reduce:animate-none" aria-hidden="true" />
              )}
              <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
                <Link href={itemPath(picked.id)} onClick={() => onOpenChange(false)} className="inline-flex min-h-[44px] items-center justify-center rounded-xl bg-primary px-4 text-[15px] font-semibold text-primary-foreground hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" data-roulette-open>
                  {t('open')}
                </Link>
                {sheetsKind && (classMode || worksheets) && (
                  <Link
                    href={`${itemPath(picked.id)}${sheetsKind === 'generated' ? '?sheets=1' : ''}`}
                    onClick={() => onOpenChange(false)}
                    className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-xl border border-border px-4 text-[15px] font-semibold text-foreground hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    data-roulette-sheets={sheetsKind}
                  >
                    <Layers className="h-4 w-4" aria-hidden="true" /> {sheetsKind === 'generated' ? t('sheets') : t('sheetsOwnPhoto')}
                  </Link>
                )}
              </div>
            </article>
          )}
          <p aria-live="polite" className="sr-only">
            {said}
          </p>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

/** Dynamic challenge wedges, with counter-rotated labels that remain upright. */
function Wheel({ entries, locale, rotation, spinning }: { entries: ListEntry[]; locale: 'en' | 'he'; rotation: number; spinning: boolean }) {
  const n = Math.max(entries.length, 1);
  const slice = 360 / n;
  const point = (deg: number, r: number) => {
    const rad = ((deg - 90) * Math.PI) / 180;
    return `${(r * Math.cos(rad)).toFixed(2)} ${(r * Math.sin(rad)).toFixed(2)}`;
  };
  return (
    <svg viewBox="-104 -104 208 208" className="h-full w-full drop-shadow-xl">
      <circle r="103" fill="#a66a27" stroke="#edbe6b" strokeWidth="1.5" />
      <circle r="100" fill="#5d3518" />
      {entries.length === 0 && <circle r="98" fill="#f3dfbd" />}
      {entries.map((entry, i) => {
        const a0 = i * slice;
        const a1 = (i + 1) * slice;
        const color = COLORS[i % COLORS.length];
        const mid = a0 + slice / 2;
        return (
          <g key={`${entry.id}-${i}`}>
            <path d={n === 1 ? 'M0 -98 A98 98 0 1 1 -0.01 -98 Z' : `M0 0 L${point(a0, 98)} A98 98 0 0 1 ${point(a1, 98)} Z`} fill={color} stroke="#5d3518" strokeWidth="1" />
            <g transform={`translate(${point(mid, 64)})`}>
              <g style={{ transform: `rotate(${-rotation}deg)`, transition: spinning ? `transform ${SPIN_MS}ms cubic-bezier(0.12, 0.8, 0.1, 1)` : 'none' }}>
                <text textAnchor="middle" dominantBaseline="central" fontSize="7.1" fontWeight="700"
                  fill={DARK_TEXT.has(color) ? '#3b2416' : '#fff8ec'} direction={locale === 'he' ? 'rtl' : 'ltr'}>
                  {labelLines(entry.title[locale]).map((line, row, lines) => <tspan key={row} x="0" y={(row - (lines.length - 1) / 2) * 9}>{line}</tspan>)}
                </text>
              </g>
            </g>
          </g>
        );
      })}
      {entries.map((_, i) => (
        <circle key={i} cx={point(i * slice, 99).split(' ')[0]} cy={point(i * slice, 99).split(' ')[1]} r="2.5" fill="#fff1bc" stroke="#ffcb6e" strokeWidth=".6" style={{ filter: 'drop-shadow(0 0 2px #ffd16c)' }} />
      ))}
    </svg>
  );
}

/** Short, upright labels stay inside each wedge, including after a spin. */
function labelLines(title: string): string[] {
  const words = short(title).split(/\s+/);
  const lines: string[] = [];
  for (const word of words) {
    if (lines.length && `${lines[lines.length - 1]} ${word}`.length <= 10) lines[lines.length - 1] += ` ${word}`;
    else lines.push(word.length > 10 ? `${word.slice(0, 9)}…` : word);
  }
  if (lines.length > 3) return [...lines.slice(0, 2), `${lines[2].slice(0, 8)}…`];
  return lines;
}
