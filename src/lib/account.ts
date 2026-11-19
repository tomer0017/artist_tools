import type { Currency, Locale } from './locale';
import type { FeatureId, PlanId, PlanOffer } from './plans';
import type { LearnCollection } from './learn/model';

/** The five tools' ids (as in TabId), for checking what the browser sends. */
export const TOOL_IDS = ['measure', 'value', 'color', 'grid', 'compare'] as const;
export type ToolId = (typeof TOOL_IDS)[number];

/**
 * What the studio may show of Learn (ADR-0018), decided by the server from the
 * plan in force and the published plans. Which items open is decided again on
 * every Learn request (src/lib/learn/access.ts); this only shapes the studio.
 */
export interface LearnSummary {
  /** Learn appears at all (Home, the desktop navigation, /app/learn): an admin, or a Learn module some published plan offers. */
  visible: boolean;
  /**
   * Per collection: open (the plan in force includes its module; admins:
   * always), locked (some published plan offers it, this one does not), or
   * null (no plan offers it: not shown at all).
   */
  modules: Record<LearnCollection, 'open' | 'locked' | null>;
  /** Changes whenever this account's Learn access may have changed, so open Learn screens ask again. */
  key: string;
}

/**
 * What the signed-in person may see about their own account: identity, role,
 * plan and what it includes, preferences and sign-in methods. Built by the
 * server from the database (src/server/account.ts); the studio only displays
 * it.
 */
export interface AccountSummary {
  id: string;
  name: string;
  /** A username account's is only a placeholder (src/lib/username.ts): show `username` instead. */
  email: string;
  /** Accounts an administrator created for a tester sign in with this username (as given); null otherwise. */
  username: string | null;
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
  /** What this account may use now: the studio opens a tool, or offers a save, only if it is listed here. */
  features: FeatureId[];
  /** What each plan includes as published (to explain a lock: part of Pro, or off for everyone). */
  offer: PlanOffer;
  /** When the server read this (ISO): a copy never replaces a newer one (e.g. a page restored from history). */
  asOf: string;
  /** Learn in the studio (ADR-0018). */
  learn: LearnSummary;
  /** Tools whose first-visit introduction this person has dismissed (on any device). */
  introsSeen: ToolId[];
  locale: Locale;
  currency: Currency;
  marketingConsent: boolean;
  /** How this person can sign in. */
  methods: { google: boolean; password: boolean };
  /** Whether this server offers email + password (adding a password, connecting Google to one). */
  emailPasswordEnabled: boolean;
  /** Whether this server offers username sign-in (a username account can then change its password). */
  usernamePasswordEnabled: boolean;
}
