import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { useLocale, useTranslations } from 'use-intl';
import { dayOf, mayOffer, pickTip, remember, snooze, type Context, type Memory } from '@/lib/companion/brain';
import { canRun } from '@/lib/companion/registry';
import type { AnimationId, Audience, CompanionTip, Mood, ScreenId, TipAction, TriggerId } from '@/lib/companion/model';
import { classModeOn } from '@/lib/learn/class-mode';
import { useAccount } from '@/components/shell/account';
import { useCourseStart } from '@/components/learn/useCourseStart';
import { CLIPS } from './clips';
import { aimAt, geometryOf, signPlacement, type Geometry, type Measured } from './geometry';
import { Menu } from './Menu';
import { Roulette } from './Roulette';
import { Sign } from './Sign';
import { Sketchy, type SketchyHandle } from './Sketchy';
import { useAbilities, useRunAction, type MenuView } from './actions';
import { loadMemory, saveMemory, stageMounted, takePending, useCompanionEvents, useCompanionPrefs, useLastTool, useReducedMotion, type CompanionEvent, type CompanionView } from './state';

// ─── The stage (ADR-0024) ──────────────────────────────────────────────────────
// Sketchy's place on a screen and what he does there. He stands on the floor
// line of the screen's top area (Home's hero, the Learn home's header), only
// on the free side of its text (geometry.ts), and:
//   - walks in from the edge, looks around and waves; the first time he
//     introduces himself, on a new day he says hello;
//   - after a save or a completed lesson or challenge he celebrates and
//     offers what could come next;
//   - after a quiet while he may hold up a sign with a suggestion (the pace,
//     the daily cap and "Not now" are the admin's, ../../lib/companion/brain);
//   - now and then he walks to another free spot, sits, sketches, or rests;
//   - a click (or Enter) opens his menu; he never moves while it, a sign or
//     the roulette is open, and never offers anything while the person is
//     using the page (a tap, a key or a scroll in the last seconds).
// Off screen or in a hidden tab he stops completely (no frames, no timers
// that do work). With reduced motion he does not walk: he appears, and every
// pose is still.

export interface StageProps {
  screen: ScreenId;
  /** The element he lives in (position: relative); his floor, text to avoid and top limit are found inside it. */
  containerRef: RefObject<HTMLElement | null>;
  /** He stands on this element's bottom edge (or on the first match of `floorSelector` inside the container). */
  floorRef?: RefObject<HTMLElement | null>;
  floorSelector?: string;
  view: CompanionView;
}

type Phase = 'waiting' | 'entering' | 'idle' | 'walking' | 'sign' | 'leaving';

const QUIET_MS = 4000;
const SIGN_TIMEOUT_MS = 40_000;
const MICRO_MIN_MS = 18_000;

function measureStage(container: HTMLElement, floor: HTMLElement): Measured | null {
  const c = container.getBoundingClientRect();
  const f = floor.getBoundingClientRect();
  if (c.width === 0 || f.height === 0) return null;
  const rtl = getComputedStyle(container).direction === 'rtl';
  let textEnd = 0;
  for (const el of container.querySelectorAll<HTMLElement>('[data-sketchy-avoid]')) {
    const range = document.createRange();
    range.selectNodeContents(el);
    for (const r of range.getClientRects()) {
      if (r.width === 0 || r.bottom < f.top || r.top > f.bottom) continue;
      textEnd = Math.max(textEnd, rtl ? c.right - r.left : r.right - c.left);
    }
  }
  const top = container.querySelector<HTMLElement>('[data-sketchy-top]');
  const topLimit = (top ? top.getBoundingClientRect().bottom : f.top) - c.top + 6;
  return { width: c.width, floor: f.bottom - c.top - 2, textEnd, topLimit, rtl, narrow: window.innerWidth < 768 };
}

export function Stage({ screen, containerRef, floorRef: floorRefProp, floorSelector, view }: StageProps) {
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

  const [geo, setGeo] = useState<Geometry | null>(null);
  const [x, setX] = useState<number | null>(null);
  const [facing, setFacing] = useState<'left' | 'right'>('left');
  // Read where he faces now (callbacks made at his entrance outlive that render).
  const facingRef = useRef(facing);
  facingRef.current = facing;
  const [moveMs, setMoveMs] = useState(0);
  const [faded, setFaded] = useState(true);
  const [visible, setVisible] = useState(true);
  const [tip, setTip] = useState<CompanionTip | null>(null);
  const [signPos, setSignPos] = useState<{ left: number; top: number; width: number; below: boolean } | null>(null);
  const [menu, setMenu] = useState<MenuView | null>(null);
  const [menuPos, setMenuPos] = useState<{ left: number; top: number } | null>(null);
  const [roulette, setRoulette] = useState<{ mood?: Mood; classMode?: boolean } | null>(null);
  const [said, setSaid] = useState('');

  const fox = useRef<SketchyHandle>(null);
  const foxBox = useRef<HTMLDivElement>(null);
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

  // ── geometry ───────────────────────────────────────────────────────────────
  useLayoutEffect(() => {
    const container = containerRef.current;
    const floor = floorRef.current;
    if (!container || !floor) return;
    const update = () => {
      const measured = measureStage(container, floor);
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
  }, [containerRef, floorRef, settings.size]);

  // Keep him on a valid spot when the room changes (rotation, resizing).
  useEffect(() => {
    if (!geo || xNow.current === null || phase.current === 'waiting' || phase.current === 'entering') return;
    const spot = geo.spots[Math.min(spotIndex.current, geo.spots.length - 1)];
    spotIndex.current = Math.min(spotIndex.current, geo.spots.length - 1);
    xNow.current = spot;
    setMoveMs(0);
    setX(spot);
    setFacing(geo.facing);
  }, [geo]);

  // ── the person's input (he never interrupts it) and where the pointer is ──
  useEffect(() => {
    const container = containerRef.current;
    const scroller = container?.closest('.overflow-y-auto') ?? window;
    const input = () => {
      lastInput.current = Date.now();
    };
    let lookAt = 0;
    const onMove = (event: PointerEvent) => {
      if (event.pointerType !== 'mouse' || !foxBox.current) return;
      const now = performance.now();
      if (now - lookAt < 60) return;
      lookAt = now;
      const r = foxBox.current.getBoundingClientRect();
      const hx = r.left + r.width / 2;
      const hy = r.top + r.height * 0.3;
      const dx = event.clientX - hx;
      const dy = event.clientY - hy;
      const d = Math.hypot(dx, dy);
      if (d > 420) {
        fox.current?.look(null);
        return;
      }
      // Waking up when the pointer comes close.
      if (d < 140 && restingSince.current !== null && phase.current === 'idle') {
        restingSince.current = null;
        lastEvent.current = Date.now();
        void play('curious', 1400).then(() => phase.current === 'idle' && rest());
      }
      const facingSign = foxBox.current.querySelector('[data-facing="left"]') ? -1 : 1;
      fox.current?.look({ x: (dx / Math.max(d, 1)) * facingSign, y: dy / Math.max(d, 1) });
    };
    window.addEventListener('pointerdown', input, { passive: true });
    window.addEventListener('keydown', input);
    window.addEventListener('pointermove', onMove, { passive: true });
    scroller.addEventListener('scroll', input, { passive: true });
    return () => {
      window.removeEventListener('pointerdown', input);
      window.removeEventListener('keydown', input);
      window.removeEventListener('pointermove', onMove);
      scroller.removeEventListener('scroll', input);
    };
  }, [containerRef, play, rest]);

  // ── seen or not (off screen, hidden tab: he stops) ─────────────────────────
  useEffect(() => {
    const el = foxBox.current;
    if (!el) return;
    let inView = true;
    let shown = document.visibilityState === 'visible';
    const apply = () => setVisible(inView && shown);
    const io = new IntersectionObserver((entries) => {
      inView = entries.some((e) => e.isIntersecting && e.intersectionRatio > 0.25);
      apply();
    }, { threshold: [0, 0.25, 0.6] });
    io.observe(el);
    const onVis = () => {
      shown = document.visibilityState === 'visible';
      apply();
    };
    document.addEventListener('visibilitychange', onVis);
    return () => {
      io.disconnect();
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [x !== null]); // eslint-disable-line react-hooks/exhaustive-deps

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
    const container = containerRef.current;
    const sign = signEl.current;
    const box = foxBox.current;
    if (!container || !sign || !box || !geo) return;
    const c = container.getBoundingClientRect();
    const r = box.getBoundingClientRect();
    const measured = measureStage(container, floorRef.current!);
    const fox = { left: r.left - c.left, right: r.right - c.left, top: r.top - c.top, height: r.height };
    const stage = { width: c.width, topLimit: measured?.topLimit ?? 8, floor: geo.floor };
    // Two steps: the width first (the text wraps to it), then the height it takes.
    const first = signPlacement(fox, sign.offsetHeight, stage, facingRef.current);
    sign.style.width = `${first.width}px`;
    setSignPos(signPlacement(fox, sign.offsetHeight, stage, facingRef.current));
  }, [containerRef, floorRef, geo]);

  const present = useCallback(
    async (next: CompanionTip) => {
      if (!fox.current || !geo) return;
      phase.current = 'sign';
      restingSince.current = null;
      const now = Date.now();
      persist(remember(memory.current!, next, now, dayOf(now)));
      // The move that comes with it: pointing at the tool card it is about, or its own animation.
      const target = next.action.type === 'openTool' ? containerRef.current?.querySelector(`[data-tool-card="${next.action.tool}"]`) : null;
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
      later(320, placeSign);
      later(SIGN_TIMEOUT_MS, () => {
        if (phase.current === 'sign') closeSign(false);
      });
    },
    // closeSign is stable enough (declared below with the same dependencies).
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [allowed, choose, containerRef, geo, later, locale, persist, placeSign, play, t],
  );

  const closeSign = useCallback(
    (snoozed: boolean) => {
      setTip((shown) => {
        // "Not now" on his introduction is not a "be quiet for a day".
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
  const host = useMemo(() => ({ openRoulette: (o: { mood?: Mood; classMode?: boolean }) => setRoulette(o), openMenu, nextLessonHref: nextLesson && !nextLesson.loading ? nextLesson.href : null }), [nextLesson, openMenu]);
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
    if (can.companion('roulette') && can.challenges === 'open') options.push(() => setRoulette({ mood: 'surprise' }));
    if (can.companion('guide') && drawingTips.length > 0) options.push(() => setMenu('tip'));
    if (can.companion('guide') && nextLesson && !nextLesson.loading) options.push(() => runAction({ type: 'nextLesson', label: { en: '', he: '' } }));
    const idleTip = memory.current ? pickTip(view.tips, contextFor('idle'), memory.current) : null;
    if (idleTip) options.push(() => void present(idleTip));
    if (options.length === 0) return;
    setMenu(null);
    options[Math.floor(Math.random() * options.length)]();
  }, [can, contextFor, drawingTips.length, nextLesson, present, runAction, view.tips]);

  const hide = useCallback(async (): Promise<boolean> => {
    const ok = await savePrefs({ hidden: true }, { refresh: false });
    if (!ok) return false;
    setMenu(null);
    phase.current = 'leaving';
    clearTimers();
    await play('wave', 1800);
    if (geo && !reduced && allowed('walk')) {
      setFacing(geo.offstage > (xNow.current ?? 0) ? 'right' : 'left');
      fox.current?.play(choose('run'));
      const dist = Math.abs(geo.offstage - (xNow.current ?? 0));
      const ms = Math.round((dist / (CLIPS.run.speed! * (geo.height / 292))) * 1000);
      setMoveMs(ms);
      setX(geo.offstage);
      await new Promise((r) => later(ms + 50, () => r(null)));
    } else {
      setFaded(true);
      await new Promise((r) => later(350, () => r(null)));
    }
    await account?.refresh();
    return true;
  }, [account, allowed, choose, clearTimers, geo, later, play, reduced, savePrefs]);

  // ── moving ─────────────────────────────────────────────────────────────────
  const walkTo = useCallback(
    (target: number, run = false) =>
      new Promise<void>((resolve) => {
        if (!geo) return resolve();
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
        fox.current?.play(clip);
        const pxPerSec = CLIPS[clip].speed! * (geo.height / 292) * (settings.speed / 100);
        const ms = Math.round((dist / pxPerSec) * 1000);
        setMoveMs(ms);
        xNow.current = target;
        setX(target);
        lastMove.current = Date.now();
        later(ms + 30, resolve);
      }),
    [allowed, choose, geo, later, reduced, settings.speed],
  );

  // ── his entrance, once the room and his memory are known ───────────────────
  useEffect(() => {
    if (!geo || !userId || phase.current !== 'waiting') return;
    memory.current = loadMemory(userId);
    phase.current = 'entering';
    const start = async () => {
      const spot = geo.spots[0];
      const walkIn = !reduced && allowed('walk');
      xNow.current = walkIn ? geo.offstage : spot;
      setMoveMs(0);
      setX(walkIn ? geo.offstage : spot);
      setFacing(geo.facing);
      await new Promise((r) => later(Math.max(300, settings.firstDelaySec * 1000), () => r(null)));
      setFaded(false);
      if (walkIn) await walkTo(spot);
      setFacing(geo.facing);
      if (!alive.current) return;
      arrivedAt.current = Date.now();
      lastEvent.current = Date.now();
      const pending = takePending();
      const firstTime = memory.current!.metAt === null;
      phase.current = 'idle';
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
    };
    void start();
  }, [geo]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── the quiet loop: a suggestion, a stroll, a sketch, a rest ───────────────
  useEffect(() => {
    if (!geo || !visible) return;
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
            void walkTo(geo.spots[nextSpot]).then(async () => {
              if (!alive.current) return;
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
  }, [geo, visible, menu, roulette, tip, settings, offer, walkTo, play, rest, later, allowed]);

  // ── good news from elsewhere on the page ───────────────────────────────────
  const onEvent = useCallback(
    (event: CompanionEvent) => {
      if (!settings.celebrate || phase.current !== 'idle' || menu !== null) return;
      takePending();
      void play(choose('celebrate')).then(() => {
        if (!offer(event.type === 'saved' ? 'afterSave' : 'afterComplete') && phase.current === 'idle') rest();
      });
    },
    [choose, menu, offer, play, rest, settings.celebrate],
  );
  useCompanionEvents(onEvent);

  // ── the menu's place: above him, beside him, or (narrow screens) just below his feet ──
  useLayoutEffect(() => {
    if (!menu || !menuEl.current || !containerRef.current || !geo || xNow.current === null) return;
    const c = containerRef.current.getBoundingClientRect();
    const m = menuEl.current;
    const measured = measureStage(containerRef.current, floorRef.current!);
    const top = measured?.topLimit ?? 8;
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
  }, [menu, geo, facing, containerRef, floorRef]);

  // Below him there is no post to hold: he points down at the sign instead.
  useEffect(() => {
    if (signPos?.below && allowed('point')) fox.current?.play('point', { params: { aim: 75 } });
  }, [signPos?.below, allowed]);

  useLayoutEffect(() => {
    if (tip) placeSign();
  }, [tip, placeSign, geo]);

  // Escape on a sign closes it (the menu handles its own).
  useEffect(() => {
    if (!tip) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeSign(true);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [tip, closeSign]);

  const onFoxClick = () => {
    if (phase.current === 'leaving') return;
    // Stop where he is.
    if (phase.current === 'walking' && foxBox.current && containerRef.current && geo) {
      const r = foxBox.current.getBoundingClientRect();
      const c = containerRef.current.getBoundingClientRect();
      const here = r.left + r.width / 2 - c.left;
      xNow.current = here;
      setMoveMs(0);
      setX(here);
      phase.current = 'idle';
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

  if (!geo || x === null) return <div aria-hidden="true" className="hidden" data-sketchy-stage="waiting" />;

  const top = geo.floor - geo.height;
  return (
    <div className="pointer-events-none absolute inset-0 z-20 overflow-hidden" data-sketchy-stage={screen} data-sketchy-compact={geo.compact || undefined}>
      <div
        ref={foxBox}
        className="pointer-events-none absolute left-0 top-0"
        style={{
          transform: `translate3d(${Math.round(x - geo.width / 2)}px, ${Math.round(top)}px, 0)`,
          transition: `transform ${moveMs}ms linear, opacity 260ms ease`,
          opacity: faded ? 0 : 1,
          width: geo.width,
          height: geo.height,
        }}
        data-sketchy-fox=""
      >
        <button
          ref={button}
          type="button"
          onClick={onFoxClick}
          aria-label={t('button')}
          aria-expanded={menu !== null}
          aria-haspopup="dialog"
          className="pointer-events-auto absolute inset-x-[14%] bottom-0 top-[6%] rounded-[40%] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          data-sketchy-button=""
        />
        <div className="pointer-events-none absolute inset-0">
          <Sketchy ref={fox} height={geo.height} facing={facing} reducedMotion={reduced} idleLife={settings.idleLife} paused={!visible} initial={reduced ? 'idle' : 'walk'} />
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
          onClose={() => closeSign(true)}
          below={signPos?.below === true}
          style={signPos ? { left: signPos.left, top: signPos.top, width: signPos.width } : { left: -10000, top: 0, visibility: 'hidden' }}
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
          openRoulette={(o) => setRoulette(o)}
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
    </div>
  );
}
