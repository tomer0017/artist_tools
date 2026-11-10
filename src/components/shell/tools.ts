import { Grid3X3, Home, Palette, Ruler, SquareSplitHorizontal, Sun, type LucideIcon } from 'lucide-react';
import type { NavViewId, TabId, ViewId } from '@/types/project';

// ─── Tool registry ────────────────────────────────────────────────────────────
// The single source of truth for how every tool is named and explained — the
// Home cards, both navigation bars and every tool header read from here, so a
// tool can never be called one thing on Home and another inside the app.
//
// Titles are the artist's goal ("Measure & Plan"), not the mechanism; the
// short `navLabel` is what fits under an icon in the bottom bar.

export interface ToolInfo {
  id: TabId;
  /** Goal-first title used on Home and in tool headers. */
  title: string;
  /** One word for navigation bars. */
  navLabel: string;
  /** What the tool does for the painting, in one sentence. */
  description: string;
  /** A few concrete capabilities, shown as chips on wider Home cards. */
  chips: string[];
  icon: LucideIcon;
}

export const TOOLS: Record<TabId, ToolInfo> = {
  measure: {
    id: 'measure',
    title: 'Measure & Plan',
    navLabel: 'Measure',
    description: 'Get accurate proportions and real measurements for your artwork.',
    chips: ['Proportions', 'Real size (cm/in)', 'Plan drawing'],
    icon: Ruler,
  },
  value: {
    id: 'value',
    title: 'Study & Simplify',
    navLabel: 'Study',
    description: 'Break down your reference into colors, values and clear shapes.',
    chips: ['Color study', 'Light & shadow', 'Sketch'],
    icon: Sun,
  },
  color: {
    id: 'color',
    title: 'Color & Mixing',
    navLabel: 'Color',
    description: 'Explore color relationships and get practical paint mixing recipes.',
    chips: ['Color wheel', 'Harmonies', 'Mixing recipes'],
    icon: Palette,
  },
  grid: {
    id: 'grid',
    title: 'Create a Grid',
    navLabel: 'Grid',
    description: 'Add a grid to your reference to transfer it accurately to canvas.',
    chips: ['3×3 · 4×4 · 8×8', 'Custom grid', 'Print / Save'],
    icon: Grid3X3,
  },
  compare: {
    id: 'compare',
    title: 'Compare & Correct',
    navLabel: 'Compare',
    description: 'Overlay your painting with the reference to spot differences and fix them.',
    chips: ['Align images', 'Fade & compare', 'Create GIF'],
    icon: SquareSplitHorizontal,
  },
};

/** Order of the Home cards: the natural order of a painting's life. */
export const HOME_ORDER: TabId[] = ['measure', 'value', 'color', 'grid', 'compare'];

/** Order of the navigation bars. */
export const NAV_ORDER: NavViewId[] = ['home', 'measure', 'value', 'grid', 'compare', 'color'];

export const HOME_NAV = { id: 'home' as const, navLabel: 'Home', title: 'Home', icon: Home };

export function navItem(id: NavViewId) {
  return id === 'home' ? HOME_NAV : TOOLS[id];
}

// URL segments follow the visible names (the Value tool is "Study" to the
// artist), while the internal ids stay stable for saved data and tests.
const SLUGS: Record<TabId, string> = {
  measure: 'measure',
  value: 'study',
  color: 'color',
  grid: 'grid',
  compare: 'compare',
};

/** URL segments of the tools, e.g. for the router to know which tool pages exist. */
export const TOOL_SLUGS: string[] = Object.values(SLUGS);

/** Every view's URL segment: the tools plus the account page. */
const VIEW_SLUGS: Record<Exclude<ViewId, 'home'>, string> = { ...SLUGS, profile: 'profile' };

/** The studio lives under /app; the site root is the public landing page. */
const STUDIO_ROOT = '/app';

/** URL path for each view (Home is the studio root). */
export function pathForView(view: ViewId): string {
  return view === 'home' ? STUDIO_ROOT : `${STUDIO_ROOT}/${VIEW_SLUGS[view]}`;
}

/** Parse a URL segment into a view; undefined segment = Home, unknown = null. */
export function viewFromPath(segment: string | undefined): ViewId | null {
  if (!segment) return 'home';
  const hit = (Object.keys(VIEW_SLUGS) as Exclude<ViewId, 'home'>[]).find((id) => VIEW_SLUGS[id] === segment);
  return hit ?? null;
}

/** Parse a studio pathname (/app, /app/study…) into a view; anything else = null. */
export function viewFromPathname(pathname: string): ViewId | null {
  if (pathname === STUDIO_ROOT || pathname === `${STUDIO_ROOT}/`) return 'home';
  if (!pathname.startsWith(`${STUDIO_ROOT}/`)) return null;
  const segment = pathname.slice(STUDIO_ROOT.length + 1).replace(/\/$/, '');
  return segment.includes('/') ? null : viewFromPath(segment);
}
