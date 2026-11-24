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
import { dockGeometry, signPlacement, type Geometry } from './geometry';
import { Menu } from './Menu';
import { PRIORITY, useSketchyPresence } from './presence';
import { gaitSpeed, strideCycle } from './raster-engine';
import { preloadSketchy } from './raster-mesh';
import { Roulette } from './Roulette';
import { Sign } from './Sign';
import { Sketchy, type SketchyHandle } from './Sketchy';
import { useAbilities, useRunAction, type MenuView } from './actions';
import { loadMemory, saveMemory, stageMounted, takePending, useCompanionEvents, useCompanionPrefs, useLastTool, useReducedMotion, type CompanionEvent, type CompanionView } from './state';

// ─── The stage (ADR-0024) ──────────────────────────────────────────────────────
// Sketchy as a calm personal drawing assistant on Home and the Learn home.
//   - Once a visit he walks in from the edge of the screen into his corner of
//     the scrolling area (the end of the reading direction, above a phone's
//     bottom bar), and stays there while the page scrolls: no other place, no
//     second entrance, no jumps. Between Home and the Learn home he is simply
//     there.
//   - He stands, breathes, blinks and follows the pointer with his eyes;
//     after a quiet while he sits down, later he dozes; a tap or the pointer
//     close by and he stands again. Nothing else plays on its own.
//   - Now and then he pulls out his wooden sign with a suggestion that fits
//     the moment (the screen, the tool used last, who the person is, what their
//     plan opens) and a real button; a challenge to spin comes with a little
//     jump. The pace, the daily cap and "Not now" are the admin's
//     (../../lib/companion/brain).
//   - After a save or a completed lesson or challenge he celebrates once and
//     may suggest a next step.
//   - A click (or Enter) opens his menu at once.
//   - While the roulette (or anything else showing its own Sketchy) is open
//     he is not drawn at all (presence.ts); he is back when it closes.
// In a hidden tab he stops. With reduced motion he does not walk: he appears,
// and every pose is still.

export interface StageProps {
  screen: ScreenId;
  /** The screen's content, inside its scrolling area: his corner is that area's. */
  containerRef: RefObject<HTMLElement | null>;
  view: CompanionView;
}

type Phase = 'waiting' | 'entering' | 'idle' | 'sign' | 'leaving';
type Posture = 'stand' | 'sit' | 'doze';
type DockGeometry = Geometry & { topLimit: number };

const QUIET_MS = 4000;
const SIGN_TIMEOUT_MS = 45_000;
/** After this long with nothing happening he sits down (he dozes after the admin's "rest after"). */
const SIT_AFTER_MS = 75_000;
/** The pointer this close (CSS pixels) wakes him. */
const NEAR = 160;

/** This visit (until the page is reloaded): he walks in once and says hello once, on whichever screen. */
const visit = { entered: false, greeted: false };

/**
 * The scrolling area on screen. Its outer sides, scrollbar or not, so his corner is the same on
 * every screen (a desktop scrollbar is narrower than the gap he keeps from the side).
 */
function areaOf(scroller: HTMLElement | null) {
  if (!scroller) return { left: 0, right: window.innerWidth, top: 0, bottom: window.innerHeight };
  const r = scroller.getBoundingClientRect();
  return { left: r.left, right: r.right, top: r.top, bottom: r.top + scroller.clientTop + scroller.clientHeight };
}

export function Stage({ screen, containerRef, view }: StageProps) {
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

  const [geo, setGeo] = useState<DockGeometry | null>(null);
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
  const [tip, setTip] = useState<CompanionTip | null>(null);
  const [signPos, setSignPos] = useState<{ left: number; top: number; width: number; below: boolean; maxHeight: number | null } | null>(null);
  const [menu, setMenu] = useState<MenuView | null>(null);
  const [menuPos, setMenuPos] = useState<{ left: number; top: number; maxHeight: number | null } | null>(null);
  const [roulette, setRoulette] = useState<{ mood?: Mood; classMode?: boolean } | null>(null);
  const [said, setSaid] = useState('');

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
  /** The last thing that happened (arrival, a sign, the menu, a celebration): he sits and dozes after a long quiet. */
  const lastEvent = useRef(Date.now());
  const arrivedAt = useRef(Date.now());
  const xNow = useRef<number | null>(null);
  /** Only the newest quiet loop runs (each effect run starts a new one). */
  const loop = useRef(0);
  /** His entrance; a newer one (or hiding him) stops an older one where it is. */
  const moves = useRef(0);
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
  const scroller = useCallback(() => containerRef.current?.closest<HTMLElement>('.overflow-y-auto') ?? null, [containerRef]);

  const allowed = useCallback((id: AnimationId) => settings.animations[id] !== false, [settings.animations]);
  /** A clip, or a calmer one when the admin switched it off. */
  const choose = useCallback(
    (id: AnimationId): AnimationId => {
      const fallbacks: Partial<Record<AnimationId, AnimationId[]>> = { run: ['walk'], celebrate: ['jump', 'wave'], jump: ['celebrate', 'wave'], rest: ['sit'], sit: ['idle'] };
      for (const c of [id, ...(fallbacks[id] ?? [])]) if (allowed(c)) return c;
      return 'idle';
    },
    [allowed],
  );
  /** Play a clip; resolves when a clip that ends has ended, or after `ms` for one that loops. */
  const play = useCallback(
    (id: AnimationId, ms = 1600) =>
      new Promise<void>((resolve) => {
        const clip = choose(id);
        if (!fox.current) return resolve();
        if (CLIPS[clip].loop || reduced) {
          fox.current.play(clip);
          later(reduced ? Math.min(ms, 900) : ms, resolve);
        } else fox.current.play(clip, { onEnd: () => resolve(), restart: true });
      }),
    [choose, later, reduced],
  );
  /** Back to standing quietly (after a sign, the menu or a celebration). */
  const settle = useCallback(() => {
    posture.current = 'stand';
    lastEvent.current = Date.now();
    if (phase.current === 'idle') fox.current?.play('idle');
  }, []);
  /** Up from sitting or dozing, without a fuss. */
  const wake = useCallback(() => {
    lastEvent.current = Date.now();
    if (posture.current === 'stand' || phase.current !== 'idle') return;
    posture.current = 'stand';
    fox.current?.play('idle');
  }, []);

  const persist = useCallback(
    (next: Memory) => {
      memory.current = next;
      if (userId) saveMemory(userId, next);
    },
    [userId],
  );

  // ── his corner ─────────────────────────────────────────────────────────────
  useLayoutEffect(() => {
    const area = scroller();
    const update = () => {
      const rtl = getComputedStyle(containerRef.current ?? document.documentElement).direction === 'rtl';
      const next = dockGeometry(areaOf(area), window.innerWidth, rtl, window.innerWidth < 768, settings.size);
      setGeo((was) => (JSON.stringify(was) === JSON.stringify(next) ? was : next));
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

  // His corner moved (rotation, a resized window, a phone's toolbar): he is in it at once.
  useEffect(() => {
    if (!geo || xNow.current === null || phase.current === 'waiting' || phase.current === 'entering' || phase.current === 'leaving') return;
    xNow.current = geo.spots[0];
    setMoveMs(0);
    setX(geo.spots[0]);
    setFacing(geo.facing);
  }, [geo]);

  // ── a hidden tab: he stops ─────────────────────────────────────────────────
  useEffect(() => {
    const onVis = () => setPageShown(document.visibilityState === 'visible');
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, []);

  // ── suggestions ────────────────────────────────────────────────────────────
  const contextFor = useCallback(
    (trigger: TriggerId): Context => {
      const now = Date.now();
      return { screen, trigger, audience, lastTool, can: (action: TipAction) => canRun(action, can), now, today: dayOf(now) };
    },
    [audience, can, lastTool, screen],
  );

  const placeSign = useCallback(() => {
    const sign = signEl.current;
    const box = foxBox.current;
    const g = geoRef.current;
    if (!sign || !box || !g) return;
    const width = window.innerWidth;
    const r = box.getBoundingClientRect();
    const at = { left: r.left, right: r.right, top: r.top, height: r.height };
    const room = { width, topLimit: g.topLimit, floor: g.floor };
    // Two steps: the width first (the text wraps to it), then the height it takes.
    const first = signPlacement(at, sign.offsetHeight, room, facingRef.current);
    sign.style.width = `${first.width}px`;
    const placed = signPlacement(at, sign.offsetHeight, room, facingRef.current);
    if (placed.below) {
      // Nothing below him in his corner: on a very narrow screen the sign goes above him.
      const w = Math.min(placed.width, width - 16);
      const left = Math.min(Math.max(8, (at.left + at.right) / 2 - w / 2), width - w - 8);
      const above = at.top - 4 - g.topLimit;
      setSignPos({ left: Math.round(left), top: Math.round(Math.max(g.topLimit, at.top - sign.offsetHeight - 4)), width: w, below: false, maxHeight: above < sign.offsetHeight ? Math.round(above) : null });
      return;
    }
    setSignPos(placed);
  }, []);

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
    [choose, closeSign, later, locale, persist, play, reduced, t],
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
    phase.current = phase.current === 'sign' ? 'idle' : phase.current;
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
  /** Walk (or run) to `target` at his natural rhythm, his steps matched to the ground he covers. */
  const walkTo = useCallback(
    (target: number, run = false) =>
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
        const clip = run ? choose('run') : 'walk';
        const gait = clip === 'run' ? 'run' : 'walk';
        setFacing(target < from ? 'left' : 'right');
        const pxPerSec = gaitSpeed(gait, g.height, settings.speed);
        fox.current?.play(clip, { params: { cycle: strideCycle(gait, pxPerSec, g.height) } });
        const ms = Math.round((dist / pxPerSec) * 1000);
        setMoveMs(ms);
        xNow.current = target;
        setX(target);
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
      await walkTo(g.offstage);
    } else {
      setFaded(true);
      await wait(350);
    }
    await account?.refresh();
    return true;
  }, [account, allowed, clearTimers, play, reduced, savePrefs, wait, walkTo]);

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

  // ── his entrance: once a visit, from the edge of the screen into his corner ──
  useEffect(() => {
    if (!geo || !userId || phase.current !== 'waiting') return;
    memory.current = loadMemory(userId);
    phase.current = 'entering';
    const move = ++moves.current;
    const walkIn = !visit.entered && !reduced && allowed('walk');
    visit.entered = true;
    const spot = geo.spots[0];
    xNow.current = walkIn ? geo.offstage : spot;
    setMoveMs(0);
    setX(xNow.current);
    setFacing(geo.facing);
    // Back on another screen of this visit he is simply there.
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
      lastEvent.current = Date.now();
      if (walkIn) fox.current?.play('idle');
      if (!visit.greeted) await greet(walkIn);
    })();
  }, [geo, userId]); // eslint-disable-line react-hooks/exhaustive-deps

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
      if (d < NEAR) wake();
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
  }, [scroller, wake]);

  // ── the quiet loop: a suggestion now and then; sitting, then dozing, after a long quiet ──
  useEffect(() => {
    if (!geo || !pageShown || !owns) return;
    const generation = ++loop.current;
    const tick = () => {
      if (!alive.current || generation !== loop.current) return;
      const now = Date.now();
      const busy = phase.current !== 'idle' || menu !== null || roulette !== null || tip !== null;
      if (!busy && now - lastInput.current > QUIET_MS) {
        if (now - arrivedAt.current >= settings.tipAfterSec * 1000 && offer('idle')) return;
        const still = now - lastEvent.current;
        if (posture.current !== 'doze' && still >= settings.restAfterSec * 1000 && allowed('rest')) {
          posture.current = 'doze';
          fox.current?.play('rest');
        } else if (posture.current === 'stand' && still >= SIT_AFTER_MS) {
          posture.current = 'sit';
          fox.current?.play(choose('sit'));
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
  }, [geo, pageShown, owns, menu, roulette, tip, settings, offer, later, allowed, choose]);

  // ── good news from elsewhere on the page ───────────────────────────────────
  const onEvent = useCallback(
    (event: CompanionEvent) => {
      if (!settings.celebrate || phase.current !== 'idle' || menu !== null || roulette !== null) return;
      takePending();
      posture.current = 'stand';
      void play(choose('celebrate')).then(() => {
        if (!offer(event.type === 'saved' ? 'afterSave' : 'afterComplete') && phase.current === 'idle') settle();
      });
    },
    [choose, menu, offer, play, roulette, settings.celebrate, settle],
  );
  useCompanionEvents(onEvent);

  // ── the menu's place: above him, beside him, or above him with its entries scrolling ──
  useLayoutEffect(() => {
    if (!menu || !menuEl.current || !geo || xNow.current === null) return;
    const width = window.innerWidth;
    const m = menuEl.current;
    const top = geo.topLimit;
    const foxLeft = xNow.current - geo.width / 2;
    const foxRight = xNow.current + geo.width / 2;
    const above = geo.floor - geo.height - 6 - top;
    const beside = facing === 'left' ? foxLeft - 12 : width - foxRight - 12;
    let left: number;
    let at: number;
    let maxHeight: number | null = null;
    if (m.offsetHeight <= above) {
      left = xNow.current - m.offsetWidth / 2;
      at = geo.floor - geo.height - 6 - m.offsetHeight;
    } else if (beside >= m.offsetWidth) {
      left = facing === 'left' ? foxLeft - m.offsetWidth - 4 : foxRight + 4;
      at = Math.max(top, geo.floor - m.offsetHeight);
      if (m.offsetHeight > geo.floor - top) maxHeight = geo.floor - top;
    } else {
      left = xNow.current - m.offsetWidth / 2;
      at = top;
      maxHeight = Math.max(160, above);
    }
    setMenuPos({ left: Math.round(Math.min(Math.max(8, left), Math.max(8, width - m.offsetWidth - 8))), top: Math.round(at), maxHeight: maxHeight === null ? null : Math.round(maxHeight) });
  }, [menu, geo, facing]);

  useLayoutEffect(() => {
    if (!tip) return;
    // The sign takes its place once he holds the post up (the next frames), and again when his corner moves.
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
    // Asked for: no hello on top (on his way in he finishes walking into his corner).
    visit.greeted = true;
    hello.current += 1;
    posture.current = 'stand';
    lastEvent.current = Date.now();
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
    if (phase.current === 'idle') fox.current?.play('idle');
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

  if (!geo) return <div aria-hidden="true" className="hidden" data-sketchy-stage="waiting" />;

  const scene =
    x !== null && owns ? (
      <div className="pointer-events-none fixed inset-0 z-30 overflow-hidden" data-sketchy-stage={screen} data-sketchy-dock="" data-sketchy-motion={reduced ? 'reduced' : 'full'}>
        <div
          ref={foxBox}
          className="pointer-events-none absolute left-0 top-0"
          style={{
            transform: `translate3d(${Math.round(x - geo.width / 2)}px, ${Math.round(geo.floor - geo.height)}px, 0)`,
            transition: `transform ${moveMs}ms linear, opacity 320ms ease`,
            opacity: faded ? 0 : 1,
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
            below={false}
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
      </div>
    ) : null;

  return (
    <>
      {scene && createPortal(scene, document.body)}

      {roulette && (
        <Roulette
          open
          onOpenChange={(o) => {
            if (!o) {
              setRoulette(null);
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
