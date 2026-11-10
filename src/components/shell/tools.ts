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
  /** The first-visit introduction: how it works in three short steps, and the button that starts. */
  intro: { steps: [string, string, string]; start: string };
}

export const TOOLS: Record<TabId, ToolInfo> = {
  measure: {
    id: 'measure',
    title: 'Measure & Plan',
    navLabel: 'Measure',
    description: 'Get accurate proportions and real measurements for your artwork.',
    chips: ['Proportions', 'Real size (cm/in)', 'Plan drawing'],
    icon: Ruler,
    intro: {
      steps: [
        'Add a photo of your reference.',
        'Set the scale: tap two points whose real size you know.',
        'Tap any two points to read their length in cm or inches.',
      ],
      start: 'Start measuring',
    },
  },
  value: {
    id: 'value',
    title: 'Study & Simplify',
    navLabel: 'Study',
    description: 'Break down your reference into colors, values and clear shapes.',
    chips: ['Color study', 'Light & shadow', 'Sketch'],
    icon: Sun,
    intro: {
      steps: [
        'Add a photo of your reference.',
        'Choose a study: Color groups, Values or a Sketch.',
        'Adjust it until the shapes read clearly, then save it.',
      ],
      start: 'Start a study',
    },
  },
  color: {
    id: 'color',
    title: 'Color & Mixing',
    navLabel: 'Color',
    description: 'Explore color relationships and get practical paint mixing recipes.',
    chips: ['Color wheel', 'Harmonies', 'Mixing recipes'],
    icon: Palette,
    intro: {
      steps: [
        'Pick a color on the wheel, or sample one from your photo.',
        'See the harmonies that work with it.',
        'Get mixing recipes, including skin tones.',
      ],
      start: 'Explore colors',
    },
  },
  grid: {
    id: 'grid',
    title: 'Create a Grid',
    navLabel: 'Grid',
    description: 'Add a grid to your reference to transfer it accurately to canvas.',
    chips: ['3×3 · 4×4 · 8×8', 'Custom grid', 'Print / Save'],
    icon: Grid3X3,
    intro: {
      steps: [
        'Add the photo you want to transfer.',
        'Choose a grid (4×4 is a good start) and your canvas size.',
        'Save the gridded image and copy it square by square.',
      ],
      start: 'Make a grid',
    },
  },
  compare: {
    id: 'compare',
    title: 'Compare & Correct',
    navLabel: 'Compare',
    description: 'Overlay your painting with the reference to spot differences and fix them.',
    chips: ['Align images', 'Fade & compare', 'Create GIF'],
    icon: SquareSplitHorizontal,
    intro: {
      steps: [
        'Add a photo of your painting and of your reference.',
        'Align them: Smart Align needs just four taps.',
        'Fade, blink or show differences to spot what to fix, then save a GIF.',
      ],
      start: 'Start comparing',
    },
  },
};

/** Each tool's picture (Home cards, the landing page, first-visit introductions). The images are
 *  wide; `position` keeps each one's subject in view when a narrow frame crops it. */
export const TOOL_ART: Record<TabId, { src: string; alt: string; width: number; height: number; position: string }> = {
  measure: { src: '/images/home/home-measure.webp', alt: 'Portrait with proportion measurements', width: 586, height: 230, position: '100% 50%' },
  value: { src: '/images/home/home-study.webp', alt: 'The same portrait as photo, simplified shapes, values and sketch', width: 586, height: 211, position: '35% 50%' },
  color: { src: '/images/home/home-color.webp', alt: 'Paint palette, color wheel and mixed swatches', width: 586, height: 209, position: '62% 50%' },
  grid: { src: '/images/home/home-grid.webp', alt: 'Mountain landscape with a drawing grid', width: 586, height: 196, position: '50% 50%' },
  compare: { src: '/images/home/home-compare.webp', alt: 'Painted eye compared side by side with the reference photo', width: 586, height: 205, position: '50% 50%' },
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
