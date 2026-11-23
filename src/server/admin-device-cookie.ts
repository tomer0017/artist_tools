import 'server-only';
import { cookies } from 'next/headers';
import { TRUST_MAX_DAYS } from '@/server/admin-mfa';
import { authConfig } from '@/server/env';

// The trusted-device cookie (src/server/admin-mfa.ts): a random token that
// page scripts cannot read (HttpOnly), sent only to this site (SameSite=Lax)
// and, over HTTPS, bound to this exact host (`__Host-`: Secure, path /, no
// domain). It lives as long as trust can (90 days); the server's record
// decides whether it still counts, so forgetting a device there is enough.

const secure = () => authConfig().baseURL.startsWith('https://');

export const deviceCookieName = () => (secure() ? '__Host-sc.admin_device' : 'sc.admin_device');

/** 32 random bytes in base64url. */
const TOKEN = /^[A-Za-z0-9_-]{43}$/;

/** This device's trust token, if it holds one. */
export async function readDeviceToken(): Promise<string | null> {
  const value = (await cookies()).get(deviceCookieName())?.value;
  return value && TOKEN.test(value) ? value : null;
}

const attributes = () => ({ httpOnly: true, secure: secure(), sameSite: 'lax' as const, path: '/' });

/** Server actions only: a page cannot write cookies. */
export async function writeDeviceToken(token: string): Promise<void> {
  (await cookies()).set(deviceCookieName(), token, { ...attributes(), maxAge: TRUST_MAX_DAYS * 24 * 60 * 60 });
}

export async function clearDeviceToken(): Promise<void> {
  (await cookies()).set(deviceCookieName(), '', { ...attributes(), maxAge: 0 });
}
