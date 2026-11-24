import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { useLocale, useTranslations } from 'use-intl';
import { dayOf, mayOffer, pickTip, remember, snooze, type Context, type Memory } from '@/lib/companion/brain';
import { canRun } from '@/lib/companion/registry';
import type { AnimationId, Audience, CompanionTip, Mood, ScreenId, TipAction, TriggerId } from '@/lib/companion/model';
import { classModeOn } from '@/lib/learn/class-mode';
import { useAccount } from '@/components/shell/account';
import { useCourseStart } from '@/components/learn/useCourseStart';
import { CLIPS } from './clips';
import { aimAt, dockGeometry, geometryOf, signPlacement, type Geometry, type Measured } from './geometry';
import { Menu } from './Menu';
import { PRIORITY, useSketchyPresence } from './presence';
import { strideCycle } from './raster-engine';
import { preloadSketchy } from './raster-mesh';
import { Roulette } from './Roulette';
import { Sign } from './Sign';
import { Sketchy, type SketchyHandle } from './Sketchy';
import { useAbilities, useRunAction, type MenuView } from './actions';
import { loadMemory, saveMemory, stageMounted, takePending, useCompanionEvents, useCompanionPrefs, useLastTool, useReducedMotion, type CompanionEvent, type CompanionView } from './state';

// ─── The stage (ADR-0024) ──────────────────────────────────────────────────────
// Sketchy's place on a screen and what he does there. He first stands on the
// floor line of the screen's top area (Home's hero, the Learn home's cards),
// only on the free side of its text (geometry.ts). Once the page scrolls his
// spot half out of view he runs into his floating corner of the scrolling
// area (above a phone's bottom bar), and he is back on his spot when it is in
// full view again: one Sketchy, always at hand while the page scrolls. There:
//   - he walks in (his legs at the pace of the ground he covers), looks
//     around and waves; the first time he introduces himself, on a new day he
//     says hello;
//   - his eyes and head follow the pointer; on a touch screen he glances
//     toward a tap;
//   - after a save or a completed lesson or challenge he celebrates and
//     offers what could come next;
//   - after a quiet while he may hold up a sign with a suggestion (the pace,
//     the daily cap and "Not now" are the admin's, ../../lib/companion/brain);
//   - now and then he walks to another free spot, sits, sketches, or rests;
//   - a click (or Enter) opens his menu at once, whatever the pace of his
//     suggestions; he never moves while it or a sign is open, and never offers
//     anything while the person is using the page (a tap, a key or a scroll in
//     the last seconds).
// While the roulette (or anything else showing its own Sketchy) is open he is
// not drawn at all (presence.ts), and comes back once when it closes. In a
// hidden tab he stops. With reduced motion he does not walk: he appears, and
// every pose is still.

export interface StageProps {
  screen: ScreenId;
  /** The element he lives in (position: relative); his floor, text to avoid and top limit are found inside it. */
  containerRef: RefObject<HTMLElement | null>;
  /** He stands on this element's bottom edge (or on the first match of `floorSelector` inside the container). */
  floorRef?: RefObject<HTMLElement | null>;
  floorSelector?: string;
  /** Stand on the floor element's bottom edge (Home's hero) or its top edge (on top of the Learn home's cards). */
  floorEdge?: 'top' | 'bottom';
  view: CompanionView;
}

type Phase = 'waiting' | 'entering' | 'idle' | 'walking' | 'sign' | 'leaving';
type Place = 'hero' | 'dock';
type DockGeometry = Geometry & { topLimit: number };
type Box = { left: number; top: number; width: number; height: number };

const QUIET_MS = 4000;
const SIGN_TIMEOUT_MS = 40_000;
const MICRO_MIN_MS = 18_000;
/** His spot scrolled this far out of view: he floats; back in full view: he returns to it. */
const DOCK_BELOW = 0.5;
const HERO_FROM = 0.98;

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

/** The scrolling area's visible content box on screen (inside its scrollbar). */
function areaOf(scroller: HTMLElement | null) {
  if (!scroller) return { left: 0, right: window.innerWidth, top: 0, bottom: window.innerHeight };
  const r = scroller.getBoundingClientRect();
  const left = r.left + scroller.clientLeft;
  const top = r.top + scroller.clientTop;
  return { left, right: left + scroller.clientWidth, top, bottom: top + scroller.clientHeight };
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

  const [heroGeo, setHeroGeo] = useState<Geometry | null>(null);
  const [dockGeo, setDockGeo] = useState<DockGeometry | null>(null);
  const [place, setPlace] = useState<Place>('hero');
  const placeRef = useRef<Place>(place);
  placeRef.current = place;
  const geo = place === 'dock' ? dockGeo : heroGeo;
  // Read the latest geometry inside callbacks that outlive a render (an entrance, a sign shown later).
  const geoRef = useRef(geo);
  geoRef.current = geo;
  const dockRef = useRef(dockGeo);
  dockRef.current = dockGeo;
  const [x, setX] = useState<number | null>(null);
  const [facing, setFacing] = useState<'left' | 'right'>('left');
  // Read where he faces now (callbacks made at his entrance outlive that render).
  const facingRef = useRef(facing);
  facingRef.current = facing;
  const [moveMs, setMoveMs] = useState(0);
  const [faded, setFaded] = useState(true);
  const [pageShown, setPageShown] = useState(() => typeof document === 'undefined' || document.visibilityState === 'visible');
  const [tip, setTip] = useState<CompanionTip | null>(null);
  const [signPos, setSignPos] = useState<{ left: number; top: number; width: number; below: boolean; maxHeight: number | null } | null>(null);
  const [menu, setMenu] = useState<MenuView | null>(null);
  const [menuPos, setMenuPos] = useState<{ left: number; top: number; maxHeight: number | null } | null>(null);
  const [roulette, setRoulette] = useState<{ mood?: Mood; classMode?: boolean } | null>(null);
  const [said, setSaid] = useState('');

  const fox = useRef<SketchyHandle>(null);
  const foxBox = useRef<HTMLDivElement>(null);
  const home = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const signEl = useRef<HTMLDivElement>(null);
  const menuEl = useRef<HTMLDivElement>(null);
  const phase = useRef<Phase>('waiting');
  const memory = useRef<Memory | null>(null);
  const timers = useRef(new Set<number>());
  const lastInput = useRef(0);
  const lastMove = useRef(Date.now());
  const lastMicro = useRef(Date.now());
  const microAfter = useRef(MICRO_MIN_MS);
  /** The last thing that happened (arrival, a sign, the menu, a stroll, waking up): he rests after a long quiet. */
  const lastEvent = useRef(Date.now());
  const arrivedAt = useRef(Date.now());
  const restingSince = useRef<number | null>(null);
  const spotIndex = useRef(0);
  const xNow = useRef<number | null>(null);
  /** Only the newest quiet loop runs (each effect run starts a new one). */
  const loop = useRef(0);
  /** Each entrance or move between his places; an older one stops where it is. */
  const moves = useRef(0);
  /** Said hello on this visit (the introduction, a celebration or the day's greeting). */
  const greeted = useRef(false);
  const dockedBefore = useRef(false);
  const shownPlace = useRef<Place | null>(null);
  const highlighted = useRef<Element | null>(null);
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
      highlighted.current?.removeAttribute('data-sketchy-highlight');
    },
    [clearTimers],
  );
  const scroller = useCallback(() => containerRef.current?.closest<HTMLElement>('.overflow-y-auto') ?? null, [containerRef]);

  /** The box his place is measured in: the container (hero), or the screen (dock). */
  const frame = useCallback((): Box => {
    if (placeRef.current === 'dock') return { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight };
    const c = containerRef.current?.getBoundingClientRect();
    return c ? { left: c.left, top: c.top, width: c.width, height: c.height } : { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight };
  }, [containerRef]);
  /** Nothing of his goes above this line (the brand row on phones, the top of the scrolling area when floating). */
  const topLimit = useCallback((): number => {
    if (placeRef.current === 'dock') return dockRef.current?.topLimit ?? 8;
    const container = containerRef.current;
    const floor = floorRef.current;
    return (container && floor ? measureStage(container, floor, floorEdge)?.topLimit : null) ?? 8;
  }, [containerRef, floorRef, floorEdge]);

  const allowed = useCallback((id: AnimationId) => settings.animations[id] !== false, [settings.animations]);
  /** A clip, or a calmer one when the admin switched it off. */
  const choose = useCallback(
    (id: AnimationId): AnimationId => {
      const fallbacks: Partial<Record<AnimationId, AnimationId[]>> = {
        run: ['walk'],
        celebrate: ['jump', 'wave'],
        jump: ['celebrate', 'wave'],
        laugh: ['wave'],
        rest: ['sit'],
        point: ['holdSign'],
        draw: ['think'],
        curious: ['think'],
        think: ['curious'],
      };
      for (const c of [id, ...(fallbacks[id] ?? [])]) if (allowed(c)) return c;
      return 'idle';
    },
    [allowed],
  );
  /** Play a clip; resolves when a clip that ends has ended, or after `ms` for one that loops. */
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
  const rest = useCallback(() => fox.current?.play(choose('sit')), [choose]);

  const persist = useCallback(
    (next: Memory) => {
      memory.current = next;
      if (userId) saveMemory(userId, next);
    },
    [userId],
  );

  // ── geometry: his spot in the hero, and his floating corner ────────────────
  useLayoutEffect(() => {
    const container = containerRef.current;
    const floor = floorRef.current;
    if (!container || !floor) return;
    const update = () => {
      const measured = measureStage(container, floor, floorEdge);
      const next = measured ? geometryOf(measured, settings.size) : null;
      setHeroGeo((was) => (JSON.stringify(was) === JSON.stringify(next) ? was : next));
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

  useLayoutEffect(() => {
    const area = scroller();
    const update = () => {
      const rtl = getComputedStyle(containerRef.current ?? document.documentElement).direction === 'rtl';
      const next = dockGeometry(areaOf(area), window.innerWidth, rtl, window.innerWidth < 768, settings.size);
      setDockGeo((was) => (JSON.stringify(was) === JSON.stringify(next) ? was : next));
    };
    update();
    const observer = new ResizeObserver(update);
    if (area) observer.observe(area);
    window.addEventListener('resize', update);
    window.addEventListener('orientationchange', update);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', update);
      window.removeEventListener('orientationchange', update);
    };
  }, [containerRef, scroller, settings.size]);

  // Keep him on a valid spot when the room changes (rotation, resizing); a move between places is the arrival's.
  useEffect(() => {
    if (!geo || xNow.current === null || phase.current === 'waiting' || phase.current === 'entering') return;
    if (shownPlace.current !== place) {
      shownPlace.current = place;
      return;
    }
    const spot = geo.spots[Math.min(spotIndex.current, geo.spots.length - 1)];
    spotIndex.current = Math.min(spotIndex.current, geo.spots.length - 1);
    xNow.current = spot;
    setMoveMs(0);
    setX(spot);
    setFacing(geo.facing);
  }, [geo]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── a hidden tab: he stops ─────────────────────────────────────────────────
  useEffect(() => {
    const onVis = () => setPageShown(document.visibilityState === 'visible');
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, []);

  // ── tips ───────────────────────────────────────────────────────────────────
  const contextFor = useCallback(
    (trigger: TriggerId): Context => {
      const now = Date.now();
      return { screen, trigger, audience, lastTool, can: (action: TipAction) => canRun(action, can), now, today: dayOf(now) };
    },
    [audience, can, lastTool, screen],
  );

  const clearHighlight = useCallback(() => {
    highlighted.current?.removeAttribute('data-sketchy-highlight');
    highlighted.current = null;
  }, []);

  const placeSign = useCallback(() => {
    const sign = signEl.current;
    const box = foxBox.current;
    const g = geoRef.current;
    if (!sign || !box || !g) return;
    const c = frame();
    const r = box.getBoundingClientRect();
    const at = { left: r.left - c.left, right: r.right - c.left, top: r.top - c.top, height: r.height };
    const stage = { width: c.width, topLimit: topLimit(), floor: g.floor };
    // Two steps: the width first (the text wraps to it), then the height it takes.
    const first = signPlacement(at, sign.offsetHeight, stage, facingRef.current);
    sign.style.width = `${first.width}px`;
    const placed = signPlacement(at, sign.offsetHeight, stage, facingRef.current);
    if (placed.below && placeRef.current === 'dock') {
      // Floating, there is nothing below him: the sign goes above him instead.
      const width = Math.min(placed.width, c.width - 16);
      const left = Math.min(Math.max(8, at.left + (at.right - at.left) / 2 - width / 2), c.width - width - 8);
      const top = Math.max(stage.topLimit, at.top - sign.offsetHeight - 4);
      setSignPos({ left: Math.round(left), top: Math.round(top), width, below: false, maxHeight: at.top - 4 - stage.topLimit < sign.offsetHeight ? Math.round(at.top - 4 - stage.topLimit) : null });
      return;
    }
    setSignPos(placed);
  }, [frame, topLimit]);

  const closeSign = useCallback(
    (snoozed: boolean) => {
      setTip((shown) => {
        // Only "Not now" asks for quiet (and not on his introduction); closing the sign just closes it.
        if (snoozed && shown && shown.trigger !== 'firstVisit') persist(snooze(memory.current!, settings.snoozeHours, Date.now()));
        return null;
      });
      setSignPos(null);
      clearHighlight();
      phase.current = 'idle';
      lastEvent.current = Date.now();
      lastMicro.current = Date.now();
      if (alive.current) void play('idle', 600).then(() => phase.current === 'idle' && rest());
    },
    [clearHighlight, persist, play, rest, settings.snoozeHours],
  );

  const present = useCallback(
    async (next: CompanionTip) => {
      if (!fox.current || !geoRef.current) return;
      phase.current = 'sign';
      restingSince.current = null;
      const now = Date.now();
      persist(remember(memory.current!, next, now, dayOf(now)));
      // The move that comes with it: pointing at the tool card it is about, or its own animation.
      const target = next.action.type === 'openTool' && placeRef.current === 'hero' ? containerRef.current?.querySelector(`[data-tool-card="${next.action.tool}"]`) : null;
      if (next.animation === 'point' && target && allowed('point')) {
        const shoulder = fox.current.anchor('shoulder');
        const r = target.getBoundingClientRect();
        const aim = shoulder ? aimAt({ x: shoulder.left, y: shoulder.top }, { x: r.left + r.width / 2, y: r.top + Math.min(r.height / 2, 80) }) : 30;
        target.setAttribute('data-sketchy-highlight', '');
        highlighted.current = target;
        await play('point', 1700, { aim });
      } else if (next.animation !== 'holdSign') {
        await play(next.animation, 1500);
      }
      if (!alive.current || phase.current !== 'sign') return;
      fox.current?.play(choose('holdSign'));
      setSignPos(null);
      setTip(next);
      setSaid(t('said', { text: next.text[locale] }));
      later(SIGN_TIMEOUT_MS, () => {
        if (phase.current === 'sign') closeSign(false);
      });
    },
    [allowed, choose, closeSign, containerRef, later, locale, persist, play, t],
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
  const openRoulette = useCallback((o: { mood?: Mood; classMode?: boolean }) => {
    setMenu(null);
    setTip(null);
    setSignPos(null);
    setRoulette(o);
  }, []);
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

  // ── moving ─────────────────────────────────────────────────────────────────
  /** Walk (or run) to `target` in his current place; his steps match the ground he covers. */
  const walkTo = useCallback(
    (target: number, run = false) =>
      new Promise<void>((resolve) => {
        const g = geoRef.current;
        if (!g) return resolve();
        const from = xNow.current ?? target;
        const dist = Math.abs(target - from);
        if (dist < 2) return resolve();
        const clip = run ? choose('run') : 'walk';
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
        phase.current = phase.current === 'entering' ? 'entering' : 'walking';
        setFacing(target < from ? 'left' : 'right');
        const pxPerSec = CLIPS[clip].speed! * (g.height / 292) * (settings.speed / 100);
        fox.current?.play(clip, { params: { cycle: strideCycle(clip === 'run' ? 'run' : 'walk', pxPerSec, g.height) } });
        const ms = Math.round((dist / pxPerSec) * 1000);
        setMoveMs(ms);
        xNow.current = target;
        setX(target);
        lastMove.current = Date.now();
        later(ms + 30, resolve);
      }),
    [allowed, choose, later, reduced, settings.speed],
  );

  const hide = useCallback(async (): Promise<boolean> => {
    const ok = await savePrefs({ hidden: true }, { refresh: false });
    if (!ok) return false;
    setMenu(null);
    phase.current = 'leaving';
    moves.current += 1;
    clearTimers();
    await play('wave', 1800);
    const g = geoRef.current;
    if (g && !reduced && allowed('walk')) {
      setFacing(g.offstage > (xNow.current ?? 0) ? 'right' : 'left');
      const clip = choose('run');
      const pxPerSec = CLIPS[clip].speed! * (g.height / 292);
      fox.current?.play(clip, { params: { cycle: strideCycle(clip === 'run' ? 'run' : 'walk', pxPerSec, g.height) } });
      const ms = Math.round((Math.abs(g.offstage - (xNow.current ?? 0)) / pxPerSec) * 1000);
      setMoveMs(ms);
      setX(g.offstage);
      await new Promise((r) => later(ms + 50, () => r(null)));
    } else {
      setFaded(true);
      await new Promise((r) => later(350, () => r(null)));
    }
    await account?.refresh();
    return true;
  }, [account, allowed, choose, clearTimers, later, play, reduced, savePrefs]);

  /**
   * Arrive in a place: from the side at a run when he floats in (a walk on his first entrance),
   * or simply appear (back on his spot, or with less motion). False if a newer move took over.
   */
  const enter = useCallback(
    async (to: Place, move: number, first: boolean): Promise<boolean> => {
      const g = geoRef.current;
      if (!g) return false;
      const spot = g.spots[0];
      spotIndex.current = 0;
      shownPlace.current = to;
      const moving = !reduced && allowed('walk') && (first || to === 'dock');
      phase.current = 'entering';
      restingSince.current = null;
      xNow.current = moving ? g.offstage : spot;
      setMoveMs(0);
      setX(xNow.current);
      setFacing(g.facing);
      setFaded(true);
      // His artwork is ready before he moves (never a still picture sliding in).
      await Promise.all([preloadSketchy(), wait(first ? Math.max(300, settings.firstDelaySec * 1000) : 40)]);
      if (move !== moves.current || !alive.current) return false;
      setFaded(false);
      if (moving) await walkTo(spot, !first);
      if (move !== moves.current || !alive.current) return false;
      setFacing(g.facing);
      phase.current = 'idle';
      arrivedAt.current = Date.now();
      lastEvent.current = Date.now();
      lastMove.current = Date.now();
      return true;
    },
    [allowed, reduced, settings.firstDelaySec, wait, walkTo],
  );

  /** His hello on this visit: the introduction, a celebration of what just happened, or the day's greeting. */
  const greet = useCallback(async () => {
    greeted.current = true;
    const pending = takePending();
    const firstTime = memory.current!.metAt === null;
    if (firstTime) {
      // His introduction comes with its own wave.
      const intro = pickTip(view.tips, contextFor('firstVisit'), memory.current!);
      if (intro) {
        void present(intro);
        return;
      }
      await play('wave', 1800);
      persist({ ...memory.current!, metAt: Date.now() });
    } else if (pending && settings.celebrate) {
      await play(choose('celebrate'));
      if (offer(pending.type === 'saved' ? 'afterSave' : 'afterComplete')) return;
    } else {
      await play('curious', 1500);
      await play('wave', 1800);
      if (offer('arrive')) return;
    }
    if (phase.current === 'idle') rest();
  }, [choose, contextFor, offer, persist, play, present, rest, settings.celebrate, view.tips]);

  const heroSpotInView = useCallback((): number => {
    const el = home.current;
    if (!el) return 0;
    const r = el.getBoundingClientRect();
    const a = areaOf(scroller());
    const seen = Math.max(0, Math.min(r.bottom, a.bottom) - Math.max(r.top, a.top)) * Math.max(0, Math.min(r.right, a.right) - Math.max(r.left, a.left));
    return r.width * r.height > 0 ? seen / (r.width * r.height) : 0;
  }, [scroller]);

  // ── his entrance, once his places and his memory are known ─────────────────
  useEffect(() => {
    if (!dockGeo || !userId || phase.current !== 'waiting') return;
    memory.current = loadMemory(userId);
    const to: Place = heroGeo && heroSpotInView() >= DOCK_BELOW ? 'hero' : 'dock';
    placeRef.current = to;
    setPlace(to);
    phase.current = 'entering';
    const move = ++moves.current;
    // Placed in the next frame, once the place's geometry is in effect.
    window.requestAnimationFrame(() => {
      geoRef.current = to === 'dock' ? dockRef.current : geoRef.current;
      void enter(to, move, true).then((arrived) => {
        if (arrived && move === moves.current) void greet();
      });
    });
  }, [dockGeo, heroGeo, userId]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Float in his corner, or go back to his spot: whatever he was showing closes (no snooze). */
  const moveTo = useCallback(
    (to: Place) => {
      if (placeRef.current === to || phase.current === 'waiting' || phase.current === 'leaving') return;
      if (to === 'hero' && !heroGeo) return;
      const move = ++moves.current;
      setTip(null);
      setSignPos(null);
      setMenu(null);
      clearHighlight();
      placeRef.current = to;
      geoRef.current = to === 'dock' ? dockRef.current : heroGeo;
      setPlace(to);
      void enter(to, move, false).then(async (arrived) => {
        if (!arrived || move !== moves.current) return;
        if (!greeted.current) return void greet();
        const hello = to === 'dock' && !dockedBefore.current;
        dockedBefore.current ||= to === 'dock';
        await play(hello ? 'wave' : 'idle', hello ? 1500 : 700);
        if (move === moves.current && phase.current === 'idle') rest();
      });
    },
    [clearHighlight, enter, greet, heroGeo, play, rest],
  );

  // Where his spot is: half out of view, he floats; fully back in view, he returns. Never while his
  // menu or the roulette is open (the menu scrolls itself into view): he catches up once they close.
  const menuOpen = useRef(false);
  menuOpen.current = menu !== null;
  useEffect(() => {
    const el = home.current;
    if (!el || !heroGeo) return;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (roulette || menuOpen.current) return;
        if (placeRef.current === 'hero' && entry.intersectionRatio < DOCK_BELOW) moveTo('dock');
        else if (placeRef.current === 'dock' && entry.intersectionRatio >= HERO_FROM) moveTo('hero');
      },
      { threshold: [0, 0.25, DOCK_BELOW, 0.75, HERO_FROM, 1] },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [heroGeo, moveTo, roulette]);
  useEffect(() => {
    if (menu !== null || roulette || !heroGeo || phase.current === 'waiting' || phase.current === 'entering') return;
    const seen = heroSpotInView();
    if (placeRef.current === 'hero' && seen < DOCK_BELOW) moveTo('dock');
    else if (placeRef.current === 'dock' && seen >= HERO_FROM) moveTo('hero');
  }, [menu, roulette]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── back from the roulette: once, where he was ─────────────────────────────
  const hadFox = useRef(owns);
  useEffect(() => {
    if (owns && !hadFox.current && phase.current !== 'waiting') {
      lastEvent.current = Date.now();
      lastMicro.current = Date.now();
      window.requestAnimationFrame(() => void play('wave', 1200).then(() => phase.current === 'idle' && rest()));
    }
    hadFox.current = owns;
  }, [owns, play, rest]);

  // ── the person's input (he never interrupts it), the pointer and taps ──────
  useEffect(() => {
    const area = scroller() ?? window;
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
      // Waking up when the pointer comes close.
      if (d < 140 && restingSince.current !== null && phase.current === 'idle') {
        restingSince.current = null;
        lastEvent.current = Date.now();
        void play('curious', 1400).then(() => phase.current === 'idle' && rest());
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
  }, [scroller, play, rest]);

  // ── the quiet loop: a suggestion, a stroll, a sketch, a rest ───────────────
  useEffect(() => {
    if (!geo || !pageShown || !owns) return;
    const generation = ++loop.current;
    const tick = () => {
      if (!alive.current || generation !== loop.current) return;
      const now = Date.now();
      const busy = phase.current !== 'idle' || menu !== null || roulette !== null || tip !== null;
      const quiet = now - lastInput.current > QUIET_MS;
      if (!busy && quiet) {
        if (now - arrivedAt.current >= settings.tipAfterSec * 1000 && offer('idle')) return;
        if (settings.wander && !geo.compact && now - lastMove.current >= settings.wanderEverySec * 1000) {
          const choices = geo.spots.map((_, i) => i).filter((i) => i !== spotIndex.current);
          const nextSpot = choices[Math.floor(Math.random() * choices.length)];
          if (nextSpot !== undefined) {
            spotIndex.current = nextSpot;
            restingSince.current = null;
            const move = moves.current;
            void walkTo(geo.spots[nextSpot]).then(async () => {
              if (!alive.current || move !== moves.current) return;
              setFacing(geo.facing);
              phase.current = 'idle';
              lastEvent.current = Date.now();
              await play(Math.random() < 0.5 ? 'curious' : 'idle', 1200);
              if (phase.current === 'idle') rest();
            });
            later(1000, tick);
            return;
          }
        }
        if (restingSince.current === null && now - lastEvent.current >= settings.restAfterSec * 1000 && allowed('rest')) {
          restingSince.current = now;
          fox.current?.play('rest');
        } else if (restingSince.current === null && now - lastMicro.current >= microAfter.current) {
          lastMicro.current = now;
          microAfter.current = MICRO_MIN_MS + Math.random() * 20_000;
          const micro: AnimationId[] = ['draw', 'think', 'curious', 'laugh'];
          const pickMicro = micro[Math.floor(Math.random() * micro.length)];
          void play(pickMicro, pickMicro === 'draw' ? 4200 : 1800).then(() => phase.current === 'idle' && restingSince.current === null && rest());
        }
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
  }, [geo, pageShown, owns, menu, roulette, tip, settings, offer, walkTo, play, rest, later, allowed]);

  // ── good news from elsewhere on the page ───────────────────────────────────
  const onEvent = useCallback(
    (event: CompanionEvent) => {
      if (!settings.celebrate || phase.current !== 'idle' || menu !== null || roulette !== null) return;
      takePending();
      void play(choose('celebrate')).then(() => {
        if (!offer(event.type === 'saved' ? 'afterSave' : 'afterComplete') && phase.current === 'idle') rest();
      });
    },
    [choose, menu, offer, play, rest, roulette, settings.celebrate],
  );
  useCompanionEvents(onEvent);

  // ── the menu's place: above him, beside him, or (in the hero on narrow screens) just below his feet ──
  useLayoutEffect(() => {
    if (!menu || !menuEl.current || !geo || xNow.current === null) return;
    const c = frame();
    const m = menuEl.current;
    const top = topLimit();
    const docked = placeRef.current === 'dock';
    const foxLeft = xNow.current - geo.width / 2;
    const foxRight = xNow.current + geo.width / 2;
    const above = geo.floor - geo.height - m.offsetHeight - 6;
    const roomBeside = facing === 'left' ? foxLeft - 12 : c.width - foxRight - 12;
    let left: number;
    let at: number;
    let maxHeight: number | null = null;
    if (above >= top) {
      left = xNow.current - m.offsetWidth / 2;
      at = above;
    } else if (roomBeside >= m.offsetWidth) {
      left = facing === 'left' ? foxLeft - m.offsetWidth - 4 : foxRight + 4;
      at = Math.max(top, geo.floor - m.offsetHeight);
      if (docked && m.offsetHeight > geo.floor - top) maxHeight = geo.floor - top;
    } else if (docked) {
      // Floating with little room: above him, its entries scrolling.
      left = xNow.current - m.offsetWidth / 2;
      at = top;
      maxHeight = Math.max(160, geo.floor - geo.height - 6 - top);
    } else {
      left = xNow.current - m.offsetWidth / 2;
      at = geo.floor + 6;
    }
    setMenuPos({ left: Math.round(Math.min(Math.max(8, left), Math.max(8, c.width - m.offsetWidth - 8))), top: Math.round(at), maxHeight: maxHeight === null ? null : Math.round(maxHeight) });
    if (!docked) window.requestAnimationFrame(() => m.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' }));
  }, [menu, geo, facing, frame, topLimit]);

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
  }, [tip, placeSign, geo, place, later]);

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
    // Stop where he is (on his way in, too): the person asked for him.
    if ((phase.current === 'walking' || phase.current === 'entering') && foxBox.current && geoRef.current) {
      const r = foxBox.current.getBoundingClientRect();
      const here = r.left + r.width / 2 - frame().left;
      moves.current += 1;
      xNow.current = here;
      setMoveMs(0);
      setX(here);
      setFaded(false);
      setFacing(geoRef.current.facing);
      phase.current = 'idle';
      arrivedAt.current = Date.now();
    }
    restingSince.current = null;
    if (menu) {
      setMenu(null);
      return;
    }
    if (tip) {
      setTip(null);
      setSignPos(null);
      clearHighlight();
      phase.current = 'idle';
    }
    fox.current?.play(choose('wave'));
    later(900, () => phase.current === 'idle' && fox.current?.play('idle'));
    setMenu('main');
  };

  const closeMenu = useCallback(() => {
    setMenu(null);
    button.current?.focus({ preventScroll: true });
    if (phase.current === 'idle') rest();
    lastMicro.current = Date.now();
    lastEvent.current = Date.now();
  }, [rest]);

  const onSignAction = () => {
    if (!tip) return;
    const action = tip.action;
    setTip(null);
    setSignPos(null);
    clearHighlight();
    phase.current = 'idle';
    if (!memory.current!.metAt) persist({ ...memory.current!, metAt: Date.now() });
    void play(choose('jump'));
    runAction(action);
  };

  if (!heroGeo && !dockGeo) return <div aria-hidden="true" className="hidden" data-sketchy-stage="waiting" />;

  const docked = place === 'dock';
  const scene =
    geo && x !== null && owns ? (
      <>
        <div
          ref={foxBox}
          className="pointer-events-none absolute left-0 top-0"
          style={{
            transform: `translate3d(${Math.round(x - geo.width / 2)}px, ${Math.round(geo.floor - geo.height)}px, 0)`,
            transition: `transform ${moveMs}ms linear, opacity 260ms ease`,
            opacity: faded ? 0 : 1,
            width: geo.width,
            height: geo.height,
          }}
          data-sketchy-fox=""
          data-sketchy-place={place}
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
            <Sketchy ref={fox} height={geo.height} facing={facing} reducedMotion={reduced} idleLife={settings.idleLife} paused={!pageShown} initial="idle" />
          </div>
        </div>

        {tip && (
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

        {menu && (
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
            style={menuPos ? { left: menuPos.left, top: menuPos.top, ...(menuPos.maxHeight ? { maxHeight: menuPos.maxHeight, overflowY: 'auto' } : {}) } : { left: -10000, top: 0, visibility: 'hidden' }}
          />
        )}
      </>
    ) : null;

  return (
    <>
      <div className="pointer-events-none absolute inset-0 z-20 overflow-hidden" data-sketchy-stage={screen} data-sketchy-compact={heroGeo?.compact || undefined} data-sketchy-motion={reduced ? 'reduced' : 'full'}>
        {/* His spot in the hero, watched while he floats: in full view again, he goes back to it. */}
        {heroGeo && (
          <div
            ref={home}
            aria-hidden="true"
            className="pointer-events-none absolute"
            style={{ left: heroGeo.spots[0] - heroGeo.width / 2, top: heroGeo.floor - heroGeo.height, width: heroGeo.width, height: heroGeo.height }}
            data-sketchy-home=""
          />
        )}
        {!docked && scene}
      </div>
      {docked && scene && createPortal(<div className="pointer-events-none fixed inset-0 z-30 overflow-hidden" data-sketchy-stage={screen} data-sketchy-dock="">{scene}</div>, document.body)}

      {roulette && (
        <Roulette
          open
          onOpenChange={(o) => {
            if (!o) {
              setRoulette(null);
              lastMicro.current = Date.now();
              lastEvent.current = Date.now();
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
    </>
  );
}
