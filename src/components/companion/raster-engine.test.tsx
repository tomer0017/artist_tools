import {afterEach,describe,expect,it,vi} from 'vitest';
import {cleanup,render} from '@testing-library/react';
import {ANIMATIONS} from '@/lib/companion/model';
import {RasterRig} from './raster-rig';
import {RasterEngine, WALK_STRIDE, walkCycle, walkSpeed} from './raster-engine';
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

  it('walks frame by frame through the founder\'s cycle, at the cycle he is given, and cross-fades back', () => {
    let now = 1000;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    vi.spyOn(window, 'requestAnimationFrame').mockReturnValue(1);
    const view = render(<RasterRig pose="walk" />);
    const engine = new RasterEngine(view.container, { idleLife: false }, () => {});
    const strip = () => view.container.querySelector<HTMLElement>('[data-raster-walk]')!;
    const frameAt = () => Number(strip().dataset.frame);
    engine.play('walk', { params: { cycle: 0.8 } });
    expect(view.container.hasAttribute('data-walking')).toBe(true);
    const seen: number[] = [];
    for (let t = 0; t < 800; t += 100) {
      now = 1000 + t + 1;
      engine.renderNow();
      seen.push(frameAt());
    }
    expect(seen).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    now = 1801;
    engine.renderNow();
    expect(frameAt()).toBe(0);
    engine.play('idle');
    expect(view.container.hasAttribute('data-walking')).toBe(false);
    engine.dispose();
  });

  it('crosses the screen at the pace of his steps (his feet stay put), the admin speed scaling both', () => {
    expect(walkCycle()).toBeCloseTo(0.96, 6);
    expect(walkSpeed(360) * walkCycle()).toBeCloseTo(WALK_STRIDE, 6);
    expect(walkSpeed(180) * walkCycle()).toBeCloseTo(WALK_STRIDE / 2, 6);
    expect(walkCycle(200)).toBeCloseTo(0.48, 6);
    expect(walkSpeed(180, 200) * walkCycle(200)).toBeCloseTo(WALK_STRIDE / 2, 6);
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
