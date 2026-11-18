// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest';
import { authConfig } from './env';

const BASE = { BETTER_AUTH_URL: 'https://staging.example.com', BETTER_AUTH_SECRET: 's'.repeat(40) };
const saved = { ...process.env };

function withEnv(env: Record<string, string | undefined>) {
  for (const key of ['BETTER_AUTH_URL', 'BETTER_AUTH_SECRET', 'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'AUTH_SIGNUP_MODE', 'AUTH_SIGNUP_ALLOWLIST', 'APP_ENV', 'AUTH_EMAIL_PASSWORD', 'MAIL_TRANSPORT', 'MAIL_FROM', 'SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASSWORD']) {
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
      usernamePassword: false,
      adminMfaRequired: false,
      mail: { transport: 'disabled', from: 'Studio Companion <no-reply@studio-companion.invalid>', smtp: null },
    });
    withEnv({ ...BASE, GOOGLE_CLIENT_ID: '', GOOGLE_CLIENT_SECRET: '' });
    expect(authConfig().google).toBeNull();
  });

  it('offers username sign-in only when AUTH_USERNAME_PASSWORD=on, and needs no mail for it', () => {
    withEnv({ ...BASE, AUTH_USERNAME_PASSWORD: 'on' });
    expect(authConfig()).toMatchObject({ usernamePassword: true, emailPassword: false, mail: { transport: 'disabled' } });
    withEnv({ ...BASE, AUTH_USERNAME_PASSWORD: 'off' });
    expect(authConfig().usernamePassword).toBe(false);
    withEnv({ ...BASE, AUTH_USERNAME_PASSWORD: 'yes' });
    expect(() => authConfig()).toThrow('AUTH_USERNAME_PASSWORD must be "on" or "off"');
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

  it('sends real email through the provider only when every SMTP detail and a real sender are set', () => {
    const SMTP = { MAIL_TRANSPORT: 'smtp', SMTP_HOST: ' smtp.example.com ', SMTP_PORT: '587', SMTP_USER: 'apikey', SMTP_PASSWORD: 'provider-secret', MAIL_FROM: 'Studio Companion <hello@example.com>' };
    withEnv({ ...BASE, ...SMTP, APP_ENV: 'production', AUTH_EMAIL_PASSWORD: 'on' });
    expect(authConfig()).toMatchObject({
      emailPassword: true,
      mail: { transport: 'smtp', from: 'Studio Companion <hello@example.com>', smtp: { host: 'smtp.example.com', port: 587, user: 'apikey', password: 'provider-secret' } },
    });
    for (const missing of ['SMTP_HOST', 'SMTP_USER', 'SMTP_PASSWORD'] as const) {
      withEnv({ ...BASE, ...SMTP, [missing]: '' });
      expect(() => authConfig()).toThrow('MAIL_TRANSPORT=smtp needs SMTP_HOST, SMTP_PORT, SMTP_USER and SMTP_PASSWORD');
    }
    for (const port of [undefined, '', 'smtp', '0', '70000']) {
      withEnv({ ...BASE, ...SMTP, SMTP_PORT: port });
      expect(() => authConfig()).toThrow("SMTP_PORT must be the provider's submission port");
    }
    // The placeholder sender, or none, would be refused by any provider.
    for (const from of [undefined, 'Studio Companion <no-reply@studio-companion.invalid>', 'not an address', 'Studio <hello@localhost>']) {
      withEnv({ ...BASE, ...SMTP, MAIL_FROM: from });
      expect(() => authConfig()).toThrow('MAIL_TRANSPORT=smtp needs MAIL_FROM');
    }
    withEnv({ ...BASE, ...SMTP, MAIL_FROM: 'hello@example.com' });
    expect(authConfig().mail.from).toBe('hello@example.com');
    withEnv({ ...BASE, MAIL_TRANSPORT: 'sendmail' });
    expect(() => authConfig()).toThrow('MAIL_TRANSPORT must be "disabled", "outbox" or "smtp"');
  });

  it('opens registration only with real email outside development and tests', () => {
    // Real people's verification and reset links never sit in the outbox, where admins can read them.
    for (const open of [{ AUTH_SIGNUP_MODE: 'open' }, { AUTH_SIGNUP_ALLOWLIST: '*' }]) {
      withEnv({ ...BASE, ...open, MAIL_TRANSPORT: 'outbox', APP_ENV: 'staging', AUTH_EMAIL_PASSWORD: 'on' });
      expect(() => authConfig()).toThrow('Open registration needs real email (MAIL_TRANSPORT=smtp)');
    }
    for (const appEnv of ['development', 'test']) {
      withEnv({ ...BASE, AUTH_SIGNUP_MODE: 'open', MAIL_TRANSPORT: 'outbox', APP_ENV: appEnv, AUTH_EMAIL_PASSWORD: 'on' });
      expect(authConfig().signups).toEqual({ mode: 'open' });
    }
    // Invite-only staging keeps its outbox; open staging works with a provider.
    withEnv({ ...BASE, AUTH_SIGNUP_ALLOWLIST: 'ada@example.com', MAIL_TRANSPORT: 'outbox', APP_ENV: 'staging', AUTH_EMAIL_PASSWORD: 'on' });
    expect(authConfig().mail.transport).toBe('outbox');
    withEnv({
      ...BASE,
      AUTH_SIGNUP_MODE: 'open',
      APP_ENV: 'staging',
      AUTH_EMAIL_PASSWORD: 'on',
      MAIL_TRANSPORT: 'smtp',
      SMTP_HOST: 'smtp.example.com',
      SMTP_PORT: '465',
      SMTP_USER: 'apikey',
      SMTP_PASSWORD: 'provider-secret',
      MAIL_FROM: 'Studio Companion <hello@example.com>',
    });
    expect(authConfig()).toMatchObject({ signups: { mode: 'open' }, mail: { transport: 'smtp', smtp: { port: 465 } } });
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
    withEnv({ ...BASE, MAIL_TRANSPORT: 'smtp', SMTP_HOST: 'smtp.example.com', SMTP_PORT: 'x', SMTP_USER: 'apikey', SMTP_PASSWORD: 'provider-secret' });
    try {
      authConfig();
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain('SMTP_PORT');
    expect(message).not.toContain('provider-secret');
  });
});
