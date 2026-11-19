import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page, type Request } from '@playwright/test';
import { photo } from './fixtures/photo';

// Learn's screens (ADR-0018, docs/learn/04 S1–S9; lessons, ADR-0019) on the main test server,
// whose synthetic content (src/test/learn-fixture.ts) is published while no
// plan includes a Learn module: admins open everything (drafts too), Free and
// Pro see no Learn at all. Locked items as Free sees them, with a plan that
// includes a module, are in e2e/entitlements.spec.ts. Each test that keeps a
// history or class mode signs in as an account of its own (tests run in
// parallel).

const WCAG = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];
const PROJECT_KEY = 'painter-studio-project';
const auth = (name: string) => `e2e/.auth/${name}.json`;

async function axe(page: Page, label: string, only?: string) {
  const builder = new AxeBuilder({ page }).withTags(WCAG);
  const results = await (only ? builder.include(only) : builder).analyze();
  // On iPhone the studio adds maximum-scale=1 on purpose (src/components/shell/StudioClient.tsx):
  // Safari still lets people pinch-zoom the page; it only stops zooming into small fields.
  const found = results.violations.filter((v) => !(v.id === 'meta-viewport' && test.info().project.name === 'iphone-webkit'));
  expect(found, `${label}: ${found.map((v) => `${v.id} (${v.nodes.map((n) => n.target.join(' ')).join(', ')})`).join('; ')}`).toEqual([]);
}

const stored = (page: Page, key = PROJECT_KEY) => page.evaluate((k) => JSON.parse(localStorage.getItem(k) ?? 'null'), key);

/** The bodies of the authorization requests a click sends. */
async function usageBodies(page: Page, act: () => Promise<void>, count = 1): Promise<Record<string, unknown>[]> {
  const seen: Request[] = [];
  const listener = (r: Request) => {
    if (r.url().endsWith('/api/usage') && r.method() === 'POST') seen.push(r);
  };
  page.on('request', listener);
  await act();
  await expect.poll(() => seen.length, { timeout: 15_000 }).toBeGreaterThanOrEqual(count);
  page.off('request', listener);
  return seen.map((r) => r.postDataJSON() as Record<string, unknown>);
}

test.describe('Learn as an admin: the screens, the card and the tools', () => {
  test.use({ storageState: auth('learner') });

  test('Home and the top bar lead to Learn; its home has the two choices and class mode', async ({ page }) => {
    await page.goto('/app');
    const section = page.locator('[data-home-learn]');
    await expect(section.getByRole('heading', { name: 'Learn to draw' })).toBeVisible();
    // The course's door leads straight to Lesson 1 (the optional baseline is not Lesson 1).
    await expect(section.locator('[data-home-action="course"]')).toHaveText('Start: Lesson 1 · Test exercise one');
    await expect(section.locator('[data-home-action="course"]')).toHaveAttribute('href', '/app/learn/exercises/D-TEST-01');
    await expect(section.getByRole('link', { name: 'All lessons' })).toHaveAttribute('href', '/app/learn/curriculum');
    await expect(section.getByRole('link', { name: /^Pick a challenge/ })).toHaveAttribute('href', '/app/learn/challenges');
    await page.getByRole('navigation', { name: 'Tools' }).getByRole('link', { name: 'Learn' }).click();
    await expect(page).toHaveURL(/\/app\/learn$/);
    await expect(page.getByRole('heading', { name: 'Learn to draw', level: 1 })).toBeVisible();
    await expect(page.getByRole('switch', { name: 'Class mode' })).toHaveAttribute('aria-checked', 'false');
    await expect(page.getByRole('link', { name: 'Start: Lesson 1 · Test exercise one' })).toBeVisible();
    await expect(page.locator('[data-course-where]')).toHaveText('Unit 1 of 2 · Basics');
    await expect(page.getByRole('link', { name: 'Optional first: Test baseline' })).toHaveAttribute('href', '/app/learn/exercises/D-BASE-01');
    // Class mode is for teachers: below the two doors.
    await expect(page.locator('[data-learn-teachers]').getByRole('heading', { name: 'For teaching a class' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Random' })).toBeEnabled();
    await expect(page.getByRole('link', { name: 'All challenges' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'My history' })).toBeVisible();
    await axe(page, 'Learn home');
    // An address in Learn that has no screen leads to the Learn home.
    await page.goto('/app/learn/settings');
    await expect(page).toHaveURL(/\/app\/learn$/);
  });

  test('the course lists units and numbered lessons (the baseline optional, drafts marked for admins); a lesson not yet written as one keeps its card', async ({ page }) => {
    await page.goto('/app/learn/curriculum');
    await expect(page.getByRole('heading', { name: 'Drawing course', level: 1 })).toBeVisible();
    await expect(page.locator('[data-learn-level="beginner"]')).toHaveText('Beginner');
    const basics = page.locator('[data-learn-group="basics"]');
    await expect(basics.getByRole('heading', { name: 'Unit 1 · Basics' })).toBeVisible();
    await expect(basics.getByText('First unit goal')).toBeVisible();
    await expect(basics.getByRole('link')).toHaveText([/Lesson 1\s*(Up next\s*)?Test exercise one/, /Lesson 2\s*Test exercise two/, /Lesson 3\s*Test exercise three\s*Draft · admins only/]);
    const shapes = page.locator('[data-learn-group="shapes"]');
    await expect(shapes.getByRole('heading', { name: 'Unit 2 · Shapes' })).toBeVisible();
    await expect(shapes.getByRole('link')).toHaveText([/Optional\s*Test baseline\s*A drawing to keep/, /Lesson 4\s*Test lesson one\s*Skill line one/]);
    // The baseline counts for nothing: this unit has one numbered lesson.
    await expect(shapes.locator('[data-unit-progress]')).toHaveText('0 of 1 done');
    // "Up next": the first numbered lesson not done (this account has done none).
    await expect(page.locator('[data-up-next]')).toHaveAttribute('data-learn-item', 'D-TEST-01');
    // Color is a module of its own, numbered on its own, with no "Up next".
    await expect(page.locator('[data-learn-group="paint"]').getByRole('link')).toHaveText([/Lesson 1\s*Test exercise four/]);
    await axe(page, 'course');

    await basics.getByRole('link', { name: /Test exercise one/ }).click();
    await expect(page).toHaveURL(/\/app\/learn\/exercises\/D-TEST-01$/);
    const card = page.locator('[data-learn-card="D-TEST-01"]');
    await expect(card.getByRole('heading', { name: 'Test exercise one', level: 1 })).toBeVisible();
    await expect(card.getByRole('img', { name: 'Test picture sky' })).toBeVisible();
    await expect(card.locator('[data-learn-instruction]')).toHaveText('Secret instruction D-TEST-01');
    await expect(card.getByText('Pencil and paper')).toBeVisible();
    await expect(card.getByText('Secret guide D-TEST-01')).toBeHidden();
    await card.getByText('More help').click();
    await expect(card.getByText('Secret guide D-TEST-01')).toBeVisible();
    await expect(card.getByText('Its fix')).toBeVisible();
    await axe(page, 'exercise card');

    await card.getByRole('button', { name: 'Open the reference full screen' }).click();
    const viewer = page.getByRole('dialog', { name: 'Reference' });
    await expect(viewer.getByRole('img', { name: 'Test picture sky' })).toBeVisible();
    await expect(viewer.getByRole('button', { name: 'Close' })).toBeFocused();
    await viewer.getByRole('button', { name: 'Zoom in' }).click();
    await expect(viewer.getByRole('img')).toHaveAttribute('style', /scale\(1\.5\)/);
    await axe(page, 'zoom viewer');
    await page.keyboard.press('Escape');
    await expect(viewer).toHaveCount(0);

    // An unknown exercise: not available (the server says 404).
    await page.goto('/app/learn/exercises/D-TEST-99');
    await expect(page.getByRole('heading', { name: 'This lesson or challenge is not available', level: 1 })).toBeVisible();
  });

  test('tool shortcuts hand the reference to each tool, asking before a photo is replaced; saves from it name the item', async ({ browser }) => {
    test.setTimeout(90_000);
    const context = await browser.newContext({ storageState: auth('learner-tools') });
    const page = await context.newPage();
    // A photo of the person's own already in Create a Grid.
    await page.goto('/app/grid');
    const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.getByRole('button', { name: 'Upload reference photo' }).first().click()]);
    await chooser.setFiles(photo);
    await expect.poll(() => stored(page).then((p) => p?.gridImage ?? null)).toMatch(/^data:image\//);

    await page.goto('/app/learn/exercises/D-TEST-01');
    const tools = page.getByRole('region', { name: 'Tools that help' }).or(page.locator('section[aria-labelledby="learn-tools-title"]'));
    await expect(tools.getByRole('button')).toHaveText(['Open in Create a Grid', 'Open in Study & Simplify', 'Open in Compare & Correct', 'Open in Measure & Plan']);
    // Replacing the person's photo is asked first; Cancel keeps it.
    await tools.getByRole('button', { name: 'Open in Create a Grid' }).click();
    const ask = page.getByRole('alertdialog', { name: 'Replace the photo in Create a Grid?' });
    await expect(ask).toBeVisible();
    await axe(page, 'replace dialog');
    await ask.getByRole('button', { name: 'Cancel' }).click();
    await expect(page).toHaveURL(/\/exercises\/D-TEST-01$/);
    expect((await stored(page)).gridImageLearnItem ?? null).toBeNull();
    await tools.getByRole('button', { name: 'Open in Create a Grid' }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Replace' }).click();
    await expect(page).toHaveURL(/\/app\/grid$/);
    await expect.poll(() => stored(page).then((p) => p?.gridImageLearnItem ?? null)).toBe('D-TEST-01');
    expect((await stored(page)).gridImage).toMatch(/^data:image\/png;base64,/);
    // A grid saved from it names the item; a blank grid (no picture) does not.
    const [withItem] = await usageBodies(page, () => page.getByRole('button', { name: 'Save grid image' }).first().click());
    expect(withItem).toMatchObject({ tool: 'tool.grid', features: ['export.image'], learnItem: 'D-TEST-01' });
    await expect(page.getByAltText('Image preview')).toBeVisible();
    await page.getByRole('button', { name: 'Close', exact: true }).last().click();

    // Study & Simplify: the reference for this visit; the shared photo is not replaced (no question).
    await page.goBack();
    await expect(page).toHaveURL(/\/exercises\/D-TEST-01$/);
    await tools.getByRole('button', { name: 'Open in Study & Simplify' }).click();
    await expect(page).toHaveURL(/\/app\/study$/);
    await page.getByRole('radio', { name: /Values/ }).click();
    await expect(page.getByRole('img', { name: 'Value study' }).first()).toBeVisible();
    const [studySave] = await usageBodies(page, () => page.getByRole('button', { name: 'Save processed image' }).click());
    expect(studySave).toMatchObject({ tool: 'tool.study', features: ['export.image'], learnItem: 'D-TEST-01' });
    await expect(page.getByAltText('Image preview')).toBeVisible();
    await page.getByRole('button', { name: 'Close', exact: true }).last().click();

    // Compare & Correct: the reference, waiting for a photo of the drawing.
    await page.goto('/app/learn/exercises/D-TEST-01');
    await tools.getByRole('button', { name: 'Open in Compare & Correct' }).click();
    await expect(page).toHaveURL(/\/app\/compare$/);
    await expect(page.getByRole('img', { name: 'Reference thumbnail' })).toBeVisible();
    await expect.poll(() => stored(page, 'compare-art-session').then((s) => s?.referenceLearnItem ?? null)).toBe('D-TEST-01');

    // Measure & Plan had no photo: no question.
    await page.goto('/app/learn/exercises/D-TEST-01');
    await tools.getByRole('button', { name: 'Open in Measure & Plan' }).click();
    await expect(page).toHaveURL(/\/app\/measure$/);
    await expect.poll(() => stored(page).then((p) => p?.imageLearnItem ?? null)).toBe('D-TEST-01');

    // A photo of the person's own replaces the reference, and its saves name no item.
    await page.goto('/app/grid');
    const [again] = await Promise.all([page.waitForEvent('filechooser'), page.getByRole('button', { name: /Replace|Upload/ }).first().click()]);
    await again.setFiles(photo);
    await expect.poll(() => stored(page).then((p) => p?.gridImageLearnItem ?? null)).toBeNull();
    await context.close();
  });

  test('worksheets from a challenge are made from its reference, the server asked for that item', async ({ browser }) => {
    test.setTimeout(90_000);
    const context = await browser.newContext({ storageState: auth('learner-sheets') });
    const page = await context.newPage();
    await page.goto('/app/learn/challenges/CH-901');
    const card = page.locator('[data-learn-card="CH-901"]');
    await expect(card.locator('[data-learn-instruction]')).toHaveText('Secret prompt CH-901');
    await card.getByRole('button', { name: 'Prepare worksheets' }).click();
    const sheet = page.getByRole('dialog', { name: 'Prepare worksheets' });
    await expect(sheet.getByText('Practice sheets from the reference.')).toBeVisible();
    const bodies = await usageBodies(page, () => sheet.getByRole('button', { name: /^Make sheets/ }).click(), 2);
    expect(bodies).toEqual([
      { tool: 'tool.study', features: [], learnItem: 'CH-901' },
      { tool: 'tool.grid', features: ['export.worksheets', 'export.image'], learnItem: 'CH-901' },
    ]);
    await expect(sheet.getByText(/^Sheets ready: \d$/)).toBeVisible({ timeout: 30_000 });
    // No class mode: no "Next student".
    await expect(sheet.getByRole('button', { name: 'Next student' })).toHaveCount(0);
    await sheet.getByRole('button', { name: 'Close' }).first().click();

    // A challenge drawn from one's own photo: "Use my photo" makes sheets from it, naming no item.
    await page.goto('/app/learn/challenges/CH-902');
    await expect(page.getByText('Your photo stays on this device.')).toBeVisible();
    const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.getByRole('button', { name: 'Use my photo' }).click()]);
    await chooser.setFiles(photo);
    const own = page.getByRole('dialog', { name: 'Prepare worksheets' });
    await expect(own.getByText('Practice sheets from your photo.')).toBeVisible();
    const ownBodies = await usageBodies(page, () => own.getByRole('button', { name: /^Make sheets/ }).click(), 2);
    for (const body of ownBodies) expect(body).not.toHaveProperty('learnItem');
    await context.close();
  });

  test('challenges: filters remembered on this device; Random and Quick pick only matching challenges; "Another one" never the same', async ({ page }) => {
    await page.goto('/app/learn/challenges');
    const cards = page.locator('[data-learn-item]');
    await expect(cards).toHaveCount(3);
    await expect(page.getByText('3 challenges')).toBeVisible();
    await axe(page, 'challenges');
    await page.getByLabel('Level').selectOption('intermediate');
    await expect(cards).toHaveCount(1);
    await expect(cards.first()).toHaveAttribute('data-learn-item', 'CH-902');
    await page.reload();
    await expect(page.getByLabel('Level')).toHaveValue('intermediate');
    await expect(cards).toHaveCount(1);
    // Quick with these filters: none is quick.
    await page.getByRole('button', { name: 'Quick', exact: true }).click();
    await expect(page.getByRole('status').filter({ hasText: /No challenge matches|None of these/ })).toBeVisible();
    await page.getByRole('button', { name: 'Random' }).click();
    await expect(page).toHaveURL(/\/challenges\/CH-902\?pick=filters$/);
    // The only one matching: "Another one" has nothing else to offer.
    await expect(page.getByRole('button', { name: 'Another one' })).toBeDisabled();

    await page.goto('/app/learn/challenges');
    await page.getByRole('button', { name: 'Clear filters' }).click();
    await page.getByRole('button', { name: 'Quick only' }).click();
    await expect(page.getByRole('button', { name: 'Quick only' })).toHaveAttribute('aria-pressed', 'true');
    await expect(cards).toHaveCount(2);
    await page.getByRole('button', { name: 'Clear filters' }).click();
    for (let i = 0; i < 3; i++) {
      await page.goto('/app/learn/challenges');
      await page.getByRole('button', { name: 'Quick', exact: true }).click();
      await expect(page).toHaveURL(/\/challenges\/CH-90[13]\?pick=filters-quick$/);
    }
    // "Another one" from a quick pick: the other quick challenge, never the same.
    const here = page.url().match(/CH-90\d/)![0];
    await page.getByRole('button', { name: 'Another one' }).click();
    await expect(page).not.toHaveURL(new RegExp(`${here}\\?`));
    await expect(page).toHaveURL(/\/challenges\/CH-90[13]\?pick=filters-quick$/);
  });
});

test('history: Mark as completed, Undo, once a day; the history lists it, removes it, and is in the data download', async ({ browser }) => {
  const context = await browser.newContext({ storageState: auth('learner-history') });
  const page = await context.newPage();
  await page.goto('/app/learn/exercises/D-TEST-02');
  const mark = page.getByRole('button', { name: 'Mark as completed' });
  await mark.click();
  await expect(page.getByText('Marked as completed.')).toBeVisible();
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(page.getByText('Removed from your history.')).toBeVisible();
  await expect(mark).toBeEnabled();
  await mark.click();
  await expect(page.getByRole('button', { name: 'Completed today' })).toBeDisabled();
  await expect(page.locator('[data-done-count]')).toHaveText('Completed once');
  // It is kept: after a reload, and in the course's list.
  await page.reload();
  await expect(page.getByRole('button', { name: 'Completed today' })).toBeDisabled();
  await page.goto('/app/learn/curriculum');
  await expect(page.locator('[data-learn-item="D-TEST-02"] [data-done-count]')).toHaveText('Completed once');
  // "Continue" now offers the first exercise not yet completed.
  await page.goto('/app/learn');
  await expect(page.getByRole('link', { name: 'Continue: Lesson 1 · Test exercise one' })).toBeVisible();

  // The data download has it.
  const download = await page.request.post('/api/me/export');
  expect(download.status()).toBe(200);
  const data = await download.json();
  expect(data.learnCompletions).toEqual([{ item: 'D-TEST-02', completedAt: expect.any(String), contentVersion: 1 }]);

  await page.goto('/app/learn/history');
  await expect(page.getByRole('heading', { name: 'My history', level: 1 })).toBeVisible();
  await expect(page.getByText('1 completion', { exact: true })).toBeVisible();
  const entry = page.locator('[data-history-entry="D-TEST-02"]');
  await expect(entry.getByRole('link', { name: 'Test exercise two' })).toHaveAttribute('href', '/app/learn/exercises/D-TEST-02');
  await axe(page, 'history');
  await entry.getByRole('button', { name: /^Remove “Test exercise two” of / }).click();
  await expect(page.getByText('Removed from your history.')).toBeVisible();
  await expect(page.locator('[data-history-empty]')).toBeVisible();
  expect((await (await page.request.get('/api/learn/completions')).json()).summary).toEqual({ items: {}, total: 0 });
  await context.close();
});

test.describe('lessons (ADR-0019): the teaching on the page, the baseline optional, tools set as the step needs them', () => {
  test.use({ storageState: auth('learner') });

  test('a lesson: objective, See it, Do it, Check it, the mistake, Done when and Why it works, all on the page; only credits could fold', async ({ page }) => {
    const writes: string[] = [];
    page.on('request', (r) => {
      if (r.method() !== 'GET' && r.url().includes('/api/')) writes.push(`${r.method()} ${r.url()}`);
    });
    await page.goto('/app/learn/exercises/D-LESSON-01');
    const lesson = page.locator('[data-learn-lesson]');
    await expect(lesson.locator('[data-lesson-place]')).toHaveText('Unit 2 · Lesson 4 of 4');
    await expect(lesson.getByRole('heading', { name: 'Test lesson one', level: 1 })).toBeVisible();
    await expect(lesson.locator('[data-learn-objective]')).toHaveText('Secret objective D-LESSON-01');
    await expect(lesson.getByText('About 20 min')).toBeVisible();
    // See it: a picture at a time, with its caption; the buttons move between them.
    const demo = lesson.locator('[data-learn-demo]');
    await expect(demo.getByRole('heading', { name: 'See it' })).toBeVisible();
    await expect(demo.locator('[data-demo-position]')).toHaveText('Picture 1 of 2');
    await expect(demo.locator('[data-demo-frame="1"] [data-demo-caption]')).toHaveText('Secret caption one D-LESSON-01');
    await demo.locator('[data-demo-next]').click();
    await expect(demo.locator('[data-demo-position]')).toHaveText('Picture 2 of 2');
    await expect(demo.locator('[data-demo-next]')).toBeDisabled();
    await demo.locator('[data-demo-zoom]').click();
    const viewer = page.getByRole('dialog', { name: 'Picture' });
    await expect(viewer.getByRole('img', { name: 'Diagram B' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(viewer).toHaveCount(0);
    // Do it: every step on the page; the subject in step 1, tools in steps 2 and 3, the worksheet in step 4.
    await expect(lesson.locator('[data-lesson-step]')).toHaveCount(4);
    await expect(lesson.locator('[data-lesson-step="1"]')).toContainText('Secret step one D-LESSON-01');
    await expect(lesson.locator('[data-lesson-step="1"] [data-step-picture]')).toBeVisible();
    await expect(lesson.locator('[data-lesson-step="2"] [data-step-tool="value"]')).toHaveText(/See three values/);
    await expect(lesson.locator('[data-lesson-step="3"] [data-step-tool="grid"]')).toHaveText(/A 3 × 3 grid/);
    await expect(lesson.locator('[data-lesson-step="4"]').getByRole('button', { name: 'Prepare worksheets' })).toBeVisible();
    // Check it: ticked for oneself, never saved (nothing is sent; a reload clears it).
    const check = lesson.locator('[data-lesson-check="1"]');
    await check.check();
    await expect(check).toBeChecked();
    await expect(lesson.locator('[data-lesson-checks]')).toContainText('Secret check two D-LESSON-01');
    // The mistake, Done when, Why it works: on the page, nothing folded.
    await expect(lesson.locator('[data-lesson-mistake]')).toContainText('A mistake');
    await expect(lesson.locator('[data-lesson-mistake]')).toContainText('Its fix');
    await expect(lesson.locator('[data-lesson-mistake]').getByRole('img', { name: 'Before and after' })).toBeVisible();
    await expect(lesson.locator('[data-lesson-done]')).toContainText('It looks right');
    await expect(lesson.locator('[data-lesson-done]').getByRole('button', { name: 'Mark as completed' })).toBeVisible();
    await expect(lesson.locator('[data-lesson-why]')).toBeVisible();
    await expect(lesson.locator('[data-lesson-why]')).toContainText('Secret why D-LESSON-01');
    await expect(lesson.locator('[data-more-help]')).toHaveCount(0);
    await expect(lesson.locator('details:not([data-learn-credits])')).toHaveCount(0);
    // The last lesson: Previous only. Practise it: the challenges that build on it. Tools that help: quick access.
    await expect(lesson.locator('[data-lesson-next]')).toHaveCount(0);
    await expect(lesson.locator('[data-lesson-previous]')).toHaveAttribute('href', '/app/learn/exercises/D-TEST-03');
    await expect(lesson.locator('[data-practise="CH-901"]')).toHaveAttribute('href', '/app/learn/challenges/CH-901');
    await expect(lesson.locator('[data-learn-tools] [data-open-in]')).toHaveCount(3);
    await axe(page, 'lesson');
    expect(writes).toEqual([]);
    await page.reload();
    await expect(page.locator('[data-lesson-check="1"]')).not.toBeChecked();
  });

  test('a step’s tool link opens the tool set as the step needs it, with the lesson’s subject and the way back', async ({ page }) => {
    await page.goto('/app/learn/exercises/D-LESSON-01');
    await page.locator('[data-step-tool="value"]').click();
    await expect(page).toHaveURL(/\/app\/study$/);
    const back = page.locator('[data-learn-return]');
    await expect(back.getByRole('link')).toHaveText('Back to Lesson 4 · Test lesson one');
    await expect.poll(() => stored(page).then((p) => p?.valueSettings?.levels ?? null)).toBe(3);
    expect((await stored(page)).valueSettings.mode).toBe('grayscale');
    // The way back only: the tools' own pages are outside this milestone.
    await axe(page, 'the way back from a tool', '[data-learn-return]');
    await back.getByRole('link').click();
    await expect(page).toHaveURL(/\/exercises\/D-LESSON-01$/);
    await expect(page.locator('[data-learn-return]')).toHaveCount(0);

    await page.locator('[data-step-tool="grid"]').click();
    await expect(page).toHaveURL(/\/app\/grid$/);
    await expect.poll(() => stored(page).then((p) => p?.gridSettings?.columns ?? null)).toBe(3);
    expect((await stored(page)).gridSettings.rows).toBe(3);
    await expect.poll(() => stored(page).then((p) => p?.gridImageLearnItem ?? null)).toBe('D-LESSON-01');
    // Dismissed, it stays gone; leaving the tools ends it anyway.
    await page.locator('[data-learn-return]').getByRole('button', { name: 'Hide this' }).click();
    await expect(page.locator('[data-learn-return]')).toHaveCount(0);
  });

  test('challenges: the Skill filter is the course’s units; a challenge says what it builds on; life and own-photo challenges say so instead of an empty picture', async ({ page }) => {
    await page.goto('/app/learn/challenges');
    const cards = page.locator('[data-learn-item]');
    await expect(cards).toHaveCount(3);
    const skill = page.getByLabel('Skill');
    await expect(skill.locator('option')).toHaveText(['All skills', 'Unit 1 · Basics', 'Unit 2 · Shapes']);
    await skill.selectOption('shapes');
    await expect(cards).toHaveCount(1);
    await expect(cards.first()).toHaveAttribute('data-learn-item', 'CH-901');
    await page.getByRole('button', { name: 'Random' }).click();
    await expect(page).toHaveURL(/\/challenges\/CH-901\?pick=filters$/);
    await page.goto('/app/learn/challenges');
    await page.getByRole('button', { name: 'Clear filters' }).click();
    await expect(page.locator('[data-learn-item="CH-902"] [data-challenge-subject="own_photo"]')).toHaveText('From your photo');
    await expect(page.locator('[data-learn-item="CH-903"] [data-challenge-subject="life"]')).toHaveText('From life');

    await page.goto('/app/learn/challenges/CH-901');
    const card = page.locator('[data-learn-card="CH-901"]');
    await expect(card.locator('[data-learn-focus]')).toHaveText('Focus: Secret focus CH-901');
    await expect(card.locator('[data-builds-on="D-LESSON-01"]')).toHaveText('Lesson 4 · Test lesson one');
    await expect(card.locator('[data-builds-on="D-LESSON-01"]')).toHaveAttribute('href', '/app/learn/exercises/D-LESSON-01');
    await axe(page, 'challenge with what it builds on');
  });
});

test('the optional baseline: not numbered, never counted as starting the course; its Next is Lesson 1', async ({ browser }) => {
  const context = await browser.newContext({ storageState: auth('learner-lesson') });
  const page = await context.newPage();
  await page.goto('/app/learn');
  await page.getByRole('link', { name: 'Optional first: Test baseline' }).click();
  await expect(page).toHaveURL(/\/exercises\/D-BASE-01$/);
  await expect(page.locator('[data-lesson-place]')).toHaveText('Optional · a baseline drawing');
  await expect(page.locator('[data-lesson-next]')).toHaveText(/Next: Lesson 1/);
  await expect(page.locator('[data-lesson-next]')).toHaveAttribute('href', '/app/learn/exercises/D-TEST-01');
  await page.getByRole('button', { name: 'Mark as completed' }).click();
  await expect(page.getByText('Marked as completed.')).toBeVisible();
  // Done today: "Next" leads.
  await expect(page.locator('[data-lesson-next]')).toHaveClass(/bg-primary/);
  // The course has not started: still Lesson 1, and the baseline is no longer offered first.
  await page.goto('/app/learn');
  await expect(page.getByRole('link', { name: 'Start: Lesson 1 · Test exercise one' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Optional first: Test baseline' })).toHaveCount(0);
  await context.close();
});

test('a lesson in Hebrew: right to left, every part in Hebrew, accessible', async ({ browser }) => {
  const context = await browser.newContext({ storageState: auth('learner-he'), locale: 'he-IL' });
  await context.addCookies([{ name: 'sc_locale', value: 'he', domain: 'localhost', path: '/' }]);
  const page = await context.newPage();
  await page.goto('/app/learn/exercises/D-LESSON-01');
  await expect(page.locator('[data-lesson-place]')).toHaveText('יחידה 2 · שיעור 4 מתוך 4');
  await expect(page.getByRole('heading', { name: 'שיעור בדיקה one', level: 1 })).toBeVisible();
  expect(await page.getByRole('heading', { level: 1 }).evaluate((el) => getComputedStyle(el).direction)).toBe('rtl');
  await expect(page.locator('[data-learn-demo]').getByRole('heading', { name: 'רואים איך' })).toBeVisible();
  await expect(page.locator('[data-lesson-step="1"]')).toContainText('שלב סודי א D-LESSON-01');
  await expect(page.locator('[data-lesson-checks]')).toContainText('רק בשבילך: שום דבר לא נשמר.');
  await axe(page, 'lesson (he)');
  await context.close();
});

test('class mode: five students in a row get their sheets, and nothing about the history is ever asked or written', async ({ browser }) => {
  test.setTimeout(150_000);
  const context = await browser.newContext({ storageState: auth('teacher') });
  const page = await context.newPage();
  const history: string[] = [];
  page.on('request', (r) => {
    if (r.url().includes('/api/learn/completions')) history.push(`${r.method()} ${r.url()}`);
  });
  await page.goto('/app/learn');
  await page.getByRole('switch', { name: 'Class mode' }).click();
  await expect(page.getByRole('switch', { name: 'Class mode' })).toHaveAttribute('aria-checked', 'true');
  history.length = 0;
  await expect(page.getByRole('link', { name: 'My history' })).toHaveCount(0);

  for (let student = 1; student <= 5; student++) {
    await page.goto('/app/learn/challenges');
    await expect(page.locator('[data-class-mode-banner]')).toContainText('Class mode is on');
    await page.locator('[data-learn-item="CH-901"]').click();
    const card = page.locator('[data-learn-card="CH-901"]');
    await expect(card.locator('[data-learn-instruction]')).toHaveText('Secret prompt CH-901');
    await expect(card.getByRole('button', { name: /Mark as completed|Completed today/ })).toHaveCount(0);
    await card.getByRole('button', { name: 'Prepare worksheets' }).click();
    const sheet = page.getByRole('dialog', { name: 'Prepare worksheets' });
    if (student === 1) {
      // The first student's choice of sheets is kept for the next ones: the original only.
      for (const name of ['Outline', 'Reference with grid', 'Values']) {
        const box = sheet.getByRole('checkbox', { name: new RegExp(`^${name}`) });
        if (await box.isChecked()) await box.uncheck();
      }
      await sheet.getByRole('checkbox', { name: /^Original/ }).check();
    }
    await sheet.getByRole('button', { name: 'Make sheets (1)' }).click();
    await expect(sheet.getByText('Sheets ready: 1')).toBeVisible({ timeout: 30_000 });
    if (student === 1) await axe(page, 'worksheets in class mode');
    await sheet.getByRole('button', { name: 'Next student' }).click();
    await expect(page).toHaveURL(/\/app\/learn\/challenges$/);
    await expect(sheet).toHaveCount(0);
  }
  await page.goto('/app/learn/history');
  await expect(page.getByText('Class mode is on, so your history is not shown here.')).toBeVisible();
  // Still on after a reload (this tab), and nothing about the history was requested.
  await page.reload();
  await expect(page.locator('[data-class-mode-banner]')).toBeVisible();
  expect(history).toEqual([]);

  // Turned off: the history is back.
  await page.locator('[data-class-mode-banner]').getByRole('button', { name: 'Turn off' }).click();
  await expect(page.getByRole('heading', { name: 'My history', level: 1 })).toBeVisible();
  await expect.poll(() => history.length).toBeGreaterThan(0);
  await context.close();
});

test('in Hebrew: right to left, every screen in Hebrew, accessible', async ({ browser }) => {
  const context = await browser.newContext({ storageState: auth('learner-he'), locale: 'he-IL' });
  await context.addCookies([{ name: 'sc_locale', value: 'he', domain: 'localhost', path: '/' }]);
  const page = await context.newPage();
  await page.goto('/app');
  await expect(page.locator('[data-home-learn]').getByRole('heading', { name: 'ללמוד לרשום' })).toBeVisible();
  await page.goto('/app/learn');
  await expect(page.getByRole('heading', { name: 'ללמוד לרשום', level: 1 })).toBeVisible();
  expect(await page.getByRole('heading', { level: 1 }).evaluate((el) => getComputedStyle(el).direction)).toBe('rtl');
  await expect(page.getByRole('switch', { name: 'מצב כיתה' })).toBeVisible();
  await axe(page, 'Learn home (he)');
  await page.goto('/app/learn/curriculum');
  await expect(page.getByRole('heading', { name: 'קורס רישום', level: 1 })).toBeVisible();
  await axe(page, 'course (he)');
  await page.goto('/app/learn/exercises/D-TEST-01');
  await expect(page.locator('[data-learn-instruction]')).toHaveText('הוראה סודית D-TEST-01');
  await expect(page.getByRole('button', { name: 'לפתוח ב־יצירת רשת' })).toBeVisible();
  await page.getByText('עוד עזרה').click();
  await axe(page, 'exercise card (he)');
  await page.goto('/app/learn/challenges');
  await expect(page.getByText('3 אתגרים')).toBeVisible();
  await axe(page, 'challenges (he)');
  await page.goto('/app/learn/history');
  await expect(page.getByRole('heading', { name: 'ההיסטוריה שלי', level: 1 })).toBeVisible();
  await axe(page, 'history (he)');
  await context.close();
});

test.describe('on a phone', () => {
  test.use({ storageState: auth('learner-mobile'), viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  test('mobile: Learn is reached from Home; a card fits, and its actions are on screen without scrolling past the picture', async ({ page }) => {
    await page.goto('/app');
    // The bottom bar keeps its six items; Learn is on Home.
    await expect(page.getByRole('navigation', { name: 'Tools' }).getByRole('link')).toHaveCount(6);
    await page.locator('[data-home-learn]').getByRole('link', { name: /^Pick a challenge/ }).click();
    await expect(page).toHaveURL(/\/app\/learn\/challenges$/);
    await page.locator('[data-learn-item="CH-901"]').click();
    const card = page.locator('[data-learn-card="CH-901"]');
    await expect(card.getByRole('img', { name: 'Test picture wing' })).toBeVisible();
    await expect(card.getByRole('button', { name: 'Prepare worksheets' })).toBeInViewport();
    const overflow = await page.locator('[data-learn-screen]').evaluate((el) => el.scrollWidth - el.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    await axe(page, 'card on a phone');
    await page.goto('/app/learn/challenges');
    expect(await page.locator('[data-learn-screen]').evaluate((el) => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(0);
    await axe(page, 'challenges on a phone');
    // The Learn home and a lesson fit the phone's width too; the lesson's demonstration is on its first screen.
    await page.goto('/app/learn');
    await expect(page.locator('[data-course-action]')).toBeVisible();
    expect(await page.locator('[data-learn-screen]').evaluate((el) => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(0);
    await page.goto('/app/learn/exercises/D-LESSON-01');
    await expect(page.locator('[data-learn-demo] [data-demo-frame="1"] img')).toBeInViewport({ ratio: 0.5 });
    expect(await page.locator('[data-learn-screen]').evaluate((el) => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(0);
    await axe(page, 'lesson on a phone');
  });
});

test.describe('Learn stays invisible to Free and Pro while no plan offers it', () => {
  for (const who of ['user', 'pro']) {
    test(`${who === 'user' ? 'Free' : 'Pro'}: no Learn on Home or in the top bar; its addresses lead Home; its history API keeps nothing`, async ({ browser }) => {
      const context = await browser.newContext({ storageState: auth(who) });
      const page = await context.newPage();
      await page.goto('/app');
      await expect(page.getByRole('heading', { name: 'What do you want to work on?' })).toBeVisible();
      await expect(page.locator('[data-home-learn]')).toHaveCount(0);
      await expect(page.locator('[data-nav-learn]')).toHaveCount(0);
      for (const path of ['/app/learn', '/app/learn/challenges/CH-901', '/app/learn/exercises/D-TEST-01', '/app/learn/history', '/app/learn/anything']) {
        await page.goto(path);
        await expect(page, path).toHaveURL(/\/app$/);
      }
      // No Learn content anywhere in the page (its interface words come with every page, like all of the studio's).
      expect(await page.content()).not.toContain('Secret');

      const record = await page.request.post('/api/learn/completions', { data: { itemId: 'CH-901' } });
      expect(record.status()).toBe(403);
      expect(await record.json()).toEqual({ error: 'locked', reason: 'module_off' });
      expect((await page.request.post('/api/learn/completions', { data: { itemId: 'CH-903' } })).status()).toBe(404);
      expect((await page.request.post('/api/learn/completions', { data: { itemId: 'not an item' } })).status()).toBe(400);
      expect((await page.request.post('/api/learn/completions', { data: { itemId: 'CH-901', userId: 'someone else' } })).status()).toBe(400);
      expect((await page.request.post('/api/learn/completions', { data: { itemId: 'CH-901' }, headers: { origin: 'https://elsewhere.example' } })).status()).toBe(403);
      expect((await page.request.delete('/api/learn/completions/0123456789abcdef01234567')).status()).toBe(404);
      expect((await page.request.delete('/api/learn/completions/not-an-id')).status()).toBe(404);
      expect((await page.request.get('/api/learn/completions?after=bad')).status()).toBe(400);
      const mine = await (await page.request.get('/api/learn/completions')).json();
      expect(mine).toEqual({ summary: { items: {}, total: 0 }, completions: [], next: null, titles: {} });
      await context.close();
    });
  }

  test('signed out: the history API answers 401, and Learn’s pages lead to sign-in', async ({ browser }) => {
    const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    const page = await context.newPage();
    expect((await page.request.get('/api/learn/completions')).status()).toBe(401);
    expect((await page.request.post('/api/learn/completions', { data: { itemId: 'CH-901' } })).status()).toBe(401);
    expect((await page.request.delete('/api/learn/completions/0123456789abcdef01234567')).status()).toBe(401);
    await page.goto('/app/learn/challenges/CH-901');
    await expect(page).toHaveURL(/\/sign-in/);
    await context.close();
  });
});
