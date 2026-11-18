import type { ExportFeatureId, FeatureId, ToolFeatureId } from './plans';
import { signInPath } from './redirects';

export type FeatureAccess = 'ok' | 'locked' | 'limit' | 'signed_out' | 'unavailable';

export interface FeatureDecision {
  access: FeatureAccess;
  /** What the server refused (the tool, or an export feature), when it said why. */
  missing: FeatureId[];
}

/**
 * Ask the server, right before a save, an export or another protected
 * operation, whether this account may do it now (it also counts the use).
 * `tool` is the tool it comes from (checked, not counted); `features` are what
 * is exported. Only 'ok' allows it: 'unavailable' (offline, the server
 * restarting, any unexpected answer) is a refusal too, since nothing can be
 * verified then.
 */
export async function authorizeUse(use: { tool: ToolFeatureId | null; features: ExportFeatureId[] }): Promise<FeatureDecision> {
  try {
    const response = await fetch('/api/usage', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(use.tool ? { tool: use.tool, features: use.features } : { features: use.features }),
      credentials: 'same-origin',
      cache: 'no-store',
    });
    if (response.ok) return { access: 'ok', missing: [] };
    if (response.status === 401) {
      window.location.assign(signInPath(window.location.pathname));
      return { access: 'signed_out', missing: [] };
    }
    const missing = await response
      .json()
      .then((body: { features?: unknown }) => (Array.isArray(body.features) ? (body.features as FeatureId[]) : []))
      .catch(() => [] as FeatureId[]);
    if (response.status === 403) return { access: 'locked', missing };
    // The plan includes it, but its daily or monthly quota is used up.
    if (response.status === 429) return { access: 'limit', missing };
    return { access: 'unavailable', missing: [] };
  } catch {
    return { access: 'unavailable', missing: [] };
  }
}
