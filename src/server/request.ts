import 'server-only';
import { authConfig } from '@/server/env';

/**
 * Whether a state-changing request comes from this site's own pages. Defence
 * in depth against cross-site requests (the session cookie is SameSite=Lax as
 * well): browsers always send Origin with a POST, and a request without one
 * is not a browser being tricked into sending it.
 */
export function fromOwnOrigin(request: Request): boolean {
  const origin = request.headers.get('origin');
  if (origin === null) return request.headers.get('sec-fetch-site') !== 'cross-site';
  return origin === new URL(authConfig().baseURL).origin;
}

/** A request body that is larger than its route accepts. */
export class BodyTooLarge extends Error {}

/**
 * The request body as text, refusing more than `maxBytes` — counted as it
 * streams in, so a body without (or lying about) its Content-Length cannot
 * make the server buffer more than the limit.
 */
export async function readBodyText(request: Request, maxBytes: number): Promise<string> {
  const declared = Number(request.headers.get('content-length') ?? '');
  if (Number.isFinite(declared) && declared > maxBytes) throw new BodyTooLarge();
  if (!request.body) return '';
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw new BodyTooLarge();
    }
    chunks.push(value);
  }
  const all = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    all.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(all);
}

/** JSON from a small request body: null when it is not JSON; BodyTooLarge when over `maxBytes` (default 16 KB). */
export async function readJsonBody(request: Request, maxBytes = 16 * 1024): Promise<unknown> {
  const text = await readBodyText(request, maxBytes);
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
