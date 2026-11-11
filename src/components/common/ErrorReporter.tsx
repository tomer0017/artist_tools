'use client';

import { useEffect } from 'react';

// Sends errors this page hits to our own server (POST /api/client-errors), for
// the admin's Errors page: the message, the stack, the path and the release.
// Nothing else, no third party. At most five per page load; errors from
// browser extensions and cross-origin "Script error." (no details) are
// skipped.

const MAX_PER_PAGE = 5;
const IGNORED = /^(ResizeObserver loop|Script error\.?$)/;
const FROM_EXTENSION = /(chrome|moz|safari(-web)?)-extension:\/\//;

export function ErrorReporter() {
  useEffect(() => {
    let sent = 0;
    const seen = new Set<string>();
    const report = (message: string, stack: string | undefined) => {
      if (!message || IGNORED.test(message) || FROM_EXTENSION.test(stack ?? '') || sent >= MAX_PER_PAGE || seen.has(message)) return;
      seen.add(message);
      sent += 1;
      void fetch('/api/client-errors', {
        method: 'POST',
        keepalive: true,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          message: message.slice(0, 2000),
          stack: stack?.slice(0, 8000) ?? null,
          path: window.location.pathname,
          release: process.env.BUILD_COMMIT ?? null,
        }),
      })
        .then((response) => response.text())
        .catch(() => {});
    };
    const onError = (event: ErrorEvent) => {
      if (FROM_EXTENSION.test(event.filename ?? '')) return;
      report(event.message || String(event.error), event.error instanceof Error ? event.error.stack : undefined);
    };
    const onRejection = (event: PromiseRejectionEvent) => {
      const reason = event.reason;
      report(reason instanceof Error ? `${reason.name}: ${reason.message}` : `Unhandled rejection: ${String(reason).slice(0, 200)}`, reason instanceof Error ? reason.stack : undefined);
    };
    window.addEventListener('error', onError);
    window.addEventListener('unhandledrejection', onRejection);
    return () => {
      window.removeEventListener('error', onError);
      window.removeEventListener('unhandledrejection', onRejection);
    };
  }, []);
  return null;
}
