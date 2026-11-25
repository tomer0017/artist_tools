import {afterEach,describe,expect,it,vi} from 'vitest';
import {act,cleanup,render} from '@testing-library/react';
import {ART_SCENES,ArtScene,SCENES} from './ArtScene';
afterEach(()=>{cleanup();vi.restoreAllMocks();vi.useRealTimers();});
describe('hero art sequences',()=>{
 it.each(ART_SCENES)('%s advances actual sprite frames and completes once',async id=>{
  vi.useFakeTimers();const end=vi.fn();const view=render(<ArtScene id={id} locale="en" paused={false} reducedMotion={false} onEnd={end}/>);
  const frame=()=>view.container.querySelector('[data-art-frame]')?.getAttribute('data-art-frame');
  expect(frame()).toBe('0');await act(async()=>{await vi.advanceTimersByTimeAsync(SCENES[id].beat+100)});expect(frame()).toBe('1');
  await act(async()=>{await vi.advanceTimersByTimeAsync(20_000)});expect(end).toHaveBeenCalledOnce();
 });
 it('stops time while offscreen and never autoplays reduced motion',async()=>{
  vi.useFakeTimers();const end=vi.fn();const view=render(<ArtScene id="dream" locale="he" paused reducedMotion={false} onEnd={end}/>);
  await act(async()=>{await vi.advanceTimersByTimeAsync(20_000)});expect(view.container.querySelector('[data-art-frame]')).toHaveAttribute('data-art-frame','0');expect(end).not.toHaveBeenCalled();
  view.rerender(<ArtScene id="dream" locale="he" paused={false} reducedMotion onEnd={end}/>);
  await act(async()=>{await vi.advanceTimersByTimeAsync(20_000)});expect(view.container.querySelector('[data-art-frame]')).toHaveAttribute('data-art-frame','5');expect(end).not.toHaveBeenCalled();
 });
});

it('does not finish twice after pause/resume, and restarts when scene id changes',async()=>{
 vi.useFakeTimers();const end=vi.fn();
 const view=render(<ArtScene id="sunflowers" locale="en" paused={false} reducedMotion={false} onEnd={end}/>);
 await act(async()=>{await vi.advanceTimersByTimeAsync(20_000)});
 view.rerender(<ArtScene id="sunflowers" locale="en" paused reducedMotion={false} onEnd={end}/>);
 view.rerender(<ArtScene id="sunflowers" locale="en" paused={false} reducedMotion={false} onEnd={end}/>);
 await act(async()=>{await vi.advanceTimersByTimeAsync(1000)});expect(end).toHaveBeenCalledOnce();
 view.rerender(<ArtScene id="pearl" locale="en" paused={false} reducedMotion={false} onEnd={end}/>);
 expect(view.container.querySelector('[data-art-frame]')).toHaveAttribute('data-art-frame','0');
 await act(async()=>{await vi.advanceTimersByTimeAsync(SCENES.pearl.beat+100)});
 expect(view.container.querySelector('[data-art-frame]')).toHaveAttribute('data-art-frame','1');
});
