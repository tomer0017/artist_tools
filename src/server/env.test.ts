// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest';
import { authConfig } from './env';

const BASE = { BETTER_AUTH_URL: 'https://staging.example.com', BETTER_AUTH_SECRET: 's'.repeat(40) };
const saved = { ...process.env };

function withEnv(env: Record<string, string | undefined>) {
  for (const key of ['BETTER_AUTH_URL', 'BETTER_AUTH_SECRET', 'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'AUTH_SIGNUP_MODE', 'AUTH_SIGNUP_ALLOWLIST', 'APP_ENV', 'AUTH_EMAIL_PASSWORD', 'MAIL_TRANSPORT', 'MAIL_FROM']) {
    delete process.env[key];
  }
  Object.assign(process.env, env);
}

afterEach(() => {
  process.env = { ...saved };
});

describe('authConfig', () => {
  it('runs without Google until its OAuth client exists', () => {
    withEnv({ ...BASE });
    expect(authConfig()).toEqual({
      baseURL: BASE.BETTER_AUTH_URL,
      secret: BASE.BETTER_AUTH_SECRET,
      google: null,
      signups: { mode: 'invite', invited: [] },
      appEnv: null,
      emailPassword: false,
      adminMfaRequired: false,
      mail: { transport: 'disabled', from: 'Studio Companion <no-reply@studio-companion.invalid>' },
    });
    withEnv({ ...BASE, GOOGLE_CLIENT_ID: '', GOOGLE_CLIENT_SECRET: '' });
    expect(authConfig().google).toBeNull();
  });

  it('requires two-factor verification for admins only when ADMIN_MFA_REQUIRED=on', () => {
    withEnv({ ...BASE, ADMIN_MFA_REQUIRED: 'on' });
    expect(authConfig().adminMfaRequired).toBe(true);
    withEnv({ ...BASE, ADMIN_MFA_REQUIRED: 'off' });
    expect(authConfig().adminMfaRequired).toBe(false);
    withEnv({ ...BASE, ADMIN_MFA_REQUIRED: 'yes' });
    expect(() => authConfig()).toThrow('ADMIN_MFA_REQUIRED must be "on" or "off"');
  });

  it('uses Google once both values are set', () => {
    withEnv({ ...BASE, GOOGLE_CLIENT_ID: 'id.apps.googleusercontent.com', GOOGLE_CLIENT_SECRET: 'shh' });
    expect(authConfig().google).toEqual({ clientId: 'id.apps.googleusercontent.com', clientSecret: 'shh' });
  });

  it('refuses a half-configured Google client', () => {
    withEnv({ ...BASE, GOOGLE_CLIENT_ID: 'id.apps.googleusercontent.com' });
    expect(() => authConfig()).toThrow('GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET must be set together');
  });

  it('keeps registration invite-only unless it is opened on purpose', () => {
    withEnv({ ...BASE });
    expect(authConfig().signups).toEqual({ mode: 'invite', invited: [] });
    withEnv({ ...BASE, AUTH_SIGNUP_ALLOWLIST: ' Ada@Example.com , ,grace@example.com ' });
    expect(authConfig().signups).toEqual({ mode: 'invite', invited: ['ada@example.com', 'grace@example.com'] });
    withEnv({ ...BASE, AUTH_SIGNUP_MODE: 'invite', AUTH_SIGNUP_ALLOWLIST: 'ada@example.com' });
    expect(authConfig().signups).toEqual({ mode: 'invite', invited: ['ada@example.com'] });
    // Public registration is one explicit setting…
    withEnv({ ...BASE, AUTH_SIGNUP_MODE: 'open', AUTH_SIGNUP_ALLOWLIST: 'ada@example.com' });
    expect(authConfig().signups).toEqual({ mode: 'open' });
    // …and older env files that used "*" still mean open, unless the mode says otherwise.
    withEnv({ ...BASE, AUTH_SIGNUP_ALLOWLIST: '*' });
    expect(authConfig().signups).toEqual({ mode: 'open' });
    withEnv({ ...BASE, AUTH_SIGNUP_MODE: 'invite', AUTH_SIGNUP_ALLOWLIST: '*' });
    expect(authConfig().signups).toEqual({ mode: 'invite', invited: [] });
    withEnv({ ...BASE, AUTH_SIGNUP_MODE: 'everyone' });
    expect(() => authConfig()).toThrow('AUTH_SIGNUP_MODE must be "invite" or "open"');
  });

  it('keeps email + password off unless enabled, and never without a way to send email', () => {
    withEnv({ ...BASE });
    expect(authConfig().emailPassword).toBe(false);
    withEnv({ ...BASE, AUTH_EMAIL_PASSWORD: 'on' });
    expect(() => authConfig()).toThrow('AUTH_EMAIL_PASSWORD=on needs a mail transport (MAIL_TRANSPORT)');
    withEnv({ ...BASE, AUTH_EMAIL_PASSWORD: 'on', MAIL_TRANSPORT: 'outbox', APP_ENV: 'staging' });
    expect(authConfig()).toMatchObject({ emailPassword: true, appEnv: 'staging', mail: { transport: 'outbox' } });
    withEnv({ ...BASE, AUTH_EMAIL_PASSWORD: 'yes' });
    expect(() => authConfig()).toThrow('AUTH_EMAIL_PASSWORD must be "on" or "off"');
  });

  it('never allows the mail outbox in production, or where the environment is not named', () => {
    for (const appEnv of ['development', 'test', 'staging']) {
      withEnv({ ...BASE, MAIL_TRANSPORT: 'outbox', APP_ENV: appEnv });
      expect(authConfig().mail.transport).toBe('outbox');
    }
    for (const appEnv of ['production', undefined]) {
      withEnv({ ...BASE, MAIL_TRANSPORT: 'outbox', APP_ENV: appEnv });
      expect(() => authConfig()).toThrow('MAIL_TRANSPORT=outbox needs APP_ENV=development, test or staging');
    }
    withEnv({ ...BASE, MAIL_TRANSPORT: 'outbox', APP_ENV: 'staging', MAIL_FROM: ' Studio <hello@example.com> ' });
    expect(authConfig().mail.from).toBe('Studio <hello@example.com>');
  });

  it('names what is wrong without echoing secret values', () => {
    withEnv({ BETTER_AUTH_URL: BASE.BETTER_AUTH_URL, BETTER_AUTH_SECRET: 'too-short-secret' });
    let message = '';
    try {
      authConfig();
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain('BETTER_AUTH_SECRET must be at least 32 characters');
    expect(message).not.toContain('too-short-secret');
  });
});
