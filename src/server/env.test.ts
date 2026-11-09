// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest';
import { authConfig } from './env';

const BASE = { BETTER_AUTH_URL: 'https://staging.example.com', BETTER_AUTH_SECRET: 's'.repeat(40) };
const saved = { ...process.env };

function withEnv(env: Record<string, string | undefined>) {
  for (const key of ['BETTER_AUTH_URL', 'BETTER_AUTH_SECRET', 'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET']) delete process.env[key];
  Object.assign(process.env, env);
}

afterEach(() => {
  process.env = { ...saved };
});

describe('authConfig', () => {
  it('runs without Google until its OAuth client exists', () => {
    withEnv({ ...BASE });
    expect(authConfig()).toEqual({ baseURL: BASE.BETTER_AUTH_URL, secret: BASE.BETTER_AUTH_SECRET, google: null });
    withEnv({ ...BASE, GOOGLE_CLIENT_ID: '', GOOGLE_CLIENT_SECRET: '' });
    expect(authConfig().google).toBeNull();
  });

  it('uses Google once both values are set', () => {
    withEnv({ ...BASE, GOOGLE_CLIENT_ID: 'id.apps.googleusercontent.com', GOOGLE_CLIENT_SECRET: 'shh' });
    expect(authConfig().google).toEqual({ clientId: 'id.apps.googleusercontent.com', clientSecret: 'shh' });
  });

  it('refuses a half-configured Google client', () => {
    withEnv({ ...BASE, GOOGLE_CLIENT_ID: 'id.apps.googleusercontent.com' });
    expect(() => authConfig()).toThrow('GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET must be set together');
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
