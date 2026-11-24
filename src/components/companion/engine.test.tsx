import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { ANIMATIONS } from '@/lib/companion/model';
import { SketchyRig, PART_IDS } from './rig';
import { SketchyEngine } from './engine';

// The pose engine on the real puppet (ADR-0024): it moves only the rig's own
// groups, shows one mouth and one pair of eyes at a time, shows a prop only
// while a clip holds it, and with reduced motion draws a still frame without
// ever starting an animation loop.

afterEach(cleanup);

function rig() {
  const { container } = render(<SketchyRig />);
  return container.querySelector('svg')!;
}

const visible = (el: Element | null) => el !== null && !(el.getAttribute('style') ?? '').includes('display:none') && !(el.getAttribute('style') ?? '').includes('display: none');

describe('the puppet', () => {
  it('has every part the engine moves, and no text in the picture', () => {
    const svg = rig();
    for (const part of PART_IDS) expect(svg.querySelector(`[data-part="${part}"]`), part).not.toBeNull();
    expect(svg.querySelector('text')).toBeNull();
    expect(svg.getAttribute('aria-hidden')).toBe('true');
  });

  it('two puppets on one page never share gradient ids', () => {
    const { container } = render(
      <>
        <SketchyRig />
        <SketchyRig />
      </>,
    );
    const ids = [...container.querySelectorAll('[id]')].map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('the engine', () => {
  it('draws any moment of any clip with transforms on the rig’s own groups', () => {
    const svg = rig();
    const engine = new SketchyEngine(svg, { idleLife: false });
    for (const id of ANIMATIONS) {
      engine.renderAt(id, 0.3, { aim: 20 });
      for (const el of svg.querySelectorAll('[transform]')) expect(el.getAttribute('transform')).not.toMatch(/NaN|Infinity/);
    }
    engine.renderAt('wave', 0.9);
    expect(svg.querySelector('[data-part="armFront"]')!.getAttribute('transform')).toMatch(/rotate\(-1[0-9]{2}/);
    engine.dispose();
  });

  it('shows one face at a time and props only while held', () => {
    const svg = rig();
    const engine = new SketchyEngine(svg, { idleLife: false });
    engine.renderAt('laugh', 0.6);
    expect(visible(svg.querySelector('[data-eyes-alt="happy"]'))).toBe(true);
    expect(visible(svg.querySelector('[data-eyes="open"]'))).toBe(false);
    expect([...svg.querySelectorAll('[data-mouth]')].filter(visible).map((m) => m.getAttribute('data-mouth'))).toEqual(['open']);
    engine.renderAt('holdSign', 0);
    expect(visible(svg.querySelector('[data-prop="sign"]'))).toBe(true);
    expect(visible(svg.querySelector('[data-prop="pencil"]'))).toBe(false);
    engine.renderAt('draw', 0.4);
    expect(visible(svg.querySelector('[data-prop="pencil"]'))).toBe(true);
    expect(visible(svg.querySelector('[data-prop="sign"]'))).toBe(false);
    engine.renderAt('rest', 0);
    expect(visible(svg.querySelector('[data-eyes-alt="closed"]'))).toBe(true);
    expect(visible(svg.querySelector('[data-fx="zzz"]'))).toBe(true);
    engine.dispose();
  });

  it('with reduced motion: a still frame, never an animation loop, and a clip that ends still ends', () => {
    const raf = vi.spyOn(window, 'requestAnimationFrame');
    const svg = rig();
    const engine = new SketchyEngine(svg, { reducedMotion: true });
    vi.useFakeTimers();
    const ended = vi.fn();
    engine.play('celebrate', { onEnd: ended });
    engine.play('walk');
    expect(raf).not.toHaveBeenCalled();
    engine.play('jump', { onEnd: ended });
    vi.advanceTimersByTime(700);
    expect(ended).toHaveBeenCalled();
    vi.useRealTimers();
    engine.dispose();
    raf.mockRestore();
  });

  it('stops drawing when paused and when disposed', () => {
    const raf = vi.spyOn(window, 'requestAnimationFrame').mockImplementation(() => 1);
    const cancel = vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {});
    const engine = new SketchyEngine(rig());
    engine.play('walk');
    expect(raf).toHaveBeenCalled();
    engine.pause();
    expect(cancel).toHaveBeenCalled();
    raf.mockClear();
    engine.play('run');
    expect(raf).not.toHaveBeenCalled();
    engine.dispose();
    raf.mockRestore();
    cancel.mockRestore();
  });
});
