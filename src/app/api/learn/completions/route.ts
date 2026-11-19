import { z } from 'zod';
import { ITEM_ID } from '@/lib/learn/model';
import { UnreadableConfigError } from '@/server/config/versions';
import { log } from '@/server/log';
import { completionHistory, completionSummary, historyTitles, parseCursor, recordCompletion } from '@/server/learn/completions';
import { learnJson, learnRequest } from '@/server/learn/request';
import { BodyTooLarge, fromOwnOrigin, readJsonBody } from '@/server/request';
import { THROTTLES, consumeThrottle } from '@/server/security/throttle';

// The signed-in person's Learn history (ADR-0018), their own only:
//   GET  /api/learn/completions[?after=<cursor>]: how often and when last each
//        item was completed, a page of completions (newest first) and the
//        items' titles;
//   POST /api/learn/completions {itemId}: "Mark as completed", only for an
//        item open to the account at this moment (403 locked, 404 unknown).
// Class mode never calls this: the browser does not ask (asserted in e2e).

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const after = new URL(request.url).searchParams.get('after');
    const cursor = after === null ? null : parseCursor(after);
    if (after !== null && !cursor) return learnJson({ error: 'invalid_request' }, 400);
    const ready = await learnRequest();
    if (ready instanceof Response) return ready;
    const { userId } = ready;
    const [summary, page] = await Promise.all([completionSummary(ready.db, userId), completionHistory(ready.db, userId, { after: cursor })]);
    const titles = await historyTitles(ready.db, ready.entitlements, Object.keys(summary.items));
    return learnJson({ summary, ...page, titles });
  } catch (error) {
    return failed(error, 'api.learn_completions_failed');
  }
}

const Body = z.object({ itemId: z.string().regex(ITEM_ID) }).strict();

export async function POST(request: Request) {
  if (!fromOwnOrigin(request)) return learnJson({ error: 'forbidden' }, 403);
  try {
    const body = Body.safeParse(await readJsonBody(request, 1024));
    if (!body.success) return learnJson({ error: 'invalid_request' }, 400);
    const ready = await learnRequest();
    if (ready instanceof Response) return ready;
    const { userId } = ready;
    if (ready.entitlements.access !== 'admin' && !(await consumeThrottle(ready.db, 'learn-completions', userId.toHexString(), THROTTLES.learnCompletions)).allowed) {
      return learnJson({ error: 'too_many_requests' }, 429);
    }
    const result = await recordCompletion(ready.db, userId, ready.entitlements, body.data.itemId);
    if (result.status === 'not_found') return learnJson({ error: 'not_found' }, 404);
    if (result.status === 'locked') return learnJson({ error: 'locked', reason: result.reason }, 403);
    if (result.status === 'full') return learnJson({ error: 'history_full' }, 409);
    return learnJson({ completion: result.completion }, 201);
  } catch (error) {
    if (error instanceof BodyTooLarge) return learnJson({ error: 'too_large' }, 413);
    return failed(error, 'api.learn_completion_failed');
  }
}

function failed(error: unknown, event: string) {
  if (error instanceof UnreadableConfigError) {
    log.error('learn.content_unreadable', { version: error.version, issues: error.issues.slice(0, 3) });
  } else {
    log.error(event, { error });
  }
  return learnJson({ error: 'unavailable' }, 503);
}
