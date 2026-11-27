import { STORAGE_KEY as COMPARE_STORAGE_KEY } from '@/features/compare-art/compareArtStorage';
import { PROJECT_STORAGE_KEY } from '@/hooks/useProjectStore';
import { ONBOARDING_STORAGE_PREFIX } from '@/onboarding/onboardingStorage';
import { PLAYGROUND_PREFIX } from '@/lib/learn/roulette';
import { COMPANION_STORAGE_PREFIX } from '@/lib/companion/model';
import { WALL_DB_NAME, WALL_STORAGE_PREFIX } from '@/features/art-wall/storageKeys';

// The studio keeps work in this browser only (images never leave the device).
// On a shared device, signing out — or deleting the account — can also remove
// it, so the next person does not see it (Learn's saved challenge ideas and
// drawing timer too, and what Sketchy remembers here). Nothing on the server
// is touched.

const INTRO_PREFIX = 'studio-intro-seen:';

export function clearDeviceWork(): void {
  try {
    for (const key of Object.keys(localStorage)) {
      if (key === PROJECT_STORAGE_KEY || key === COMPARE_STORAGE_KEY || key.startsWith(ONBOARDING_STORAGE_PREFIX) || key.startsWith(INTRO_PREFIX) || key.startsWith(PLAYGROUND_PREFIX) || key.startsWith(COMPANION_STORAGE_PREFIX) || key.startsWith(WALL_STORAGE_PREFIX)) {
        localStorage.removeItem(key);
      }
    }
    sessionStorage.removeItem('use-color-in-tab');
    for (const key of Object.keys(sessionStorage)) if (key.startsWith(COMPANION_STORAGE_PREFIX)) sessionStorage.removeItem(key);
    // Art on Your Wall's projects and images (IndexedDB).
    if (typeof indexedDB !== 'undefined') indexedDB.deleteDatabase(WALL_DB_NAME);
  } catch (error) {
    console.error('[deviceData] Could not clear this device’s work:', error);
  }
}
