import { proExtraFor } from '@/server/billing/upsell';
import { UnreadableConfigError } from '@/server/config/versions';
import { learnJson, learnRequest } from '@/server/learn/request';

// GET /api/billing/upsell: how many more lessons and challenges Pro would open
// for the signed-in account (src/server/billing/upsell.ts). The tools and
// exports Pro adds are already in the account's plan offer.

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const ready = await learnRequest();
    if (ready instanceof Response) return ready;
    const { learn } = await proExtraFor(ready.db, ready.entitlements);
    return learnJson({ extra: learn });
  } catch (error) {
    if (error instanceof UnreadableConfigError) return learnJson({ error: 'unavailable' }, 503);
    throw error;
  }
}
