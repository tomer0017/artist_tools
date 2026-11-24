import {afterEach,describe,expect,it,vi} from 'vitest';
import {cleanup,render} from '@testing-library/react';
import {ANIMATIONS} from '@/lib/companion/model';
import {RasterRig} from './raster-rig';
import {RasterEngine} from './raster-engine';
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
