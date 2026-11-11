import type { Currency, Locale } from './locale';
import type { FeatureId, PlanId } from './plans';

/** The five tools' ids (as in TabId), for checking what the browser sends. */
export const TOOL_IDS = ['measure', 'value', 'color', 'grid', 'compare'] as const;
export type ToolId = (typeof TOOL_IDS)[number];

/**
 * What the signed-in person may see about their own account: identity, role,
 * plan and what it includes, preferences and sign-in methods. Built by the
 * server from the database (src/server/account.ts); the studio only displays
 * it.
 */
export interface AccountSummary {
  id: string;
  name: string;
  email: string;
  emailVerified: boolean;
  image: string | null;
  role: 'user' | 'admin';
  createdAt: string;
  lastLoginAt: string | null;
  plan: { assigned: PlanId; effective: PlanId };
  /** Time-limited access given by Studio Companion (a promotion, trial or support), while it lasts. */
  grant: { planId: PlanId; endsAt: string } | null;
  /** Features with a usage quota on this plan, and what is left of it now. */
  quotas: { feature: FeatureId; limit: number; period: 'day' | 'month'; left: number }[];
  /** What decides the features: the admin role, the plan in force, or nothing. */
  access: 'admin' | PlanId | 'none';
  subscription: { status: 'none' | 'trialing' | 'active' | 'past_due' | 'canceled' | 'incomplete' | 'expired' };
  features: FeatureId[];
  /** Tools whose first-visit introduction this person has dismissed (on any device). */
  introsSeen: ToolId[];
  locale: Locale;
  currency: Currency;
  marketingConsent: boolean;
  /** How this person can sign in. */
  methods: { google: boolean; password: boolean };
  /** Whether this server offers email + password (adding a password, connecting Google to one). */
  emailPasswordEnabled: boolean;
}
