'use client';

import { useEffect, useState } from 'react';
import Studio from './Studio';
import type { StudioAccount } from './account';

// The studio is a canvas app: its state starts from localStorage and its
// layout depends on the screen size, neither of which exists on the server.
// It therefore renders only in the browser, once mounted; until then the
// body's background shows, exactly as before the migration. Its code is still
// part of the page's first download (a lazy import would only start fetching it
// after the framework had loaded, adding a round trip before anything appears).
export default function StudioClient({ account }: { account: StudioAccount }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  useIosNoInputZoom();
  return mounted ? <Studio account={account} /> : null;
}

const isIos = () =>
  /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

/**
 * On iPhone and iPad only, `maximum-scale=1` while the studio is open: Safari
 * then no longer zooms into small text fields (a scale length) and stays
 * zoomed, while people can still pinch-zoom the page (Safari ignores the
 * limit for that). Elsewhere page zoom stays free (WCAG 1.4.4); the tools'
 * canvases handle their own pinch (touch-action: none).
 */
function useIosNoInputZoom() {
  useEffect(() => {
    const meta = document.querySelector<HTMLMetaElement>('meta[name="viewport"]');
    if (!meta || !isIos()) return;
    const original = meta.content;
    meta.content = `${original}, maximum-scale=1`;
    return () => {
      meta.content = original;
    };
  }, []);
}
