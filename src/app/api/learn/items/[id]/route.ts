import { LEARN_MODULE, isItemId, itemImages, itemsOf, listPicture } from '@/lib/learn/model';
import { UnreadableConfigError } from '@/server/config/versions';
import { log } from '@/server/log';
import { liveLearn } from '@/server/learn/live';
import { assetsFor, fullItem, listEntry } from '@/server/learn/present';
import { learnJson, learnRequest } from '@/server/learn/request';

// GET /api/learn/items/<id> (ADR-0017): one exercise or challenge, in full,
// for an account that may open it; 403 with the reason when it is locked
// (the module is not in the plan, or the plan's rule leaves it out), plus
// what a list shows of it when lists show it (ADR-0018: its locked page
// names it); 404 when
// it does not exist or is not published (admins see unpublished items too).
// Decided on every request from fresh entitlements: a card left open loses
// its content the moment access ends.

export const dynamic = 'force-dynamic';

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    if (!isItemId(id)) return learnJson({ error: 'not_found' }, 404);
    const ready = await learnRequest();
    if (ready instanceof Response) return ready;
    const { db, entitlements } = ready;
    const { content, version, view } = await liveLearn(db, entitlements);
    const state = view.state(id);
    if (state.status === 'hidden') return learnJson({ error: 'not_found' }, 404);
    const item = itemsOf(content).find((i) => i.id === id)!;
    if (state.status === 'locked') {
      // What a list may show of it (title, place, a thumbnail where previews
      // allow), so its own page can say what is locked; nothing for a module
      // no plan offers, which lists do not show either.
      const listed = view.listed(id);
      const picture = listPicture(item);
      const assets = listed && view.thumbnail(id) && picture ? await assetsFor(db, [picture.assetId]) : new Map();
      const summary = listed ? { item: listEntry(item, state, view.thumbnail(id), assets, false) } : {};
      return learnJson({ error: 'locked', reason: state.reason, feature: LEARN_MODULE[item.collection], ...summary }, 403);
    }
    const assets = await assetsFor(db, itemImages(item).map((ref) => ref.assetId));
    return learnJson({ contentVersion: version, item: fullItem(item, assets, entitlements.access === 'admin') });
  } catch (error) {
    if (error instanceof UnreadableConfigError) {
      log.error('learn.content_unreadable', { version: error.version, issues: error.issues.slice(0, 3) });
      return learnJson({ error: 'unavailable' }, 503);
    }
    log.error('api.learn_item_failed', { error });
    return learnJson({ error: 'unavailable' }, 503);
  }
}
