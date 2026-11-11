import 'server-only';
import { createHmac, timingSafeEqual } from 'node:crypto';

// Webhook signatures in the common "timestamp + HMAC" form:
//   header: t=<unix seconds>,v1=<hex HMAC-SHA256(secret, `${t}.${rawBody}`)>
// A signature is accepted only for the exact raw body, within five minutes of
// its timestamp (replayed deliveries are refused later anyway by the
// idempotency record), and compared in constant time.

export const SIGNATURE_TOLERANCE_SECONDS = 5 * 60;

export function signPayload(secret: string, rawBody: string, now = Date.now()): string {
  const t = Math.floor(now / 1000);
  const v1 = createHmac('sha256', secret).update(`${t}.${rawBody}`).digest('hex');
  return `t=${t},v1=${v1}`;
}

export class InvalidSignature extends Error {}

export function verifySignature(secret: string, rawBody: string, header: string | null, now = Date.now()): void {
  if (!header) throw new InvalidSignature('missing signature');
  const parts = Object.fromEntries(header.split(',').map((part) => part.trim().split('=') as [string, string]));
  const t = Number(parts.t);
  if (!Number.isInteger(t) || !/^[0-9a-f]{64}$/.test(parts.v1 ?? '')) throw new InvalidSignature('malformed signature');
  if (Math.abs(now / 1000 - t) > SIGNATURE_TOLERANCE_SECONDS) throw new InvalidSignature('signature too old');
  const expected = Buffer.from(createHmac('sha256', secret).update(`${t}.${rawBody}`).digest('hex'), 'hex');
  const given = Buffer.from(parts.v1, 'hex');
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) throw new InvalidSignature('signature mismatch');
}
