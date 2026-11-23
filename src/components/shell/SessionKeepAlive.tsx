'use client';

import { useEffect } from 'react';

// Keeps the sign-in alive while the studio or the admin dashboard is in use.
// Pages read the session without renewing it (src/server/session.ts: a
// server-rendered page cannot write cookies), so renewal happens here, in
// Better Auth's own endpoint, which moves the session's end in the database
// and the cookie's in the browser together — at most once a day, when the
// session is due. Asked once whenever a page loads, even one the browser
// reports as hidden (a tab restored or opened in the background, a headless
// browser: waiting for it to be shown left such a page's cookie unrenewed,
// CI run 59), and again whenever a page comes back into view, at most every
// 30 minutes. Nothing is shown and failures are ignored (the next load or
// return asks again).

const EVERY_MS = 30 * 60 * 1000;
let lastAsked = 0;

export function SessionKeepAlive() {
  useEffect(() => {
    const renew = (onLoad: boolean) => {
      if (!onLoad && document.visibilityState !== 'visible') return;
      if (Date.now() - lastAsked < EVERY_MS) return;
      lastAsked = Date.now();
      void fetch('/api/auth/get-session', { credentials: 'same-origin', cache: 'no-store' }).catch(() => undefined);
    };
    renew(true);
    const onVisibility = () => renew(false);
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, []);
  return null;
}
