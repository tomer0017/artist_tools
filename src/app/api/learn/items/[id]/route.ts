import { LEARN_MODULE, isItemId, itemImages, itemsOf, listPicture } from '@/lib/learn/model';
import { UnreadableConfigError } from '@/server/config/versions';
import { log } from '@/server/log';
import { learnAccess } from '@/lib/learn/access';
import { getPlanStates } from '@/server/entitlements';
import { liveLearn, planLearnViewer } from '@/server/learn/live';
import { assetsFor, fullItem, listEntry } from '@/server/learn/present';
import { learnJson, learnRequest } from '@/server/learn/request';

// GET /api/learn/items/<id> (ADR-0017, ADR-0023): one exercise or challenge,
// in full, for an account that may open it; 403 when it is a Pro item and the
// account is not on Pro, with what a list shows of it (ADR-0018: its locked
// page names it); 404 when it does not exist, is Admin only (to anyone but
// admins), Blocked or archived. `?preview=1` lets an admin see a Blocked or
// archived one, marked as a preview.
// Decided on every request from fresh entitlements: a card left open loses
// its content the moment access ends.

export const dynamic = 'force-dynamic';

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    if (!isItemId(id)) return learnJson({ error: 'not_found' }, 404);
    const ready = await learnRequest();
    if (ready instanceof Response) return ready;
    const { db, entitlements } = ready;
    const admin = entitlements.access === 'admin';
    const { content, version, view } = await liveLearn(db, entitlements);
    const state = view.state(id);
    if (state.status === 'hidden') {
      // Admin → Learn's preview (ADR-0023): an admin sees a Blocked or archived item as learners would, marked as a preview.
      const hidden = admin && new URL(request.url).searchParams.get('preview') === '1' ? itemsOf(content).find((i) => i.id === id) : undefined;
      if (!hidden) return learnJson({ error: 'not_found' }, 404);
      const assets = await assetsFor(db, itemImages(hidden).map((ref) => ref.assetId));
      return learnJson({ contentVersion: version, item: fullItem(hidden, assets, true, view.mode(id)), preview: true });
    }
    const item = itemsOf(content).find((i) => i.id === id)!;
    if (state.status === 'locked') {
      // What a list may show of it (title, place, a thumbnail where previews
      // allow), so its own page can say what is locked; nothing for a module
      // no plan offers, which lists do not show either.
      const listed = view.listed(id);
      const picture = listPicture(item);
      const assets = listed && view.thumbnail(id) && picture ? await assetsFor(db, [picture.assetId]) : new Map();
      const summary = listed ? { item: listEntry(item, state, view.thumbnail(id), assets, false) } : {};
      // Whether Pro opens it: its page then offers the upgrade (ProPaywall, src/components/billing/pro.tsx).
      const inPro = entitlements.planId !== 'pro' && learnAccess(planLearnViewer(entitlements, await getPlanStates(db), 'pro'), content).state(id).status === 'open';
      return learnJson({ error: 'locked', reason: state.reason, feature: LEARN_MODULE[item.collection], ...(inPro ? { inPro: true } : {}), ...summary }, 403);
    }
    const assets = await assetsFor(db, itemImages(item).map((ref) => ref.assetId));
    return learnJson({ contentVersion: version, item: fullItem(item, assets, admin, view.mode(id)) });
  } catch (error) {
    if (error instanceof UnreadableConfigError) {
      log.error('learn.content_unreadable', { version: error.version, issues: error.issues.slice(0, 3) });
      return learnJson({ error: 'unavailable' }, 503);
    }
    log.error('api.learn_item_failed', { error });
    return learnJson({ error: 'unavailable' }, 503);
  }
}
