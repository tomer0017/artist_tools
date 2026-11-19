import { toObjectId } from '@/server/db/collections';
import { log } from '@/server/log';
import { removeCompletion } from '@/server/learn/completions';
import { learnJson, learnRequest } from '@/server/learn/request';
import { fromOwnOrigin } from '@/server/request';
import { THROTTLES, consumeThrottle } from '@/server/security/throttle';

// DELETE /api/learn/completions/<id> (ADR-0018): remove one entry of the
// signed-in person's own history ("Undo" right after marking, or a tap on the
// history page). Another person's entry answers 404, exactly like a missing one.

export const dynamic = 'force-dynamic';

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  if (!fromOwnOrigin(request)) return learnJson({ error: 'forbidden' }, 403);
  try {
    const completionId = toObjectId((await context.params).id);
    if (!completionId) return learnJson({ error: 'not_found' }, 404);
    const ready = await learnRequest();
    if (ready instanceof Response) return ready;
    const { userId } = ready;
    if (ready.entitlements.access !== 'admin' && !(await consumeThrottle(ready.db, 'learn-completions', userId.toHexString(), THROTTLES.learnCompletions)).allowed) {
      return learnJson({ error: 'too_many_requests' }, 429);
    }
    if (!(await removeCompletion(ready.db, userId, completionId))) return learnJson({ error: 'not_found' }, 404);
    return learnJson({ ok: true });
  } catch (error) {
    log.error('api.learn_completion_remove_failed', { error });
    return learnJson({ error: 'unavailable' }, 503);
  }
}
