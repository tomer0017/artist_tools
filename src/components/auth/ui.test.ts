import { describe, expect, it } from 'vitest';
import { en } from '@/i18n/messages/en';
import { he } from '@/i18n/messages/he';
import { authErrorKey, signInErrorKey, usernameErrorKey } from './ui';

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

  it('words username refusals without hinting at accounts or at a reset by email', () => {
    expect(usernameErrorKey({ status: 401, code: 'INVALID_USERNAME_OR_PASSWORD' })).toBe('INVALID_USERNAME_OR_PASSWORD');
    // A malformed username: the same words as a wrong password.
    for (const code of ['USERNAME_TOO_SHORT', 'USERNAME_TOO_LONG', 'INVALID_USERNAME']) expect(usernameErrorKey({ status: 422, code })).toBe('INVALID_USERNAME_OR_PASSWORD');
    expect(usernameErrorKey({ status: 429, code: 'TOO_MANY_ATTEMPTS' })).toBe('TOO_MANY_ATTEMPTS_USERNAME');
    expect(usernameErrorKey({ status: 403, code: 'ACCOUNT_SUSPENDED' })).toBe('ACCOUNT_SUSPENDED');
    expect(usernameErrorKey({ status: 429 })).toBe('RATE_LIMITED');
    for (const messages of [en, he]) {
      expect(messages.auth.errors.TOO_MANY_ATTEMPTS_USERNAME).not.toMatch(/reset|לאפס/i);
      expect(messages.auth.errors.INVALID_USERNAME_OR_PASSWORD).not.toMatch(/reset|לאפס/i);
    }
  });
});
