import 'server-only';
import { createHash } from 'node:crypto';
import type { Db } from 'mongodb';
import type { CompanionSummary } from '@/lib/account';
import { DEFAULT_ACCESS, DEFAULT_SETTINGS } from '@/lib/companion/defaults';
import { AUDIENCES, COMPANION_FEATURES, isAnimation, type AccessMode, type Audience, type CompanionFeature, type CompanionSettings, type CompanionTip } from '@/lib/companion/model';
import { isAccessMode } from '@/lib/learn/model';
import { collections } from '@/server/db/collections';
import type { Entitlements } from '@/server/entitlements';
import { tipIssues, tipTextIssues, type StoredCompanionConfig } from './config';

// ─── Sketchy for one account (ADR-0024) ───────────────────────────────────────
// Who gets what of the companion is decided here, on the server, from the
// account's fresh entitlements (the only reader of plans) and the published
// configuration. Each capability has an access mode, exactly like a Learn
// item (ADR-0023): Free (every signed-in account), Pro (Pro and admins;
// locked for others), Admin only (for checking first), Blocked (nobody,
// admins included). The studio receives only what it may show: settings,
// the capabilities' states, and the tips this account may see.

export type FeatureState = 'open' | 'locked' | 'hidden';

export interface CompanionViewer {
  active: boolean;
  admin: boolean;
  pro: boolean;
}

export const companionViewerOf = (e: Entitlements): CompanionViewer => ({ active: e.accountActive, admin: e.access === 'admin', pro: e.access === 'pro' });

/** One access mode for one viewer. An unknown mode (a newer release's) counts as Blocked. */
export function stateOf(mode: unknown, viewer: CompanionViewer): FeatureState {
  if (!viewer.active || !isAccessMode(mode) || mode === 'blocked') return 'hidden';
  if (viewer.admin) return 'open';
  if (mode === 'admin') return 'hidden';
  if (mode === 'pro') return viewer.pro ? 'open' : 'locked';
  return 'open';
}

/** Each capability's state: Sketchy himself first (hidden or locked: everything is). */
export function featureStates(access: Partial<Record<string, unknown>>, enabled: boolean, viewer: CompanionViewer): Record<CompanionFeature, FeatureState> {
  const own = stateOf(access.companion ?? DEFAULT_ACCESS.companion, viewer);
  return Object.fromEntries(
    COMPANION_FEATURES.map((feature) => {
      if (!enabled || own !== 'open') return [feature, feature === 'companion' && enabled ? own : 'hidden'];
      return [feature, stateOf(access[feature] ?? DEFAULT_ACCESS[feature], viewer)];
    }),
  ) as Record<CompanionFeature, FeatureState>;
}

/** The person's own choices (their account): hidden, and who they are. */
export interface CompanionPrefs {
  hidden: boolean;
  audience: Audience | null;
}

export function prefsOf(user: { companion?: { hidden?: unknown; audience?: unknown } | null } | null): CompanionPrefs {
  const c = user?.companion;
  return { hidden: c?.hidden === true, audience: (AUDIENCES as readonly unknown[]).includes(c?.audience) ? (c!.audience as Audience) : null };
}

const short = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('base64url').slice(0, 12);

/**
 * What the account summary carries: whether he shows at all for this person
 * (so Home can make room for him before anything loads), the person's own
 * choices, and a key that changes whenever what they get may have changed
 * (a save in Admin → Companion, a plan change), so the studio asks again.
 * Read with a projection: the summary is asked for often.
 */
export async function companionSummaryOf(db: Db, entitlements: Entitlements, prefs: CompanionPrefs): Promise<CompanionSummary> {
  const doc = await collections(db).configVersions.findOne(
    { kind: 'companion', status: 'published' },
    { projection: { version: 1, 'document.settings.enabled': 1, 'document.access': 1 } },
  );
  const document = doc?.document as { settings?: { enabled?: unknown }; access?: Record<string, unknown> } | undefined;
  const enabled = doc ? document?.settings?.enabled === true : DEFAULT_SETTINGS.enabled;
  const access = doc ? (document?.access ?? {}) : DEFAULT_ACCESS;
  const states = featureStates(access, enabled, companionViewerOf(entitlements));
  return {
    show: states.companion === 'open' && !prefs.hidden,
    available: states.companion === 'open',
    hidden: prefs.hidden,
    audience: prefs.audience,
    key: short([doc?.version ?? 0, states]),
  };
}

/** What GET /api/companion sends: everything the studio needs to run him for this account, nothing more. */
export interface CompanionView {
  version: number | null;
  key: string;
  settings: CompanionSettings;
  features: Record<CompanionFeature, FeatureState>;
  tips: CompanionTip[];
}

/** A tip this account may see now: known values, complete text, its own access open, not archived. */
function visibleTip(tip: CompanionTip, viewer: CompanionViewer): boolean {
  if (tip.archived) return false;
  if (tipIssues(tip).length > 0 || tipTextIssues(tip).length > 0) return false;
  return stateOf(tip.access as AccessMode, viewer) === 'open';
}

/** Settings as the studio uses them: every animation this release knows, on unless switched off. */
function settingsFor(settings: CompanionSettings): CompanionSettings {
  const animations = { ...DEFAULT_SETTINGS.animations };
  for (const [id, on] of Object.entries(settings.animations ?? {})) if (isAnimation(id)) animations[id] = on === true;
  const { enabled, size, frequency, firstDelaySec, tipAfterSec, cooldownMin, snoozeHours, maxPerDay, wander, wanderEverySec, idleLife, celebrate, restAfterSec, speed } = settings;
  return { enabled, size, frequency, firstDelaySec, tipAfterSec, cooldownMin, snoozeHours, maxPerDay, wander, wanderEverySec, idleLife, celebrate, restAfterSec, speed, animations };
}

export function companionViewFor(config: StoredCompanionConfig, version: number | null, entitlements: Entitlements): CompanionView {
  const viewer = companionViewerOf(entitlements);
  const features = featureStates(config.access, config.settings.enabled, viewer);
  const tips =
    features.companion === 'open'
      ? config.tips
          .filter((tip) => visibleTip(tip, viewer))
          .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id))
          .map(({ id, order, category, title, text, screens, afterTools, audience, trigger, animation, action, access, weight }) => ({
            id,
            order,
            category,
            ...(title && title.en.trim() ? { title: { en: title.en, he: title.he } } : {}),
            text: { en: text.en, he: text.he },
            screens,
            ...(afterTools?.length ? { afterTools } : {}),
            audience,
            trigger,
            animation,
            action: {
              type: action.type,
              label: { en: action.label.en, he: action.label.he },
              ...(action.tool ? { tool: action.tool } : {}),
              ...(action.mood ? { mood: action.mood } : {}),
              ...(action.page ? { page: action.page } : {}),
              ...(action.itemId ? { itemId: action.itemId } : {}),
            },
            access,
            weight,
          }))
      : [];
  return { version, key: short([version ?? 0, features]), settings: settingsFor(config.settings), features, tips };
}
