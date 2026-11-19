import { describe, expect, it } from 'vitest';
import { viewFromPathname } from '@/components/shell/tools';
import { LEARN_ROOT, isLearnPath, itemPath, learnPath, learnRouteOf } from './routes';

// Learn's addresses (ADR-0018): each screen has its own, and the studio maps
// every one of them to the Learn view; anything else in Learn has no screen.

describe('Learn addresses', () => {
  it('each screen has its own address, and the address says the screen', () => {
    const routes = [
      { screen: 'home' },
      { screen: 'curriculum' },
      { screen: 'challenges' },
      { screen: 'history' },
      { screen: 'exercise', id: 'D-START-01' },
      { screen: 'exercise', id: 'C-COL-01' },
      { screen: 'challenge', id: 'CH-017' },
    ] as const;
    for (const route of routes) expect(learnRouteOf(learnPath(route))).toEqual(route);
    expect(learnPath({ screen: 'exercise', id: 'D-START-01' })).toBe('/app/learn/exercises/D-START-01');
    expect(itemPath('CH-017')).toBe('/app/learn/challenges/CH-017');
    expect(itemPath('D-LINE-04')).toBe('/app/learn/exercises/D-LINE-04');
  });

  it('nothing else in Learn is a screen; outside Learn is not Learn', () => {
    for (const path of ['/app/learn/exercises', '/app/learn/exercises/CH-017', '/app/learn/challenges/D-START-01', '/app/learn/challenges/CH-017/x', '/app/learn/settings', '/app/learn/exercises/d-start-01'])
      expect(learnRouteOf(path), path).toBeNull();
    expect(learnRouteOf('/app/learning')).toBeNull();
    expect(isLearnPath('/app/learning')).toBe(false);
    expect(isLearnPath(LEARN_ROOT)).toBe(true);
  });

  it('the studio shows the Learn view for every Learn address, and its other views as before', () => {
    expect(viewFromPathname('/app/learn')).toBe('learn');
    expect(viewFromPathname('/app/learn/challenges/CH-017')).toBe('learn');
    expect(viewFromPathname('/app/learn/anything/else')).toBe('learn');
    expect(viewFromPathname('/app')).toBe('home');
    expect(viewFromPathname('/app/study')).toBe('value');
    expect(viewFromPathname('/app/grid/extra')).toBeNull();
    expect(viewFromPathname('/app/learning')).toBeNull();
  });
});
