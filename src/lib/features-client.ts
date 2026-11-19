import type { ExportFeatureId, FeatureId, ToolFeatureId } from './plans';
import { signInPath } from './redirects';

export type FeatureAccess = 'ok' | 'locked' | 'limit' | 'signed_out' | 'unavailable';

export interface FeatureDecision {
  access: FeatureAccess;
  /** What the server refused (the tool, or an export feature), when it said why. */
  missing: FeatureId[];
  /** The Learn item the export comes from, when that item is what is no longer open (ADR-0018). */
  learnItem?: { id: string; reason: string };
}

/**
 * Ask the server, right before a save, an export or another protected
 * operation, whether this account may do it now (it also counts the use).
 * `tool` is the tool it comes from (checked, not counted); `features` are what
 * is exported. Only 'ok' allows it: 'unavailable' (offline, the server
 * restarting, any unexpected answer) is a refusal too, since nothing can be
 * verified then.
 */
export async function authorizeUse(use: { tool: ToolFeatureId | null; features: ExportFeatureId[]; learnItem?: string | null }): Promise<FeatureDecision> {
  try {
    const response = await fetch('/api/usage', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        ...(use.tool ? { tool: use.tool } : {}),
        features: use.features,
        // An export from a Learn reference: that item must still be open to the account.
        ...(use.learnItem ? { learnItem: use.learnItem } : {}),
      }),
      credentials: 'same-origin',
      cache: 'no-store',
    });
    if (response.ok) return { access: 'ok', missing: [] };
    if (response.status === 401) {
      window.location.assign(signInPath(window.location.pathname));
      return { access: 'signed_out', missing: [] };
    }
    const body = await response.json().catch(() => ({}) as { features?: unknown; learnItem?: unknown });
    const missing = Array.isArray(body.features) ? (body.features as FeatureId[]) : [];
    const learnItem = isLearnRefusal(body.learnItem) ? body.learnItem : undefined;
    if (response.status === 403) return { access: 'locked', missing, ...(learnItem ? { learnItem } : {}) };
    // The plan includes it, but its daily or monthly quota is used up.
    if (response.status === 429) return { access: 'limit', missing };
    return { access: 'unavailable', missing: [] };
  } catch {
    return { access: 'unavailable', missing: [] };
  }
}

const isLearnRefusal = (value: unknown): value is { id: string; reason: string } =>
  typeof value === 'object' && value !== null && typeof (value as { id?: unknown }).id === 'string' && typeof (value as { reason?: unknown }).reason === 'string';
