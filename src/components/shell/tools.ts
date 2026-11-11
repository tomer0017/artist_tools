import { Grid3X3, Home, Palette, Ruler, SquareSplitHorizontal, Sun, type LucideIcon } from 'lucide-react';
import { en } from '@/i18n/messages/en';
import type { NavViewId, TabId, ViewId } from '@/types/project';

// ─── Tool registry ────────────────────────────────────────────────────────────
// The single source of truth for how every tool is named and explained — the
// Home cards, both navigation bars and every tool header read from here, so a
// tool can never be called one thing on Home and another inside the app.
//
// Titles are the artist's goal ("Measure & Plan"), not the mechanism; the
// short `navLabel` is what fits under an icon in the bottom bar. The words
// live in the messages (`tools.<id>`, English and Hebrew); TOOLS holds the
// English ones for places that are not translated.

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
  /** The first-visit introduction: how it works in three short steps, and the button that starts. */
  intro: { steps: [string, string, string]; start: string };
}

const english = (id: TabId, icon: LucideIcon): ToolInfo => {
  const m = en.tools[id];
  return {
    id,
    title: m.title,
    navLabel: m.navLabel,
    description: m.description,
    chips: [m.chip1, m.chip2, m.chip3],
    icon,
    intro: { steps: [m.step1, m.step2, m.step3], start: m.start },
  };
};

/** Each tool in English (the admin dashboard and other untranslated places); the studio reads `tools.<id>` messages instead. */
export const TOOLS: Record<TabId, ToolInfo> = {
  measure: english('measure', Ruler),
  value: english('value', Sun),
  color: english('color', Palette),
  grid: english('grid', Grid3X3),
  compare: english('compare', SquareSplitHorizontal),
};

/** Each tool's picture (Home cards, the landing page, first-visit introductions). The images are
 *  wide; `position` keeps each one's subject in view when a narrow frame crops it. */
export const TOOL_ART: Record<TabId, { src: string; alt: string; width: number; height: number; position: string }> = {
  measure: { src: '/images/home/home-measure.webp', alt: en.tools.measure.alt, width: 586, height: 230, position: '100% 50%' },
  value: { src: '/images/home/home-study.webp', alt: en.tools.value.alt, width: 586, height: 211, position: '35% 50%' },
  color: { src: '/images/home/home-color.webp', alt: en.tools.color.alt, width: 586, height: 209, position: '62% 50%' },
  grid: { src: '/images/home/home-grid.webp', alt: en.tools.grid.alt, width: 586, height: 196, position: '50% 50%' },
  compare: { src: '/images/home/home-compare.webp', alt: en.tools.compare.alt, width: 586, height: 205, position: '50% 50%' },
};

/** Whether a view is one of the five tools (not Home, the account or the plans page). */
export const isTool = (view: ViewId): view is TabId => view in TOOLS;

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

/** Every view's URL segment: the tools plus the account and plans pages. */
const VIEW_SLUGS: Record<Exclude<ViewId, 'home'>, string> = { ...SLUGS, profile: 'profile', plans: 'plans' };

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
