import { describe, expect, it } from 'vitest';
import { ANIMATIONS } from '@/lib/companion/model';
import { CLIPS } from './clips';
import { EYES, MOUTHS, PART_IDS, PROPS, FX } from './rig';

// Sketchy's animations (ADR-0024): one clip per animation the admin can
// switch, each a pure function of time that only ever names real parts,
// faces, props and effects, with finite values all the way through.

describe('the clips', () => {
  it('there is exactly one clip per animation', () => {
    expect(Object.keys(CLIPS).sort()).toEqual([...ANIMATIONS].sort());
    for (const id of ANIMATIONS) expect(CLIPS[id].id).toBe(id);
  });

  it('every moment of every clip names real parts and gives finite values', () => {
    for (const id of ANIMATIONS) {
      const clip = CLIPS[id];
      expect(clip.stillAt).toBeGreaterThanOrEqual(0);
      expect(clip.stillAt).toBeLessThanOrEqual(clip.duration);
      for (let i = 0; i <= 24; i++) {
        const pose = clip.sample((clip.duration * i) / 24, { aim: 30 });
        for (const [part, channels] of Object.entries(pose.parts)) {
          expect(PART_IDS, `${id}: ${part}`).toContain(part);
          for (const v of Object.values(channels ?? {})) expect(Number.isFinite(v), `${id} ${part} at ${i}`).toBe(true);
        }
        if (pose.eyes) expect(EYES).toContain(pose.eyes);
        if (pose.mouth) expect(MOUTHS).toContain(pose.mouth);
        for (const p of pose.props ?? []) expect(PROPS).toContain(p);
        for (const f of pose.fx ?? []) expect(FX).toContain(f);
        if (pose.lift !== undefined) expect(pose.lift).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('walking and running carry him forward; jumping and celebrating leave the ground and land again', () => {
    expect(CLIPS.walk.speed).toBeGreaterThan(0);
    expect(CLIPS.run.speed!).toBeGreaterThan(CLIPS.walk.speed!);
    for (const id of ['jump', 'celebrate'] as const) {
      const clip = CLIPS[id];
      const lifts = Array.from({ length: 50 }, (_, i) => clip.sample((clip.duration * i) / 49).lift ?? 0);
      expect(Math.max(...lifts)).toBeGreaterThan(20);
      expect(lifts[0]).toBe(0);
      expect(lifts[lifts.length - 1]).toBe(0);
    }
  });

  it('holding a sign shows the sign; drawing shows the pencil and the pad; pointing shows the finger', () => {
    expect(CLIPS.holdSign.sample(0).props).toContain('sign');
    expect(CLIPS.draw.sample(0.4).props).toEqual(expect.arrayContaining(['pencil', 'pad']));
    expect(CLIPS.point.sample(0.3).props).toContain('finger');
  });

  it('pointing follows the aim: further down for a card below', () => {
    const ahead = CLIPS.point.sample(0, { aim: 0 }).parts.armFront!.r!;
    const down = CLIPS.point.sample(0, { aim: 60 }).parts.armFront!.r!;
    expect(down).toBeGreaterThan(ahead);
  });
});
