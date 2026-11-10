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
