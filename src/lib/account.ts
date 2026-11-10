import type { FeatureId, PlanId } from './plans';

/**
 * What the signed-in person may see about their own account: identity from
 * Google, role, plan and what it includes. Built by the server from the
 * database (src/server/account.ts); the studio only displays it.
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
  /** What decides the features: the admin role, the plan in force, or nothing. */
  access: 'admin' | PlanId | 'none';
  subscription: { status: 'none' | 'trialing' | 'active' | 'past_due' | 'canceled' | 'incomplete' | 'expired' };
  features: FeatureId[];
}
