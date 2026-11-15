import { describe, expect, it } from 'vitest';
import { en } from '@/i18n/messages/en';
import { he } from '@/i18n/messages/he';
import { authErrorKey, signInErrorKey } from './ui';

describe('sign-in error messages', () => {
  it('explains each known code, and anything else generically', () => {
    for (const code of ['access_denied', 'account_not_linked', 'email_not_verified', 'signups_paused', 'unable_to_create_session'])
      expect(signInErrorKey(code, 'open')).toBe(code);
    expect(signInErrorKey('not_invited', 'invite')).toBe('not_invited');
    expect(signInErrorKey('something_else', 'invite')).toBe('generic');
    expect(signInErrorKey(undefined, 'open')).toBeNull();
  });

  it('never mentions invitations once registration is open', () => {
    expect(signInErrorKey('not_invited', 'open')).toBe('generic');
    expect(signInErrorKey('unable_to_create_user', 'open')).toBe('unable_to_create_user_open');
    expect(signInErrorKey('unable_to_create_user', 'invite')).toBe('unable_to_create_user');
    const shownWhenOpen = ['access_denied', 'account_not_linked', 'not_invited', 'email_not_verified', 'signups_paused', 'unable_to_create_user', 'unable_to_create_session', 'other']
      .map((code) => signInErrorKey(code, 'open')!);
    for (const messages of [en, he]) {
      for (const key of shownWhenOpen) {
        expect(messages.auth.errors[key]).toBeTruthy();
        expect(messages.auth.errors[key]).not.toMatch(/invite|הזמנה/i);
      }
    }
  });

  it('shows the paused message for a paused password sign-up', () => {
    expect(authErrorKey({ status: 429, code: 'SIGNUPS_PAUSED' })).toBe('SIGNUPS_PAUSED');
    expect(authErrorKey({ status: 429 })).toBe('RATE_LIMITED');
    expect(en.auth.errors.SIGNUPS_PAUSED).toContain('paused');
  });
});
