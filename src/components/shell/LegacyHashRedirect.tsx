'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { pathForView, viewFromPath } from './tools';

// Links from before the Next.js migration used hash routes (/#/compare). The
// hash never reaches the server, so the landing page forwards them to the real
// tool URL; unknown tools land on Home, as they always did.
export default function LegacyHashRedirect() {
  const router = useRouter();
  useEffect(() => {
    const match = /^#\/([^/?#]*)/.exec(window.location.hash);
    if (!match) return;
    router.replace(pathForView(viewFromPath(match[1] || undefined) ?? 'home'));
  }, [router]);
  return null;
}
