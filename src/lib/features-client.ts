import type { FeatureId } from './plans';
import { signInPath } from './redirects';

export type FeatureAccess = 'ok' | 'locked' | 'limit' | 'signed_out' | 'unavailable';

/**
 * Ask the server, right before using them, whether this account may use
 * `features` now (it also counts the use). 'unavailable' means the server
 * could not be asked (offline, restarting): callers then go by the copy of
 * the account they already have, since the work itself happens on this device.
 */
export async function authorizeFeatures(features: FeatureId[]): Promise<FeatureAccess> {
  try {
    const response = await fetch('/api/usage', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ features }),
      credentials: 'same-origin',
      cache: 'no-store',
    });
    if (response.ok) return 'ok';
    if (response.status === 401) {
      window.location.assign(signInPath(window.location.pathname));
      return 'signed_out';
    }
    if (response.status === 403) return 'locked';
    // The plan includes it, but its daily or monthly quota is used up.
    if (response.status === 429) return 'limit';
    return 'unavailable';
  } catch {
    return 'unavailable';
  }
}
