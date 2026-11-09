import { describe, expect, it } from 'vitest';
import { DEFAULT_AFTER_SIGN_IN, safeCallbackPath, signInPath } from './redirects';

describe('safeCallbackPath', () => {
  it('keeps internal studio and admin destinations', () => {
    for (const ok of ['/app', '/app/compare', '/app/study?x=1', '/admin', '/admin?page=2']) {
      expect(safeCallbackPath(ok)).toBe(ok);
    }
  });

  it('replaces anything that could leave the site with the studio home', () => {
    const attacks = [
      'https://evil.example',
      '//evil.example',
      '/\\evil.example',
      '\\\\evil.example',
      'javascript:alert(1)',
      ' /app',
      '/app\n',
      '/%2F%2Fevil.example',
      'app',
      '',
      '/',
      '/sign-in',
      '/api/auth/sign-out',
      'x'.repeat(600),
      null,
      undefined,
      42,
    ];
    for (const bad of attacks) expect(safeCallbackPath(bad)).toBe(DEFAULT_AFTER_SIGN_IN);
  });

  it('builds sign-in links that come back to a safe place', () => {
    expect(signInPath('/app/grid')).toBe('/sign-in?callbackURL=%2Fapp%2Fgrid');
    expect(signInPath('https://evil.example')).toBe('/sign-in?callbackURL=%2Fapp');
  });
});
