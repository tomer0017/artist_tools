'use client';

import { useEffect, useState } from 'react';
import Studio from './Studio';

// The studio is a canvas app: its state starts from localStorage and its
// layout depends on the screen size, neither of which exists on the server.
// It therefore renders only in the browser, once mounted; until then the
// body's background shows, exactly as before the migration. Its code is still
// part of the page's first download (a lazy import would only start fetching it
// after the framework had loaded, adding a round trip before anything appears).
export default function StudioClient() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  return mounted ? <Studio /> : null;
}
