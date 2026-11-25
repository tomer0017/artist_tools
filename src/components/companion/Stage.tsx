import { ArtScene, ART_SCENES, SCENES, type ArtSceneId } from './ArtScene';
import { artLayout } from './art-layout';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { useLocale, useTranslations } from 'use-intl';
import { dayOf, mayOffer, pickTip, remember, snooze, type Context, type Memory } from '@/lib/companion/brain';
import { canRun } from '@/lib/companion/registry';
import type { AnimationId, Audience, CompanionTip, Mood, ScreenId, TipAction, TriggerId } from '@/lib/companion/model';
import { classModeOn } from '@/lib/learn/class-mode';
import { useAccount } from '@/components/shell/account';
import { useCourseStart } from '@/components/learn/useCourseStart';
import { CLIPS } from './clips';
import { geometryOf, signPlacement, type Geometry, type Measured } from './geometry';
import { Menu } from './Menu';
import { PRIORITY, useSketchyPresence } from './presence';
import { walkCycle, walkSpeed } from './raster-engine';
import { preloadSketchy } from './raster-mesh';
import { Roulette } from './Roulette';
import { Sign } from './Sign';
import { Sketchy, type SketchyHandle } from './Sketchy';
import { useAbilities, useRunAction, type MenuView } from './actions';
import { loadMemory, saveMemory, stageMounted, takePending, useCompanionEvents, useCompanionPrefs, useLastTool, useReducedMotion, type CompanionEvent, type CompanionView } from './state';

// ─── The stage (ADR-0024) ──────────────────────────────────────────────────────
// Sketchy's home: the artwork side of Home's hero (left in Hebrew, right in
// English), on the hero's floor line, never over the headline, never above
// the top limit, never below the hero (geometry.ts). He scrolls away with the
// hero like the rest of the page; out of view he stops completely.
//   - Once a visit he walks in from the side of the hero (his drawn walking
//     cycle, in step with the ground he covers); back on Home later he is
//     simply there.
//   - He lives there calmly, one thing at a time, each to its end, with quiet
//     pauses between: a stroll to another spot, sitting for a while, drawing
//     in his sketchbook, thinking, looking around, now and then a laugh. The
//     pointer close by gets a wave; his eyes follow it; after minutes without
//     anyone around he dozes, and wakes when someone is.
//   - Now and then he pulls out his wooden sign with a suggestion that fits
//     (the screen, the tool used last, who the person is, what their plan
//     opens) and a real button; a challenge to spin comes with a little jump.
//     The pace, the daily cap and "Not now" are the admin's
//     (../../lib/companion/brain).
//   - After a save or a completed lesson or challenge he celebrates once and
//     may suggest a next step.
//   - A click (or Enter) opens his menu at once.
//   - While the roulette (or anything else showing its own Sketchy) is open he
//     is not drawn at all (presence.ts); he is back when it closes.
// In a hidden tab he stops. With reduced motion he does not walk: he appears,
// and every pose is still.

export interface StageProps {
  screen: ScreenId;
  /** The element he lives in (position: relative); his floor, text to avoid and top limit are found inside it. */
  containerRef: RefObject<HTMLElement | null>;
  /** He stands on this element's bottom edge (or on the first match of `floorSelector` inside the container). */
  floorRef?: RefObject<HTMLElement | null>;
  floorSelector?: string;
  /** Stand on the floor element's bottom edge (Home's hero) or its top edge. */
  floorEdge?: 'top' | 'bottom';
  view: CompanionView;
}

type Phase = 'waiting' | 'entering' | 'idle' | 'acting' | 'sign' | 'leaving';
type Posture = 'stand' | 'sit' | 'doze';
type Activity = 'stroll' | 'sit' | 'draw' | 'think' | 'look' | 'laugh';

const QUIET_MS = 4000;
const SIGN_TIMEOUT_MS = 45_000;
/** The calm pause between two things he does on his own (ms). */
const PAUSE = { min: 11_000, max: 22_000 };
/** The pointer this close (CSS pixels) wakes him, and now and then gets a wave. */
const NEAR = 140;
const WAVE_EVERY_MS = 45_000;

/** This visit (until the page is reloaded): he walks in once and says hello once. */
const visit = { entered: false, greeted: false };

const between = (min: number, max: number) => min + Math.random() * (max - min);

function measureStage(container: HTMLElement, floor: HTMLElement, edge: 'top' | 'bottom' = 'bottom'): Measured | null {
  const c = container.getBoundingClientRect();
  const f = floor.getBoundingClientRect();
  if (c.width === 0 || f.height === 0) return null;
  const rtl = getComputedStyle(container).direction === 'rtl';
  const floorY = (edge === 'top' ? f.top : f.bottom) - c.top - 2;
  const top = container.querySelector<HTMLElement>('[data-sketchy-top]');
  const topLimit = (top ? top.getBoundingClientRect().bottom - c.top : edge === 'top' ? 0 : f.top - c.top) + 6;
  // Only text in the band where he stands (between the top limit and the floor) has to stay clear.
  let textEnd = 0;
  for (const el of container.querySelectorAll<HTMLElement>('[data-sketchy-avoid]')) {
    const range = document.createRange();
    range.selectNodeContents(el);
    for (const r of range.getClientRects()) {
      if (r.width === 0 || r.bottom - c.top < topLimit || r.top - c.top > floorY) continue;
      textEnd = Math.max(textEnd, rtl ? c.right - r.left : r.right - c.left);
    }
  }
  return { width: c.width, floor: floorY, textEnd, topLimit, rtl, narrow: window.innerWidth < 768 };
}

export function Stage({ screen, containerRef, floorRef: floorRefProp, floorSelector, floorEdge = 'bottom', view }: StageProps) {
  // The floor: the element given, or found inside the container when the stage cannot reach it directly.
  const floorRef = useMemo<RefObject<HTMLElement | null>>(
    () => ({
      get current() {
        return floorRefProp?.current ?? (floorSelector ? (containerRef.current?.querySelector<HTMLElement>(floorSelector) ?? null) : null);
      },
    }),
    [containerRef, floorRefProp, floorSelector],
  );
  const t = useTranslations('companion');
  const locale = useLocale() === 'he' ? 'he' : 'en';
  const account = useAccount();
  const userId = account?.account.id ?? '';
  const audienceSaid = account?.account.companion?.audience ?? null;
  const reduced = useReducedMotion();
  const lastTool = useLastTool();
  const settings = view.settings;
  const can = useAbilities(view.features);
  const { save: savePrefs } = useCompanionPrefs();
  // He is drawn only while nothing else shows its own Sketchy (the roulette).
  const owns = useSketchyPresence(`stage:${screen}`, PRIORITY.stage);

  const [geo, setGeo] = useState<Geometry | null>(null);
  // Read the latest geometry inside callbacks that outlive a render (his entrance, a sign shown later).
  const geoRef = useRef(geo);
  geoRef.current = geo;
  const [x, setX] = useState<number | null>(null);
  const [facing, setFacing] = useState<'left' | 'right'>('left');
  const facingRef = useRef(facing);
  facingRef.current = facing;
  const [moveMs, setMoveMs] = useState(0);
  const [faded, setFaded] = useState(true);
  const [pageShown, setPageShown] = useState(() => typeof document === 'undefined' || document.visibilityState === 'visible');
  const [arrived, setArrived] = useState(false);
  const [inView, setInView] = useState(true);
  const [tip, setTip] = useState<CompanionTip | null>(null);
  const [signPos, setSignPos] = useState<{ left: number; top: number; width: number; below: boolean; maxHeight: number | null } | null>(null);
  const [menu, setMenu] = useState<MenuView | null>(null);
  const [menuPos, setMenuPos] = useState<{ left: number; top: number } | null>(null);
  const [roulette, setRoulette] = useState<{ mood?: Mood; classMode?: boolean } | null>(null);
  const [said, setSaid] = useState('');
  const [art, setArt] = useState<ArtSceneId | null>(null);
  const nextArtAt = useRef(Date.now() + 90_000);
  const artIndex = useRef(0);

  const fox = useRef<SketchyHandle>(null);
  const foxBox = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const signEl = useRef<HTMLDivElement>(null);
  const menuEl = useRef<HTMLDivElement>(null);
  const phase = useRef<Phase>('waiting');
  const posture = useRef<Posture>('stand');
  const memory = useRef<Memory | null>(null);
  const timers = useRef(new Set<number>());
  const lastInput = useRef(0);
  const arrivedAt = useRef(Date.now());
  const xNow = useRef<number | null>(null);
  const spotIndex = useRef(0);
  /** When he next does something on his own. */
  const nextActAt = useRef(Date.now() + 9_000);
  const lastWave = useRef(0);
  /** Only the newest quiet loop runs (each effect run starts a new one). */
  const loop = useRef(0);
  /** Each walk in or out; a newer one (or hiding him) stops an older one where it is. */
  const moves = useRef(0);
  /** What he is doing on his own; anything the person asks for ends it. */
  const deeds = useRef(0);
  /** His hello on this visit; asking for him (a click) cancels one still on its way. */
  const hello = useRef(0);
  const menuOpen = useRef(false);
  menuOpen.current = menu !== null;
  const alive = useRef(true);

  const classMode = (() => {
    try {
      return classModeOn(window.sessionStorage);
    } catch {
      return false;
    }
  })();
  const audience: Audience | null = audienceSaid ?? (classMode ? 'teacher' : null);
  const course = useCourseStart(can.course === 'open' && !classMode);
  const nextLesson = useMemo(() => (can.course === 'open' ? { href: course.href, label: course.label, loading: course.loading } : null), [can.course, course.href, course.label, course.loading]);

  // ── helpers ────────────────────────────────────────────────────────────────
  const later = useCallback((ms: number, fn: () => void) => {
    const id = window.setTimeout(() => {
      timers.current.delete(id);
      if (alive.current) fn();
    }, ms);
    timers.current.add(id);
    return id;
  }, []);
  const wait = useCallback((ms: number) => new Promise<void>((resolve) => later(ms, resolve)), [later]);
  const clearTimers = useCallback(() => {
    for (const id of timers.current) window.clearTimeout(id);
    timers.current.clear();
  }, []);
  useEffect(() => stageMounted(), []);
  useEffect(
    () => () => {
      alive.current = false;
      clearTimers();
    },
    [clearTimers],
  );

  const allowed = useCallback((id: AnimationId) => settings.animations[id] !== false, [settings.animations]);
  /** A clip, or a calmer one when the admin switched it off. */
  const choose = useCallback(
    (id: AnimationId): AnimationId => {
      const fallbacks: Partial<Record<AnimationId, AnimationId[]>> = {
        celebrate: ['jump', 'wave'],
        jump: ['celebrate', 'wave'],
        laugh: ['wave'],
        rest: ['sit'],
        sit: ['idle'],
        draw: ['think'],
        curious: ['think'],
        think: ['curious'],
        point: ['holdSign'],
      };
      for (const c of [id, ...(fallbacks[id] ?? [])]) if (allowed(c)) return c;
      return 'idle';
    },
    [allowed],
  );
  /** Play a clip to its end (one that ends), or for `ms` (one that loops). */
  const play = useCallback(
    (id: AnimationId, ms = 1600, params?: { aim?: number }) =>
      new Promise<void>((resolve) => {
        const clip = choose(id);
        if (!fox.current) return resolve();
        if (CLIPS[clip].loop || reduced) {
          fox.current.play(clip, { params });
          later(reduced ? Math.min(ms, 900) : ms, resolve);
        } else fox.current.play(clip, { params, onEnd: () => resolve(), restart: true });
      }),
    [choose, later, reduced],
  );
  /** Whatever he was doing on his own ends here. */
  const interrupt = useCallback(() => {
    deeds.current += 1;
    setArt(null);
    if (phase.current === 'acting') phase.current = 'idle';
  }, []);
  /** Back to standing quietly. */
  const settle = useCallback(() => {
    posture.current = 'stand';
    if (phase.current === 'idle') fox.current?.play('idle');
    nextActAt.current = Math.max(nextActAt.current, Date.now() + PAUSE.min);
  }, []);
  /** Up from sitting or dozing, without a fuss. */
  const wake = useCallback(() => {
    if (posture.current === 'stand' || (phase.current !== 'idle' && phase.current !== 'acting')) return;
    interrupt();
    settle();
  }, [interrupt, settle]);

  const persist = useCallback(
    (next: Memory) => {
      memory.current = next;
      if (userId) saveMemory(userId, next);
    },
    [userId],
  );

  // ── his room in the hero ───────────────────────────────────────────────────
  // Measured once the page is in place: a layout effect would run before the container (an ancestor)
  // has its ref when Home and his stage mount together (coming back to Home), and he would never appear.
  useEffect(() => {
    const container = containerRef.current;
    const floor = floorRef.current;
    if (!container || !floor) return;
    const update = () => {
      const measured = measureStage(container, floor, floorEdge);
      const next = measured ? geometryOf(measured, settings.size) : null;
      setGeo((was) => (JSON.stringify(was) === JSON.stringify(next) ? was : next));
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(container);
    observer.observe(floor);
    window.addEventListener('orientationchange', update);
    // Web fonts change where the text ends.
    void document.fonts?.ready.then(update).catch(() => {});
    return () => {
      observer.disconnect();
      window.removeEventListener('orientationchange', update);
    };
  }, [containerRef, floorRef, floorEdge, settings.size]);

  // The room changed (rotation, resizing): he is on a valid spot at once.
  useEffect(() => {
    if (!geo || xNow.current === null || phase.current === 'waiting' || phase.current === 'entering' || phase.current === 'leaving') return;
    spotIndex.current = Math.min(spotIndex.current, geo.spots.length - 1);
    const spot = geo.spots[spotIndex.current];
    interrupt();
    xNow.current = spot;
    setMoveMs(0);
    setX(spot);
    setFacing(geo.facing);
  }, [geo]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── a hidden tab, or the hero scrolled away: he stops ──────────────────────
  useEffect(() => {
    const onVis = () => setPageShown(document.visibilityState === 'visible');
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, []);
  useEffect(() => {
    const el = foxBox.current;
    if (!el || !arrived) return;
    const io = new IntersectionObserver(([entry]) => setInView(entry.isIntersecting), { threshold: 0 });
    io.observe(el);
    return () => io.disconnect();
  }, [arrived, owns]);
  const shown = pageShown && inView;

  useEffect(() => {
    if (art && (reduced || !settings.idleLife || (geo && !artLayout(SCENES[art], geo, geo.spots[0])) ||
      (art === 'dream' ? !allowed('rest') || !allowed('sit') : SCENES[art].action === 'roulette' ? !allowed('point') || !can.companion('roulette') || can.challenges !== 'open' : !allowed('draw') || !allowed('sit')))) {
      interrupt();
      settle();
    }
  }, [art, geo, reduced, settings.idleLife, allowed, can, interrupt, settle]);

  // ── suggestions ────────────────────────────────────────────────────────────
  const contextFor = useCallback(
    (trigger: TriggerId): Context => {
      const now = Date.now();
      return { screen, trigger, audience, lastTool, can: (action: TipAction) => canRun(action, can), now, today: dayOf(now) };
    },
    [audience, can, lastTool, screen],
  );

  const placeSign = useCallback(() => {
    const container = containerRef.current;
    const floor = floorRef.current;
    const sign = signEl.current;
    const box = foxBox.current;
    const g = geoRef.current;
    if (!container || !floor || !sign || !box || !g) return;
    const c = container.getBoundingClientRect();
    const r = box.getBoundingClientRect();
    const at = { left: r.left - c.left, right: r.right - c.left, top: r.top - c.top, height: r.height };
    const room = { width: c.width, topLimit: measureStage(container, floor, floorEdge)?.topLimit ?? 8, floor: g.floor };
    // Two steps: the width first (the text wraps to it), then the height it takes.
    const first = signPlacement(at, sign.offsetHeight, room, facingRef.current);
    sign.style.width = `${first.width}px`;
    setSignPos(signPlacement(at, sign.offsetHeight, room, facingRef.current));
  }, [containerRef, floorRef, floorEdge]);

  const closeSign = useCallback(
    (snoozed: boolean) => {
      setTip((shown) => {
        // Only "Not now" asks for quiet (and not on his introduction); closing the sign just closes it.
        if (snoozed && shown && shown.trigger !== 'firstVisit') persist(snooze(memory.current!, settings.snoozeHours, Date.now()));
        return null;
      });
      setSignPos(null);
      phase.current = 'idle';
      settle();
    },
    [persist, settle, settings.snoozeHours],
  );

  /** He pulls out his sign with a suggestion; a challenge to spin (or an excited tip) gets a little jump first. */
  const present = useCallback(
    async (next: CompanionTip) => {
      if (!fox.current || !geoRef.current) return;
      interrupt();
      phase.current = 'sign';
      posture.current = 'stand';
      const now = Date.now();
      persist(remember(memory.current!, next, now, dayOf(now)));
      const excited = next.action.type === 'roulette' || next.action.type === 'classRoulette' || next.animation === 'jump' || next.animation === 'celebrate';
      if (excited && !reduced) await play('jump');
      if (!alive.current || phase.current !== 'sign') return;
      // The person opened his menu meanwhile: that comes first.
      if (menuOpen.current) {
        phase.current = 'idle';
        return;
      }
      fox.current?.play(choose('holdSign'));
      setSignPos(null);
      setTip(next);
      setSaid(t('said', { text: next.text[locale] }));
      later(SIGN_TIMEOUT_MS, () => {
        if (phase.current === 'sign') closeSign(false);
      });
    },
    [choose, closeSign, interrupt, later, locale, persist, play, reduced, t],
  );

  const offer = useCallback(
    (trigger: TriggerId): boolean => {
      if (!memory.current || !can.companion('tips')) return false;
      const ctx = contextFor(trigger);
      if (!mayOffer(trigger, settings, memory.current, ctx.now, ctx.today)) return false;
      const next = pickTip(view.tips, ctx, memory.current);
      if (!next) return false;
      void present(next);
      return true;
    },
    [can, contextFor, present, settings, view.tips],
  );

  // ── actions ────────────────────────────────────────────────────────────────
  const openMenu = useCallback((v: MenuView) => {
    setTip(null);
    setSignPos(null);
    setMenuPos(null);
    setMenu(v);
  }, []);
  const openRoulette = useCallback(
    (o: { mood?: Mood; classMode?: boolean }) => {
      interrupt();
      setMenu(null);
      setTip(null);
      setSignPos(null);
      if (phase.current === 'sign') phase.current = 'idle';
      setRoulette(o);
    },
    [interrupt],
  );
  const host = useMemo(() => ({ openRoulette, openMenu, nextLessonHref: nextLesson && !nextLesson.loading ? nextLesson.href : null }), [nextLesson, openMenu, openRoulette]);
  const runAction = useRunAction(host, can);

  const drawingTips = useMemo(() => view.tips.filter((tp) => tp.trigger === 'menu' && canRun(tp.action, can)), [view.tips, can]);
  const pickDrawingTip = useCallback((): CompanionTip | null => {
    if (!memory.current) return null;
    const ctx = contextFor('menu');
    const next = pickTip(drawingTips, ctx, memory.current);
    if (next) persist(remember(memory.current, next, ctx.now, ctx.today));
    return next;
  }, [contextFor, drawingTips, persist]);

  const surprise = useCallback(() => {
    const options: (() => void)[] = [];
    if (can.companion('roulette') && can.challenges === 'open') options.push(() => openRoulette({ mood: 'surprise' }));
    if (can.companion('guide') && drawingTips.length > 0) options.push(() => setMenu('tip'));
    if (can.companion('guide') && nextLesson && !nextLesson.loading) options.push(() => runAction({ type: 'nextLesson', label: { en: '', he: '' } }));
    const idleTip = memory.current ? pickTip(view.tips, contextFor('idle'), memory.current) : null;
    if (idleTip) options.push(() => void present(idleTip));
    if (options.length === 0) return;
    setMenu(null);
    options[Math.floor(Math.random() * options.length)]();
  }, [can, contextFor, drawingTips.length, nextLesson, openRoulette, present, runAction, view.tips]);

  // ── walking ────────────────────────────────────────────────────────────────
  /** Walk to `target` (his drawn walking cycle, in step with the ground he covers). */
  const walkTo = useCallback(
    (target: number) =>
      new Promise<void>((resolve) => {
        const g = geoRef.current;
        if (!g) return resolve();
        const from = xNow.current ?? target;
        const dist = Math.abs(target - from);
        if (dist < 2) return resolve();
        if (reduced || !allowed('walk')) {
          setMoveMs(0);
          setFaded(true);
          later(220, () => {
            xNow.current = target;
            setX(target);
            setFaded(false);
            resolve();
          });
          return;
        }
        setFacing(target < from ? 'left' : 'right');
        const pxPerSec = walkSpeed(g.height, settings.speed);
        fox.current?.play('walk', { params: { cycle: walkCycle(settings.speed) } });
        const ms = Math.round((dist / pxPerSec) * 1000);
        setMoveMs(ms);
        xNow.current = target;
        setX(target);
        later(ms + 30, resolve);
      }),
    [allowed, later, reduced, settings.speed],
  );

  /** Stop where he is now (on his way somewhere). */
  const stopHere = useCallback(() => {
    const box = foxBox.current;
    const container = containerRef.current;
    const g = geoRef.current;
    if (!box || !container || !g) return;
    const r = box.getBoundingClientRect();
    const here = r.left + r.width / 2 - container.getBoundingClientRect().left;
    moves.current += 1;
    xNow.current = here;
    setMoveMs(0);
    setX(here);
    setFaded(false);
    setFacing(g.facing);
  }, [containerRef]);

  const hide = useCallback(async (): Promise<boolean> => {
    const ok = await savePrefs({ hidden: true }, { refresh: false });
    if (!ok) return false;
    setMenu(null);
    interrupt();
    phase.current = 'leaving';
    moves.current += 1;
    clearTimers();
    await play('wave', 1800);
    const g = geoRef.current;
    if (g && !reduced && allowed('walk')) await walkTo(g.offstage);
    else {
      setFaded(true);
      await wait(350);
    }
    await account?.refresh();
    return true;
  }, [account, allowed, clearTimers, interrupt, play, reduced, savePrefs, wait, walkTo]);

  const finishArt = useCallback(() => {
    setArt(null);
    if (phase.current === 'acting') phase.current = 'idle';
    posture.current = 'stand';
    fox.current?.play('idle');
    nextActAt.current = Date.now() + PAUSE.max;
  }, []);

  // ── what he does on his own, one thing at a time, each to its end ──────────
  const act = useCallback(async () => {
    const g = geoRef.current;
    if (!g || !fox.current) return;
    const deed = ++deeds.current;
    const still = () => deed === deeds.current && alive.current && phase.current === 'acting';
    phase.current = 'acting';
    posture.current = 'stand';
    // Rare, complete scenes; existing animation toggles and capability gates still apply.
    if (screen === 'home' && !reduced && settings.idleLife && Date.now() >= nextArtAt.current) {
      const permitted = ART_SCENES.filter(id => artLayout(SCENES[id], g, g.spots[0])).filter(id => SCENES[id].action === 'roulette'
        ? allowed('point') && can.companion('roulette') && can.challenges === 'open'
        : id === 'dream' ? allowed('rest') && allowed('sit')
        : allowed('draw') && allowed('sit'));
      nextArtAt.current = Date.now() + Math.max(180_000, settings.wanderEverySec * 1000);
      if (permitted.length) {
        const id = permitted[artIndex.current++ % permitted.length];
        const image = new Image();
        image.src = SCENES[id].src;
        try { await image.decode(); } catch { finishArt(); return; }
        if (!still()) return;
        fox.current?.play('idle');
        setArt(id);
        return;
      }
    }
    const choices: [Activity, number][] = [
      ['sit', 2],
      ['draw', 2],
      ['think', 1.5],
      ['look', 1.5],
      ['laugh', 0.5],
    ];
    if (settings.wander && !g.compact && g.spots.length > 1) choices.unshift(['stroll', 3]);
    let roll = Math.random() * choices.reduce((sum, [, w]) => sum + w, 0);
    let doing: Activity = choices[0][0];
    for (const [what, w] of choices) {
      roll -= w;
      if (roll < 0) {
        doing = what;
        break;
      }
    }
    if (doing === 'stroll') {
      const others = g.spots.map((_, i) => i).filter((i) => i !== spotIndex.current);
      spotIndex.current = others[Math.floor(Math.random() * others.length)] ?? 0;
      await walkTo(g.spots[spotIndex.current]);
      if (!still()) return;
      setFacing(g.facing);
      fox.current?.play('idle');
      await wait(1500);
    } else if (doing === 'sit') {
      posture.current = 'sit';
      fox.current?.play(choose('sit'));
      await wait(between(14_000, 22_000));
    } else if (doing === 'draw') {
      fox.current?.play(choose('draw'));
      await wait(between(7_000, 10_000));
    } else if (doing === 'think') await play('think', CLIPS.think.duration * 1000);
    else if (doing === 'look') await play('curious', CLIPS.curious.duration * 1000);
    else await play('laugh');
    if (!still()) return;
    phase.current = 'idle';
    posture.current = 'stand';
    fox.current?.play('idle');
    nextActAt.current = Date.now() + between(PAUSE.min, PAUSE.max);
  }, [choose, play, settings.wander, settings.wanderEverySec, settings.idleLife, wait, walkTo, screen, reduced, allowed, can, finishArt]);

  /** His hello on this visit: the introduction, a celebration of what just happened, or the day's greeting. */
  const greet = useCallback(
    async (walkedIn: boolean) => {
      visit.greeted = true;
      const token = ++hello.current;
      const still = () => token === hello.current && alive.current;
      const pending = takePending();
      const firstTime = memory.current!.metAt === null;
      if (firstTime) {
        if (walkedIn) await play('wave', 1800);
        if (!still()) return;
        // His introduction, on his sign.
        const intro = pickTip(view.tips, contextFor('firstVisit'), memory.current!);
        if (intro) return void present(intro);
        persist({ ...memory.current!, metAt: Date.now() });
      } else if (pending && settings.celebrate) {
        await play(choose('celebrate'));
        if (!still()) return;
        if (offer(pending.type === 'saved' ? 'afterSave' : 'afterComplete')) return;
      } else {
        if (walkedIn) await play('wave', 1800);
        if (!still()) return;
        if (offer('arrive')) return;
      }
      if (phase.current === 'idle') settle();
    },
    [choose, contextFor, offer, persist, play, present, settings.celebrate, settle, view.tips],
  );

  // ── his entrance: once a visit, walking in from the side of the hero ───────
  useEffect(() => {
    if (!geo || !userId || phase.current !== 'waiting') return;
    memory.current = loadMemory(userId);
    phase.current = 'entering';
    const move = ++moves.current;
    const walkIn = !visit.entered && !reduced && allowed('walk');
    visit.entered = true;
    const spot = geo.spots[0];
    spotIndex.current = 0;
    xNow.current = walkIn ? geo.offstage : spot;
    setMoveMs(0);
    setX(xNow.current);
    setFacing(geo.facing);
    setFaded(walkIn);
    void (async () => {
      // His artwork is ready before he moves (never a still picture sliding in).
      await Promise.all([preloadSketchy(), wait(walkIn ? Math.max(300, settings.firstDelaySec * 1000) : 0)]);
      if (move !== moves.current || !alive.current) return;
      setFaded(false);
      if (walkIn) await walkTo(spot);
      if (move !== moves.current || !alive.current) return;
      setFacing(geo.facing);
      phase.current = 'idle';
      posture.current = 'stand';
      arrivedAt.current = Date.now();
      nextActAt.current = Date.now() + between(PAUSE.min, PAUSE.max);
      setArrived(true);
      fox.current?.play('idle');
      if (!visit.greeted) await greet(walkIn);
    })();
  }, [geo, userId]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── the person's input (he never interrupts it), the pointer and taps ──────
  useEffect(() => {
    const container = containerRef.current;
    const area = container?.closest('.overflow-y-auto') ?? window;
    const input = () => {
      lastInput.current = Date.now();
    };
    let px = 0;
    let py = 0;
    let queued = 0;
    let glance = 0;
    const aim = () => {
      queued = 0;
      const box = foxBox.current;
      if (!box || !fox.current) return;
      const r = box.getBoundingClientRect();
      const dx = px - (r.left + r.width / 2);
      const dy = py - (r.top + r.height * 0.32);
      const d = Math.hypot(dx, dy);
      if (d < NEAR) {
        input();
        wake();
        // Someone came to see him: now and then, a wave.
        if (phase.current === 'idle' && Date.now() - lastWave.current > WAVE_EVERY_MS && allowed('wave')) {
          lastWave.current = Date.now();
          const deed = ++deeds.current;
          phase.current = 'acting';
          void play('wave').then(() => {
            if (deed !== deeds.current || phase.current !== 'acting') return;
            phase.current = 'idle';
            fox.current?.play('idle');
          });
        }
      }
      // His own frame: forward is the way he faces; close by he looks less far.
      const toward = facingRef.current === 'left' ? -1 : 1;
      const reach = Math.min(1, d / 160);
      fox.current.look({ x: (dx / Math.max(d, 1)) * reach * toward, y: (dy / Math.max(d, 1)) * reach });
    };
    const onMove = (event: PointerEvent) => {
      if (event.pointerType !== 'mouse') return;
      px = event.clientX;
      py = event.clientY;
      if (!queued) queued = window.requestAnimationFrame(aim);
    };
    const onOut = (event: MouseEvent) => {
      if (!event.relatedTarget) fox.current?.look(null);
    };
    const onDown = (event: PointerEvent) => {
      input();
      if (event.pointerType === 'mouse' || foxBox.current?.contains(event.target as Node)) return;
      // A tap elsewhere: a quick glance toward it.
      px = event.clientX;
      py = event.clientY;
      aim();
      window.clearTimeout(glance);
      glance = window.setTimeout(() => fox.current?.look(null), 1400);
    };
    window.addEventListener('pointerdown', onDown, { passive: true });
    window.addEventListener('keydown', input);
    window.addEventListener('pointermove', onMove, { passive: true });
    document.addEventListener('mouseout', onOut);
    area.addEventListener('scroll', input, { passive: true });
    return () => {
      window.cancelAnimationFrame(queued);
      window.clearTimeout(glance);
      window.removeEventListener('pointerdown', onDown);
      window.removeEventListener('keydown', input);
      window.removeEventListener('pointermove', onMove);
      document.removeEventListener('mouseout', onOut);
      area.removeEventListener('scroll', input);
    };
  }, [allowed, containerRef, play, wake]);

  // ── the quiet loop: a suggestion now and then, something to do, dozing after a long quiet ──
  useEffect(() => {
    if (!geo || !shown || !owns) return;
    const generation = ++loop.current;
    const tick = () => {
      if (!alive.current || generation !== loop.current) return;
      const now = Date.now();
      const busy = phase.current !== 'idle' || menu !== null || roulette !== null || tip !== null;
      if (!busy && now - lastInput.current > QUIET_MS) {
        if (now - arrivedAt.current >= settings.tipAfterSec * 1000 && offer('idle')) return;
        // Nobody around for a long while: he dozes off (a tap or the pointer near wakes him).
        if (posture.current !== 'doze' && now - Math.max(lastInput.current, arrivedAt.current) >= settings.restAfterSec * 1000 && allowed('rest')) {
          posture.current = 'doze';
          fox.current?.play('rest');
        } else if (posture.current !== 'doze' && now >= nextActAt.current) void act();
      }
      later(1000, tick);
    };
    const id = later(1000, tick);
    const held = timers.current;
    return () => {
      // Stops this loop: its pending tick returns at once.
      loop.current += 1;
      window.clearTimeout(id);
      held.delete(id);
    };
  }, [geo, shown, owns, menu, roulette, tip, settings, offer, later, allowed, act]);

  // ── good news from elsewhere on the page ───────────────────────────────────
  const onEvent = useCallback(
    (event: CompanionEvent) => {
      if (!settings.celebrate || (phase.current !== 'idle' && phase.current !== 'acting') || menu !== null || roulette !== null) return;
      takePending();
      if (phase.current === 'acting') stopHere();
      interrupt();
      posture.current = 'stand';
      void play(choose('celebrate')).then(() => {
        if (!offer(event.type === 'saved' ? 'afterSave' : 'afterComplete') && phase.current === 'idle') settle();
      });
    },
    [choose, interrupt, menu, offer, play, roulette, settings.celebrate, settle, stopHere],
  );
  useCompanionEvents(onEvent);

  // ── the menu's place: above him, beside him, or (narrow screens) just below his feet ──
  useLayoutEffect(() => {
    const container = containerRef.current;
    const floor = floorRef.current;
    if (!menu || !menuEl.current || !container || !floor || !geo || xNow.current === null) return;
    const c = container.getBoundingClientRect();
    const m = menuEl.current;
    const top = measureStage(container, floor, floorEdge)?.topLimit ?? 8;
    const foxLeft = xNow.current - geo.width / 2;
    const foxRight = xNow.current + geo.width / 2;
    const above = geo.floor - geo.height - m.offsetHeight - 6;
    const roomBeside = facing === 'left' ? foxLeft - 12 : c.width - foxRight - 12;
    let left: number;
    let at: number;
    if (above >= top) {
      left = xNow.current - m.offsetWidth / 2;
      at = above;
    } else if (roomBeside >= m.offsetWidth) {
      left = facing === 'left' ? foxLeft - m.offsetWidth - 4 : foxRight + 4;
      at = Math.max(top, geo.floor - m.offsetHeight);
    } else {
      left = xNow.current - m.offsetWidth / 2;
      at = geo.floor + 6;
    }
    setMenuPos({ left: Math.round(Math.min(Math.max(8, left), Math.max(8, c.width - m.offsetWidth - 8))), top: Math.round(at) });
    window.requestAnimationFrame(() => m.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' }));
  }, [menu, geo, facing, containerRef, floorRef, floorEdge]);

  // Below him there is no post to hold: he points down at the sign instead.
  useEffect(() => {
    if (signPos?.below && allowed('point')) fox.current?.play('point', { params: { aim: 75 } });
  }, [signPos?.below, allowed]);

  useLayoutEffect(() => {
    if (!tip) return;
    // The sign takes its place once he holds the post up (the next frames), and again when the room changes.
    placeSign();
    const id = later(320, placeSign);
    return () => window.clearTimeout(id);
  }, [tip, placeSign, geo, later]);

  // Escape on a sign closes it (the menu handles its own).
  useEffect(() => {
    if (!tip) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeSign(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [tip, closeSign]);

  const onFoxClick = () => {
    if (phase.current === 'leaving') return;
    // Asked for: what he was doing stops where he is, and no hello comes on top.
    if (phase.current === 'entering' || phase.current === 'acting') {
      stopHere();
      arrivedAt.current = Date.now();
      setArrived(true);
    }
    interrupt();
    phase.current = phase.current === 'sign' ? 'sign' : 'idle';
    visit.greeted = true;
    hello.current += 1;
    posture.current = 'stand';
    if (menu) {
      setMenu(null);
      settle();
      return;
    }
    if (tip) {
      setTip(null);
      setSignPos(null);
      phase.current = 'idle';
    }
    fox.current?.play('idle');
    setMenu('main');
  };

  const closeMenu = useCallback(() => {
    setMenu(null);
    button.current?.focus({ preventScroll: true });
    settle();
  }, [settle]);

  const onSignAction = () => {
    if (!tip) return;
    const action = tip.action;
    setTip(null);
    setSignPos(null);
    phase.current = 'idle';
    if (!memory.current!.metAt) persist({ ...memory.current!, metAt: Date.now() });
    settle();
    runAction(action);
  };

  if (!geo || x === null) return <div aria-hidden="true" className="hidden" data-sketchy-stage="waiting" />;

  const top = geo.floor - geo.height;
  const artBox = art ? artLayout(SCENES[art], geo, x) : null;
  const artAction = art && SCENES[art].action === 'roulette' ? () => { finishArt(); openRoulette({mood:'surprise'}); }
    : can.companion('guide') ? () => { finishArt(); openMenu(art === 'portrait' || art === 'mona-lisa' ? 'improve' : 'tip'); } : undefined;
  return (
    <div className="pointer-events-none absolute inset-0 z-20 overflow-hidden" data-sketchy-stage={screen} data-sketchy-compact={geo.compact || undefined} data-sketchy-motion={reduced ? 'reduced' : 'full'}>
      {owns && (
        <div
          ref={foxBox}
          className="pointer-events-none absolute left-0 top-0"
          style={{
            transform: `translate3d(${Math.round(x - geo.width / 2)}px, ${Math.round(top)}px, 0)`,
            transition: `transform ${moveMs}ms linear, opacity 320ms ease`,
            opacity: faded ? 0 : 1,
            visibility: art && artBox ? 'hidden' : undefined,
            width: geo.width,
            height: geo.height,
          }}
          data-sketchy-fox=""
        >
          {/* Only his head and body take a tap; around him (the tail, the air) the page stays clickable. */}
          <button
            ref={button}
            type="button"
            onClick={onFoxClick}
            aria-label={t('button')}
            aria-expanded={menu !== null}
            aria-haspopup="dialog"
            className="pointer-events-auto absolute inset-x-[22%] bottom-[3%] top-[5%] rounded-[45%] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            data-sketchy-button=""
          />
          <div className="pointer-events-none absolute inset-0">
            <Sketchy ref={fox} height={geo.height} facing={facing} reducedMotion={reduced} idleLife={settings.idleLife} paused={!shown || art !== null || roulette !== null} initial="idle" />
          </div>
        </div>
      )}

      {owns && art && artBox && !menu && !tip && !roulette && (
        <div className="absolute" style={artBox}>
          <ArtScene key={art} id={art} locale={locale} paused={!shown} reducedMotion={reduced} onEnd={finishArt} onAction={artAction} onInspect={onFoxClick}/>
        </div>
      )}

      {owns && tip && (
        <Sign
          ref={signEl}
          tip={tip}
          locale={locale}
          actionable={canRun(tip.action, can)}
          onAction={onSignAction}
          onDismiss={() => closeSign(true)}
          onClose={() => closeSign(false)}
          below={signPos?.below === true}
          style={signPos ? { left: signPos.left, top: signPos.top, width: signPos.width, ...(signPos.maxHeight ? { maxHeight: signPos.maxHeight, display: 'flex' } : {}) } : { left: -10000, top: 0, visibility: 'hidden' }}
        />
      )}

      {owns && menu && (
        <Menu
          ref={menuEl}
          view={menu}
          setView={setMenu}
          onClose={closeMenu}
          can={can}
          locale={locale}
          audience={audienceSaid}
          drawingTips={drawingTips}
          pickDrawingTip={pickDrawingTip}
          runAction={(action) => {
            setMenu(null);
            runAction(action);
          }}
          openRoulette={openRoulette}
          surprise={surprise}
          nextLesson={nextLesson}
          saveAudience={(a) => savePrefs({ audience: a })}
          hide={hide}
          ready={menuPos !== null}
          style={menuPos ? { left: menuPos.left, top: menuPos.top } : { left: -10000, top: 0, visibility: 'hidden' }}
        />
      )}

      {roulette && (
        <Roulette
          open
          onOpenChange={(o) => {
            if (!o) {
              setRoulette(null);
              settle();
              window.setTimeout(() => button.current?.focus({ preventScroll: true }), 0);
            }
          }}
          mood={roulette.mood}
          classMode={roulette.classMode}
          worksheets={can.worksheets && can.tool('grid') === 'open'}
          reducedMotion={reduced}
        />
      )}

      <p aria-live="polite" className="sr-only">
        {said}
      </p>
    </div>
  );
}
