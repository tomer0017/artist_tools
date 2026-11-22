import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import Link from 'next/link';
import { useTranslations } from 'use-intl';
import { Bookmark, BookmarkCheck, Dices, Feather, Mountain, Sparkles } from 'lucide-react';
import { itemPath } from '@/lib/learn/routes';
import { MAX_SAVED, MOODS, PLAYGROUND_KEYS, effortOf, poolOf, readIds, readMood, reelOf, spin, toggleSaved, withSpin, type Mood } from '@/lib/learn/roulette';
import { assetUrl, useLearnItem, type ListEntry, type ListGroup, type OpenItem } from './data';
import { useClassMode } from './ClassMode';
import { MarkDone } from './ItemParts';
import { ChallengeTimer, useTimerSession } from './ChallengeTimer';
import { buttonPrimary, buttonSecondary, useLocalized } from './parts';

// Challenges V2 · the creative playground (ADR-0021): pick a mood (an effort,
// never a skill rating) or let it surprise you, spin, and get one idea to
// draw, with an optional timer. A short reel of other titles lands on the
// pick (none for people who ask for less motion). Then: spin again, save it
// for later, or mark it as completed. The mood, the idea on screen, the last
// spins, the saved ideas and the timer stay in this browser.

const MOOD_ICONS = { light: Feather, create: Sparkles, challenge: Mountain, surprise: Dices } as const;
/** How long the reel turns. */
const REEL_MS = 1200;

function readLocal<T>(key: string, parse: (value: unknown) => T): T {
  try {
    return parse(JSON.parse(localStorage.getItem(key) ?? 'null'));
  } catch {
    return parse(null);
  }
}
function writeLocal(key: string, value: unknown) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Private browsing: remembered for this visit only.
  }
}

// The saved ideas: one store for everything on the page that shows them (the
// playground, the list and its Saved filter, an idea's own page), so a tap in
// one is seen at once in the others; other tabs follow through `storage`.
const NOTHING_SAVED: string[] = [];
const savedListeners = new Set<() => void>();
let savedNow: string[] | null = null;

function savedSnapshot(): string[] {
  savedNow ??= readLocal(PLAYGROUND_KEYS.saved, (v) => readIds(v, MAX_SAVED));
  return savedNow;
}
function subscribeSaved(listener: () => void): () => void {
  const fromOtherTab = (event: StorageEvent) => {
    if (event.key !== PLAYGROUND_KEYS.saved && event.key !== null) return;
    savedNow = null;
    listener();
  };
  savedListeners.add(listener);
  window.addEventListener('storage', fromOtherTab);
  return () => {
    savedListeners.delete(listener);
    window.removeEventListener('storage', fromOtherTab);
  };
}

/** The ideas saved in this browser, newest first, the same everywhere on the page and kept in step with other tabs. */
export function useSavedChallenges(): [string[], (id: string) => void] {
  const saved = useSyncExternalStore(subscribeSaved, savedSnapshot, () => NOTHING_SAVED);
  const toggle = useCallback((id: string) => {
    savedNow = toggleSaved(savedSnapshot(), id);
    writeLocal(PLAYGROUND_KEYS.saved, savedNow);
    for (const listener of savedListeners) listener();
  }, []);
  return [saved, toggle];
}

/** Save for later / Saved: a toggle, kept in this browser. */
export function SaveToggle({ id, saved, onToggle }: { id: string; saved: boolean; onToggle: (id: string) => void }) {
  const t = useTranslations('learn.playground');
  const Icon = saved ? BookmarkCheck : Bookmark;
  return (
    <button type="button" aria-pressed={saved} onClick={() => onToggle(id)} className={buttonSecondary} data-save={saved ? 'saved' : 'not-saved'}>
      <Icon className={`h-5 w-5 ${saved ? 'text-primary' : ''}`} aria-hidden="true" /> {saved ? t('saved') : t('save')}
    </button>
  );
}

export function Playground({ entries, groups, ready }: { entries: ListEntry[]; groups: ListGroup[]; ready: boolean }) {
  const t = useTranslations('learn');
  const loc = useLocalized();
  const classMode = useClassMode();
  const [mood, setMood] = useState<Mood>(() => (typeof window === 'undefined' ? 'surprise' : readLocal(PLAYGROUND_KEYS.mood, readMood)));
  const [current, setCurrent] = useState<string | null>(null);
  const [recent, setRecent] = useState<string[]>([]);
  const [reel, setReel] = useState<ListEntry[] | null>(null);
  const [rolling, setRolling] = useState(false);
  const [empty, setEmpty] = useState(false);
  const [said, setSaid] = useState('');
  const [saved, toggleSave] = useSavedChallenges();
  const [session, setSession] = useTimerSession();
  const landing = useRef<{ id: string; timer: number } | null>(null);

  // Back on this screen: the idea of the running timer, or the one last shown (if it is still there and open).
  useEffect(() => {
    if (!ready) return;
    setRecent(readLocal(PLAYGROUND_KEYS.recent, (v) => readIds(v, 20)));
    const wanted = session?.challengeId ?? readLocal(PLAYGROUND_KEYS.current, (v) => (typeof v === 'string' ? v : null));
    setCurrent((now) => now ?? (wanted && entries.some((entry) => entry.id === wanted && entry.open) ? wanted : null));
    // Only when the list first arrives.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);
  useEffect(() => () => window.clearTimeout(landing.current?.timer), []);

  const groupTitle = useMemo(() => new Map(groups.map((group) => [group.id, group.title])), [groups]);
  const answer = useLearnItem(current ?? reel?.at(-1)?.id ?? 'CH-000', current !== null || reel !== null);
  const item = answer.data?.status === 'open' && answer.data.item.kind === 'challenge' ? (answer.data.item as Extract<OpenItem, { kind: 'challenge' }>) : null;
  const shownEntry = entries.find((entry) => entry.id === current) ?? null;

  const chooseMood = (next: Mood) => {
    setMood(next);
    setEmpty(false);
    writeLocal(PLAYGROUND_KEYS.mood, next);
  };

  const land = useCallback(
    (id: string) => {
      window.clearTimeout(landing.current?.timer);
      landing.current = null;
      setReel(null);
      setRolling(false);
      setCurrent(id);
      writeLocal(PLAYGROUND_KEYS.current, id);
      // A running timer follows the idea on screen: it is one drawing session.
      if (session && session.challengeId !== id) setSession({ ...session, challengeId: id });
      const entry = entries.find((e) => e.id === id);
      setSaid(entry ? t('playground.landed', { title: loc(entry.title) }) : '');
    },
    [entries, loc, session, setSession, t],
  );

  const onSpin = () => {
    if (reel) return;
    const pick = spin(entries, mood, { current, recent });
    if (!pick) {
      setEmpty(true);
      return;
    }
    setEmpty(false);
    const nextRecent = withSpin(recent, pick.id);
    setRecent(nextRecent);
    writeLocal(PLAYGROUND_KEYS.recent, nextRecent);
    const items = reelOf(poolOf(entries, mood), pick, 10);
    const calm = typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (calm || items.length === 1) {
      land(pick.id);
      return;
    }
    setSaid(t('playground.spinning'));
    setReel(items);
    setRolling(false);
    // Start the turn on the next frames, and land even if the transition's end never arrives (a hidden tab).
    window.requestAnimationFrame(() => window.requestAnimationFrame(() => setRolling(true)));
    landing.current = { id: pick.id, timer: window.setTimeout(() => land(pick.id), REEL_MS + 400) };
  };

  return (
    <section aria-labelledby="playground-title" className="mb-8 overflow-hidden rounded-3xl border border-border bg-card shadow-sm" data-playground>
      <div className="bg-gradient-to-b from-primary/10 to-transparent px-4 pb-5 pt-5 sm:px-6">
        <h2 id="playground-title" className="text-xl font-semibold text-foreground sm:text-2xl">
          {t('playground.title')}
        </h2>
        <p className="mt-1 text-[15px] text-foreground/90">{t('playground.lead')}</p>

        <fieldset className="mt-4">
          <legend className="sr-only">{t('playground.mood')}</legend>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4" data-moods>
            {MOODS.map((option) => {
              const Icon = MOOD_ICONS[option];
              const on = mood === option;
              return (
                <label
                  key={option}
                  className={`relative flex min-h-[64px] cursor-pointer flex-col justify-center gap-0.5 rounded-2xl border px-3 py-2 transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring ${
                    on ? 'border-primary bg-primary/15' : 'border-border bg-background/40 hover:border-primary/50'
                  }`}
                  data-mood={option}
                >
                  <input type="radio" name="playground-mood" value={option} checked={on} onChange={() => chooseMood(option)} className="sr-only" />
                  <span className="flex items-center gap-1.5 text-[15px] font-semibold text-foreground">
                    <Icon className={`h-4 w-4 shrink-0 ${on ? 'text-primary' : 'text-foreground/90'}`} aria-hidden="true" />
                    {t(`playground.moods.${option}`)}
                  </span>
                  <span className="text-xs text-foreground/90">{t(`playground.moodHints.${option}`)}</span>
                </label>
              );
            })}
          </div>
        </fieldset>

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button type="button" onClick={onSpin} disabled={!ready || reel !== null} className={`${buttonPrimary} min-w-[10rem]`} data-spin>
            <Dices className={`h-5 w-5 ${reel ? 'motion-safe:animate-spin' : ''}`} aria-hidden="true" /> {current ? t('playground.spinAgain') : t('playground.spin')}
          </button>
          {empty && (
            <p role="status" className="text-sm text-foreground/90" data-playground-empty>
              {t('playground.empty')}
            </p>
          )}
        </div>
      </div>

      <div className="px-4 pb-5 sm:px-6">
        {reel ? (
          <div className="relative h-24 overflow-hidden rounded-2xl border border-border bg-background/60 [mask-image:linear-gradient(transparent,black_30%,black_70%,transparent)]" aria-hidden="true" data-reel>
            <ul
              className="motion-reduce:transition-none"
              style={{
                transform: rolling ? `translateY(-${((reel.length - 1) / reel.length) * 100}%)` : 'translateY(0)',
                transition: rolling ? `transform ${REEL_MS}ms cubic-bezier(0.16, 1, 0.3, 1)` : 'none',
              }}
              onTransitionEnd={() => landing.current && land(landing.current.id)}
            >
              {reel.map((entry, i) => (
                <li key={`${entry.id}-${i}`} className="flex h-24 items-center justify-center px-4 text-center text-lg font-semibold text-foreground sm:text-xl">
                  {loc(entry.title)}
                </li>
              ))}
            </ul>
          </div>
        ) : current && shownEntry ? (
          <article className="animate-in fade-in-0 slide-in-from-bottom-2 duration-300 motion-reduce:animate-none" data-playground-result={current}>
            <div className="mb-2 flex flex-wrap items-center gap-1.5">
              {groupTitle.get(shownEntry.groupId) && (
                <span className="text-xs font-semibold uppercase tracking-wider text-foreground">{loc(groupTitle.get(shownEntry.groupId)!)}</span>
              )}
              {effortOf(shownEntry) && (
                <span className="rounded-full bg-secondary px-2 py-0.5 text-[11px] font-semibold text-foreground" data-effort={effortOf(shownEntry)!}>
                  {t(`challenges.levels.${shownEntry.level!}`)}
                </span>
              )}
            </div>
            <h3 className="text-2xl font-semibold leading-tight text-foreground sm:text-[28px]">
              {loc(shownEntry.title)}
            </h3>
            {item && item.id === current ? (
              <>
                <p className="mt-3 text-lg leading-relaxed text-foreground" data-playground-prompt>
                  {loc(item.prompt)}
                </p>
                {item.twist && (
                  <p className="mt-3 flex gap-2 rounded-xl border border-primary/30 bg-primary/10 px-4 py-3 text-[15px] leading-relaxed text-foreground" data-playground-twist>
                    <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
                    <span>
                      <span className="font-semibold">{t('playground.twist')}:</span> {loc(item.twist)}
                    </span>
                  </p>
                )}
                {item.focus && (
                  <p className="mt-3 text-[15px] leading-relaxed text-foreground" data-playground-tip>
                    {loc(item.focus)}
                  </p>
                )}
                <p className="mt-2 text-sm text-foreground">
                  <span className="font-semibold">{t('item.skill')}:</span> {loc(item.skill)}
                </p>
                {item.references[0] && (
                  <Link href={itemPath(item.id)} className="mt-3 inline-block overflow-hidden rounded-xl border border-border" data-playground-reference>
                    {/* eslint-disable-next-line @next/next/no-img-element -- a private image from the authorized Learn route */}
                    <img src={assetUrl(item.references[0].thumbnailAssetId ?? item.references[0].assetId)} alt={loc(item.references[0].alt)} className="h-24 w-auto object-cover" />
                  </Link>
                )}
              </>
            ) : (
              <div className="mt-3 space-y-2" aria-hidden="true">
                <div className="h-5 w-11/12 animate-pulse rounded bg-secondary motion-reduce:animate-none" />
                <div className="h-5 w-8/12 animate-pulse rounded bg-secondary motion-reduce:animate-none" />
              </div>
            )}

            <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-start">
              <SaveToggle id={current} saved={saved.includes(current)} onToggle={toggleSave} />
              {!classMode.on && <MarkDone itemId={current} />}
              <Link href={itemPath(current)} className={buttonSecondary} data-playground-open>
                {t('playground.open')}
              </Link>
            </div>
            <ChallengeTimer session={session} onChange={setSession} challengeId={current} />
          </article>
        ) : (
          <p className="rounded-2xl border border-dashed border-border px-4 py-6 text-center text-[15px] text-foreground/90" data-playground-idle>
            {t('playground.idle')}
          </p>
        )}
        <p aria-live="polite" className="sr-only">
          {said}
        </p>
      </div>
    </section>
  );
}
