import { afterEach, describe, expect, it } from 'vitest';
import { PRIORITY, claimSketchy, sketchyOwner } from './presence';

// Exactly one Sketchy on screen: the highest claim shows him, the others draw nothing.

const releases: (() => void)[] = [];
const claim = (id: string, priority: number) => {
  const release = claimSketchy(id, priority);
  releases.push(release);
  return release;
};
afterEach(() => {
  for (const release of releases.splice(0)) release();
});

describe('who shows him', () => {
  it('the stage, until the roulette opens; the stage again once it closes', () => {
    claim('stage:home', PRIORITY.stage);
    expect(sketchyOwner()).toBe('stage:home');
    const closeRoulette = claim('roulette', PRIORITY.roulette);
    expect(sketchyOwner()).toBe('roulette');
    closeRoulette();
    expect(sketchyOwner()).toBe('stage:home');
  });

  it('the roulette wins over a celebration, and a celebration over the stage', () => {
    claim('stage:learn', PRIORITY.stage);
    claim('celebration', PRIORITY.celebration);
    expect(sketchyOwner()).toBe('celebration');
    claim('roulette', PRIORITY.roulette);
    expect(sketchyOwner()).toBe('roulette');
  });

  it('nobody, once every claim is released; a stale release never ends a newer claim', () => {
    const first = claim('stage:home', PRIORITY.stage);
    claim('stage:home', PRIORITY.stage);
    first();
    expect(sketchyOwner()).toBe('stage:home');
    for (const release of releases.splice(0)) release();
    expect(sketchyOwner()).toBeNull();
  });
});
