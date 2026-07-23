import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { hasSeenOnboarding, markOnboardingSeen, resetOnboarding } from './onboardingStorage';

describe('onboarding completion storage', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('reports a tool as unseen by default', () => {
    expect(hasSeenOnboarding('value')).toBe(false);
  });

  it('persists and reads back completion per tool', () => {
    markOnboardingSeen('value');
    expect(hasSeenOnboarding('value')).toBe(true);
    // Independent tools do not leak into each other.
    expect(hasSeenOnboarding('grid')).toBe(false);
  });

  it('resets a single tool without touching others', () => {
    markOnboardingSeen('value');
    markOnboardingSeen('grid');
    resetOnboarding('value');
    expect(hasSeenOnboarding('value')).toBe(false);
    expect(hasSeenOnboarding('grid')).toBe(true);
  });

  it('uses a namespaced key so completion survives alongside other app storage', () => {
    markOnboardingSeen('color');
    expect(localStorage.getItem('studio-onboarding-color')).toBe('done');
  });

  describe('when localStorage throws', () => {
    afterEach(() => vi.restoreAllMocks());

    it('treats read failures as "not seen" instead of crashing', () => {
      vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
        throw new Error('quota');
      });
      expect(hasSeenOnboarding('value')).toBe(false);
    });

    it('swallows write failures', () => {
      vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
        throw new Error('quota');
      });
      expect(() => markOnboardingSeen('value')).not.toThrow();
    });
  });
});
