import {afterEach,describe,expect,it,vi} from 'vitest';
import {cleanup,render} from '@testing-library/react';
import {ANIMATIONS} from '@/lib/companion/model';
import {RasterRig} from './raster-rig';
import {CADENCE, RasterEngine, SWING, gaitSpeed, strideCycle} from './raster-engine';
afterEach(()=>{cleanup();vi.restoreAllMocks();vi.useRealTimers();});
function setup(id:'idle'|'walk'|'jump'='idle',reducedMotion=false){
 vi.spyOn(HTMLCanvasElement.prototype,'getContext').mockReturnValue(null);
 const view=render(<RasterRig pose={id}/>);
 const select=(next:typeof ANIMATIONS[number])=>view.rerender(<RasterRig pose={next}/>);
 return {view,engine:new RasterEngine(view.container,{reducedMotion},select)};
}
describe('official raster renderer',()=>{
 it('uses approved assets for every state, and retains controller anchors',()=>{
  const {view,engine}=setup();
  for(const id of ANIMATIONS){engine.play(id);engine.renderNow();expect(view.container.querySelector('img')?.src).toContain(`/sketchy/${id}.webp`);expect(view.container.querySelector('[data-anchor="shoulder"]')).not.toBeNull();expect(view.container.querySelector('svg')?.dataset.pose).toBe(id);}
  engine.dispose();
 });
 it('cancels obsolete reduced-motion completions when another clip starts',async()=>{
  vi.useFakeTimers();const {engine}=setup('idle',true);const ended=vi.fn();
  engine.play('jump',{onEnd:ended});engine.play('walk');await vi.advanceTimersByTimeAsync(700);expect(ended).not.toHaveBeenCalled();
  engine.play('jump',{onEnd:ended});await vi.advanceTimersByTimeAsync(700);expect(ended).toHaveBeenCalledOnce();engine.dispose();
 });
 it('does not run an animation loop with reduced motion',()=>{
  const raf=vi.spyOn(window,'requestAnimationFrame');const {engine}=setup('idle',true);
  engine.play('walk');engine.look({x:1,y:-1});expect(raf).not.toHaveBeenCalled();engine.dispose();
 });
 it('pauses drawing and prevents callbacks after disposal',()=>{
  vi.useFakeTimers();const raf=vi.spyOn(window,'requestAnimationFrame').mockReturnValue(1);
  const {engine}=setup();engine.play('walk');expect(raf).toHaveBeenCalled();engine.pause();raf.mockClear();engine.play('run');expect(raf).not.toHaveBeenCalled();engine.dispose();
  const {engine:still}=setup('idle',true);const ended=vi.fn();still.play('jump',{onEnd:ended});still.dispose();vi.advanceTimersByTime(800);expect(ended).not.toHaveBeenCalled();
 });
});

describe('walking, looking (the remaster fixes)', () => {
  const angle = (container: HTMLElement, part: string) => {
    const m = /rotate\((-?[\d.]+)/.exec(container.querySelector(`[data-part="${part}"]`)?.getAttribute('transform') ?? '');
    return m ? Number(m[1]) : NaN;
  };

  it('matches his steps to the ground he covers, within sane bounds', () => {
    // One cycle covers 4 × leg × sin(swing) sprite pixels, scaled to his height.
    const perCycle = (clip: 'walk' | 'run', h: number) => 4 * 78 * Math.sin((SWING[clip] * Math.PI) / 180) * (h / 360);
    const walk = strideCycle('walk', 48, 168);
    expect(walk * 48).toBeCloseTo(perCycle('walk', 168), 5);
    expect(strideCycle('walk', 64, 168)).toBeCloseTo((walk * 48) / 64, 5);
    expect(strideCycle('run', 86, 168) * 86).toBeCloseTo(perCycle('run', 168), 5);
    // Never a frantic shuffle or a slow-motion stride.
    expect(strideCycle('walk', 10_000, 168)).toBe(0.42);
    expect(strideCycle('walk', 1, 168)).toBe(1.6);
  });

  it('walks in two identical steps a cycle: legs toward each other and back, never past the drawing (no limp)', () => {
    let now = 1000;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    vi.spyOn(window, 'requestAnimationFrame').mockReturnValue(1);
    const view = render(<RasterRig pose="walk" />);
    const engine = new RasterEngine(view.container, { idleLife: false }, () => {});
    engine.play('walk', { params: { cycle: 0.8 } });
    const legs = () => [angle(view.container, 'legBack'), angle(view.container, 'legFront')];
    now = 1200; // the first passing moment
    engine.renderNow();
    const first = legs();
    expect(first[0]).toBeCloseTo(-SWING.walk, 1);
    expect(first[1]).toBeCloseTo(SWING.walk, 1);
    now = 1400; // contact: the drawn stride
    engine.renderNow();
    expect(legs().map((a) => Math.abs(a))).toEqual([0, 0]);
    now = 1600; // the second step is the same as the first
    engine.renderNow();
    expect(legs()[0]).toBeCloseTo(first[0], 1);
    expect(legs()[1]).toBeCloseTo(first[1], 1);
    // Never beyond the drawing: the back leg only ever turns forward, the front one only back.
    for (let t = 1000; t <= 1800; t += 37) {
      now = t;
      engine.renderNow();
      const [back, front] = legs();
      expect(back).toBeLessThanOrEqual(0.001);
      expect(front).toBeGreaterThanOrEqual(-0.001);
    }
    engine.dispose();
  });

  it('crosses the screen at his natural, calm rhythm, his feet keeping pace', () => {
    for (const clip of ['walk', 'run'] as const) for (const h of [112, 150]) expect(strideCycle(clip, gaitSpeed(clip, h), h)).toBeCloseTo(CADENCE[clip], 6);
    expect(CADENCE.walk).toBeGreaterThanOrEqual(0.9);
    expect(gaitSpeed('walk', 150, 200)).toBeCloseTo(2 * gaitSpeed('walk', 150), 6);
  });

  it('turns his head smoothly toward what he looks at, and keeps still with less motion', () => {
    let now = 1000;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    vi.spyOn(window, 'requestAnimationFrame').mockReturnValue(1);
    const view = render(<RasterRig pose="idle" />);
    const engine = new RasterEngine(view.container, { idleLife: false }, () => {});
    engine.play('idle');
    engine.look({ x: 0, y: 1 });
    now += 50;
    engine.renderNow();
    const first = angle(view.container, 'head');
    expect(first).toBeGreaterThan(0);
    expect(first).toBeLessThan(4.5);
    for (let i = 0; i < 8; i++) {
      now += 100;
      engine.renderNow();
    }
    expect(angle(view.container, 'head')).toBeCloseTo(4.5, 1);
    engine.look(null);
    for (let i = 0; i < 8; i++) {
      now += 100;
      engine.renderNow();
    }
    expect(Math.abs(angle(view.container, 'head'))).toBeLessThan(0.05);
    engine.dispose();

    const still = render(<RasterRig pose="idle" />);
    const calm = new RasterEngine(still.container, { reducedMotion: true }, () => {});
    calm.play('idle');
    calm.look({ x: 1, y: 1 });
    now += 500;
    calm.renderNow();
    expect(angle(still.container, 'head')).toBe(0);
    calm.dispose();
  });
});
