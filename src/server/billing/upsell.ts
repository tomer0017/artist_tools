import 'server-only';
import type { Db } from 'mongodb';
import { learnAccess } from '@/lib/learn/access';
import { LEARN_COLLECTIONS, type LearnCollection } from '@/lib/learn/model';
import { featureRows, type FeatureRow } from '@/lib/plans';
import { getPlanStates, type Entitlements } from '@/server/entitlements';
import { liveLearn, planLearnViewer } from '@/server/learn/live';

// What Pro would open for an account beyond what it opens now (the upgrade
// surfaces, docs/billing/03-paypal.md): the features (tools, exports) of the
// published Pro plan the account lacks, and how many more Learn items Pro's
// rules open. Read from the published plans and content, never written by
// hand, so it is always what upgrading really gives.

export interface ProExtra {
  rows: FeatureRow[];
  learn: Record<LearnCollection, number>;
}

export async function proExtraFor(db: Db, entitlements: Entitlements): Promise<ProExtra> {
  const none = Object.fromEntries(LEARN_COLLECTIONS.map((c) => [c, 0])) as Record<LearnCollection, number>;
  if (entitlements.access === 'admin' || entitlements.planId === 'pro') return { rows: [], learn: none };
  const mine = new Set(entitlements.features);
  const pro = entitlements.offer.pro;
  const rows = featureRows([pro, entitlements.features]).filter((row) => row.features.every((f) => pro.includes(f)) && !row.features.every((f) => mine.has(f)));
  const { content, view } = await liveLearn(db, entitlements);
  const proView = learnAccess(planLearnViewer(entitlements, await getPlanStates(db), 'pro'), content);
  const learn = Object.fromEntries(
    LEARN_COLLECTIONS.map((c) => {
      const opened = new Set(view.opens(c));
      return [c, proView.opens(c).filter((id) => !opened.has(id)).length];
    }),
  ) as Record<LearnCollection, number>;
  return { rows, learn };
}
