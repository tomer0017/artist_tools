import { writeFileSync, mkdirSync } from 'node:fs';
import AxeBuilder from '@axe-core/playwright';
import { test, expect, type Page } from '@playwright/test';

// Automated accessibility checks (axe-core 4.14) against WCAG 2.0 and 2.1,
// levels A and AA — the basis of the Israeli standard IS 5568 — on every
// page type: public pages in English and Hebrew, the studio's frame and each
// tool's first screen, the account page, and the admin dashboard.
//
// Automated checks find only part of the problems (roughly a third, by
// common estimates); a manual keyboard and screen-reader pass is still
// needed before any accessibility statement claims conformance.
//
// Simulated, not real devices: Desktop Chrome, and WebKit with iPhone 13
// emulation for the `mobile` test.

const WCAG = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];
const signedOut = { cookies: [], origins: [] };
const phone = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true };

interface Finding {
  page: string;
  rule: string;
  impact: string | null;
  help: string;
  nodes: string[];
  /** The elements themselves, and for contrast the colours and ratio found. */
  details: { html: string; data: unknown }[];
  /** A documented exception (KNOWN), reported but not failing the test. */
  known: string | null;
}

/** Known, documented exceptions (docs/accessibility/README.md): kept visible in the report, never silently. */
const KNOWN: { rule: string; paths: RegExp; why: string }[] = [
  {
    rule: 'meta-viewport',
    paths: /^\/app(\/|$)/,
    why: 'the studio limits page zoom: its canvas tools handle pinch themselves, and iOS would zoom into small inputs and stay zoomed',
  },
];

const findings: Finding[] = [];

async function scan(page: Page, path: string, ready: (page: Page) => Promise<void>) {
  await page.goto(path);
  await ready(page);
  const result = await new AxeBuilder({ page }).withTags(WCAG).analyze();
  const found = result.violations.map((v) => ({
    page: path,
    rule: v.id,
    impact: v.impact ?? null,
    help: v.help,
    nodes: v.nodes.slice(0, 5).map((n) => n.target.join(' ')),
    details: v.nodes.slice(0, 5).map((n) => ({ html: n.html.slice(0, 200), data: n.any[0]?.data ?? null })),
    known: KNOWN.find((k) => k.rule === v.id && k.paths.test(path))?.why ?? null,
  }));
  findings.push(...found);
  return found.filter((f) => !f.known);
}

const heading = (page: Page) => expect(page.locator('h1, h2').first()).toBeVisible();

test.afterAll(() => {
  mkdirSync('test-results', { recursive: true });
  writeFileSync(`test-results/a11y-${test.info().project.name}-${process.pid}.json`, JSON.stringify(findings, null, 2));
});

test.describe('public pages', () => {
  test.use({ storageState: signedOut });

  for (const path of ['/', '/he', '/pricing', '/he/pricing', '/sign-in', '/he/sign-in', '/sign-up', '/he/sign-up', '/forgot-password']) {
    test(`${path} has no automatically detectable WCAG A/AA problems`, async ({ page }) => {
      expect(await scan(page, path, heading)).toEqual([]);
    });
  }
});

test.describe('the studio', () => {
  for (const path of ['/app', '/app/plans', '/app/profile', '/app/measure', '/app/study', '/app/color', '/app/grid', '/app/compare']) {
    test(`${path} has no automatically detectable WCAG A/AA problems`, async ({ page }) => {
      expect(await scan(page, path, heading)).toEqual([]);
    });
  }
});

test.describe('the studio in Hebrew', () => {
  test.use({ locale: 'he-IL' });

  for (const path of ['/app', '/app/profile']) {
    test(`${path} (Hebrew) has no automatically detectable WCAG A/AA problems`, async ({ page }) => {
      expect(await scan(page, path, heading)).toEqual([]);
    });
  }
});

test.describe('admin', () => {
  test.use({ storageState: 'e2e/.auth/admin.json' });

  for (const path of ['/admin', '/admin/analytics', '/admin/plans', '/admin/pricing', '/admin/coupons', '/admin/billing', '/admin/activity', '/admin/security']) {
    test(`${path} has no automatically detectable WCAG A/AA problems`, async ({ page }) => {
      expect(await scan(page, path, heading)).toEqual([]);
    });
  }
});

test.describe('mobile', () => {
  test.use(phone);

  test('the studio and the account page on a phone have no automatically detectable WCAG A/AA problems', async ({ page }) => {
    for (const path of ['/app', '/app/profile', '/app/measure', '/app/compare']) {
      expect(await scan(page, path, heading), path).toEqual([]);
      await page.screenshot({ path: test.info().outputPath(`a11y${path.replace(/\//g, '-')}.png`) });
    }
  });
});
