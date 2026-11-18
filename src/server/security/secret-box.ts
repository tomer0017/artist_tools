import 'server-only';
import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto';
import { authConfig } from '@/server/env';

// ─── Encryption at rest for small secrets ─────────────────────────────────────
// AES-256-GCM with a key derived (HKDF-SHA256) from BETTER_AUTH_SECRET for one
// purpose each, so a copy of the database alone does not reveal the secrets,
// and a value sealed for one purpose cannot be opened as another. Used for
// admin TOTP secrets and for initial passwords waiting to be revealed once
// (src/server/password-accounts.ts). Rotating BETTER_AUTH_SECRET makes stored
// secrets unreadable: admins then enrol again (docs/security/admin-2fa.md),
// and an unrevealed initial password is replaced by resetting it.

export type SecretPurpose = 'admin-mfa' | 'initial-password';

const PURPOSES: Record<SecretPurpose, string> = {
  'admin-mfa': 'studio-companion admin-mfa totp-secret v1',
  'initial-password': 'studio-companion initial-password handoff v1',
};

function key(purpose: SecretPurpose, secret = authConfig().secret): Buffer {
  return Buffer.from(hkdfSync('sha256', secret, 'studio-companion', PURPOSES[purpose], 32));
}

/** `v1.<iv>.<tag>.<ciphertext>`, base64url. */
export function seal(plaintext: string, secret?: string, purpose: SecretPurpose = 'admin-mfa'): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(purpose, secret), iv);
  const data = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return ['v1', iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), data.toString('base64url')].join('.');
}

/** The plaintext, or null if the value was tampered with, sealed under another key or for another purpose. */
export function open(sealed: string, secret?: string, purpose: SecretPurpose = 'admin-mfa'): string | null {
  const [version, iv, tag, data] = sealed.split('.');
  if (version !== 'v1' || !iv || !tag || !data) return null;
  try {
    const decipher = createDecipheriv('aes-256-gcm', key(purpose, secret), Buffer.from(iv, 'base64url'));
    decipher.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([decipher.update(Buffer.from(data, 'base64url')), decipher.final()]).toString('utf8');
  } catch {
    return null;
  }
}
