import 'server-only';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

// ─── Time-based one-time passwords (RFC 6238) ─────────────────────────────────
// What authenticator apps (Apple Passwords, Google Authenticator, 1Password…)
// compute: HMAC-SHA1 over the 30-second time step, 6 digits. Verification
// accepts the previous, current and next step (clock drift) and reports which
// step matched, so a code can be refused once it has been used.

export const TOTP_PERIOD_SECONDS = 30;
export const TOTP_DIGITS = 6;
const WINDOW = 1;

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(text: string): Buffer {
  const clean = text.toUpperCase().replace(/[\s=-]/g, '');
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const char of clean) {
    const index = ALPHABET.indexOf(char);
    if (index < 0) throw new Error('invalid base32');
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** A new secret: 20 random bytes (160 bits, as RFC 4226 recommends), in base32. */
export const generateTotpSecret = () => base32Encode(randomBytes(20));

export const timeStep = (now: number) => Math.floor(now / 1000 / TOTP_PERIOD_SECONDS);

/** The code for one time step (HOTP with the step as counter). */
export function totpAt(secretBase32: string, step: number, digits = TOTP_DIGITS): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const hmac = createHmac('sha1', base32Decode(secretBase32)).update(counter).digest();
  const offset = hmac[hmac.length - 1] & 15;
  const binary = ((hmac[offset] & 127) << 24) | (hmac[offset + 1] << 16) | (hmac[offset + 2] << 8) | hmac[offset + 3];
  return String(binary % 10 ** digits).padStart(digits, '0');
}

const sameCode = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

/**
 * The time step a code belongs to (within one step of now), or null. A step
 * at or before `notAfterStep` (the last one used) never matches, so the same
 * code cannot be used twice.
 */
export function verifyTotp(secretBase32: string, code: string, now: number, notAfterStep: number | null = null): number | null {
  const digits = code.replace(/\s/g, '');
  if (!/^\d{6}$/.test(digits)) return null;
  const current = timeStep(now);
  let matched: number | null = null;
  // Every candidate is computed and compared, so timing does not reveal which one matched.
  for (let step = current - WINDOW; step <= current + WINDOW; step++) {
    if (sameCode(totpAt(secretBase32, step), digits) && (notAfterStep === null || step > notAfterStep) && matched === null) matched = step;
  }
  return matched;
}

/** The link authenticator apps understand (also encoded in the QR code). */
export function otpauthUri(secretBase32: string, account: string, issuer = 'Studio Companion'): string {
  const label = `${encodeURIComponent(issuer)}:${encodeURIComponent(account)}`;
  const params = new URLSearchParams({ secret: secretBase32, issuer, algorithm: 'SHA1', digits: String(TOTP_DIGITS), period: String(TOTP_PERIOD_SECONDS) });
  return `otpauth://totp/${label}?${params.toString()}`;
}
