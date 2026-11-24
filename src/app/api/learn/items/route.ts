import { z } from 'zod';
import { LEARN_COLLECTIONS, listPicture } from '@/lib/learn/model';
import { UnreadableConfigError } from '@/server/config/versions';
import { log } from '@/server/log';
import { learnAccess } from '@/lib/learn/access';
import { getPlanStates } from '@/server/entitlements';
import { liveLearn, planLearnViewer } from '@/server/learn/live';
import { assetsFor, listEntry } from '@/server/learn/present';
import { learnJson, learnRequest } from '@/server/learn/request';

// GET /api/learn/items?collection=curriculum|color|challenges (ADR-0017): a
// collection's items as this account's lists may show them, in order (each
// item's own access mode decides, ADR-0023). Open items and items Pro opens
// (title, place, lock, thumbnail); Admin only items appear only to admins;
// Blocked and archived ones to nobody. Item content is never in a list:
// GET /api/learn/items/<id> sends it to accounts that may open it.

export const dynamic = 'force-dynamic';

const Query = z.object({ collection: z.enum(LEARN_COLLECTIONS) });

export async function GET(request: Request) {
  try {
    const query = Query.safeParse(Object.fromEntries(new URL(request.url).searchParams));
    if (!query.success) return learnJson({ error: 'invalid_request' }, 400);
    const ready = await learnRequest();
    if (ready instanceof Response) return ready;
    const { db, entitlements } = ready;
    const admin = entitlements.access === 'admin';
    const { content, version, view } = await liveLearn(db, entitlements);
    const rows = view.list(query.data.collection);
    const assets = await assetsFor(
      db,
      rows.flatMap(({ item }) => {
        const picture = listPicture(item);
        return view.thumbnail(item.id) && picture ? [picture.assetId] : [];
      }),
    );
    const groups = content.groups
      .filter((group) => group.collection === query.data.collection && rows.some(({ item }) => item.groupId === group.id))
      .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id))
      .map(({ id, order, title, summary, level }) => ({ id, order, title: { en: title.en, he: title.he }, ...(summary ? { summary: { en: summary.en, he: summary.he } } : {}), ...(level ? { level } : {}) }));
    // Locked items that Pro opens are marked, so the list can offer the upgrade (src/components/billing/pro.tsx).
    const pro = entitlements.planId !== 'pro' && rows.some(({ state }) => state.status !== 'open') ? learnAccess(planLearnViewer(entitlements, await getPlanStates(db), 'pro'), content) : null;
    return learnJson({
      collection: query.data.collection,
      contentVersion: version,
      groups,
      items: rows.map(({ item, state }) => ({ ...listEntry(item, state, view.thumbnail(item.id), assets, admin, view.mode(item.id)), ...(pro && state.status !== 'open' && pro.state(item.id).status === 'open' ? { inPro: true } : {}) })),
    });
  } catch (error) {
    if (error instanceof UnreadableConfigError) {
      log.error('learn.content_unreadable', { version: error.version, issues: error.issues.slice(0, 3) });
      return learnJson({ error: 'unavailable' }, 503);
    }
    log.error('api.learn_items_failed', { error });
    return learnJson({ error: 'unavailable' }, 503);
  }
}
