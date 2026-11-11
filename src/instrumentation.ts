import type { Instrumentation } from 'next';

// Errors thrown while the server renders a page or answers a route or action
// are grouped for the admin's Errors page (src/server/error-reports.ts),
// besides the server log. Only the route pattern is kept (e.g.
// /admin/users/[id]), never the request's address, headers or body.

export const onRequestError: Instrumentation.onRequestError = async (error, request, context) => {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  try {
    const [{ getDb }, { recordError }] = await Promise.all([import('@/server/db/client'), import('@/server/error-reports')]);
    const err = error instanceof Error ? error : new Error(String(error));
    await recordError(getDb(), {
      source: 'server',
      message: `${err.name}: ${err.message}`,
      stack: err.stack ?? null,
      path: context.routePath || request.path,
      release: process.env.BUILD_COMMIT ?? null,
    });
  } catch {
    // Monitoring must never make an error worse; the server log still has it.
  }
};
