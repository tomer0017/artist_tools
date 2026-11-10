import 'server-only';
import { log } from '@/server/log';

// Work that must not hold up a response, mainly account email: sending it in
// the background means a reset request takes the same time whether or not the
// address has an account. Failures are logged, never thrown at the caller.

const pending = new Set<Promise<void>>();

export function runInBackground(work: Promise<unknown>): void {
  const task: Promise<void> = work
    .then(() => undefined)
    .catch((error) => log.error('background.task_failed', { error }))
    .finally(() => pending.delete(task));
  pending.add(task);
}

/** Wait until every background task has finished (tests, graceful shutdown). */
export async function settleBackground(): Promise<void> {
  while (pending.size > 0) await Promise.all([...pending]);
}
