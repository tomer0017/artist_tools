import { expect, test, type Page } from '@playwright/test';
import { photo } from './fixtures/photo';

// Study & Simplify's saves in real browsers. The study, the palette and the
// study sheet are made as data: URLs; turning one into a file used fetch(),
// which the site's Content-Security-Policy refuses (connect-src 'self'), so
// these saves silently did nothing from 2026-11-11 until M3. Each must open the
// save sheet and save its file.

async function upload(page: Page) {
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.getByRole('button', { name: 'Upload reference photo' }).first().click()]);
  await chooser.setFiles(photo);
}

async function saveFrom(page: Page, button: string) {
  await page.getByRole('button', { name: button, exact: true }).first().click();
  await expect(page.getByAltText('Image preview')).toBeVisible();
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Save Image' }).click()]);
  const chunks: Buffer[] = [];
  for await (const chunk of await download.createReadStream()) chunks.push(chunk as Buffer);
  return { name: download.suggestedFilename(), bytes: Buffer.concat(chunks) };
}

test.describe('Study & Simplify saves', () => {
  test('the study, the palette and the study sheet are saved (under the site’s security policy)', async ({ page }) => {
    const refused: string[] = [];
    page.on('console', (m) => {
      if (/Content Security Policy|Failed to prepare image/i.test(m.text())) refused.push(m.text().slice(0, 120));
    });
    await page.goto('/app/study');
    await upload(page);
    await page.getByRole('radio', { name: /Values/ }).click();
    await expect(page.getByRole('img', { name: 'Value study' }).first()).toBeVisible();

    const study = await saveFrom(page, 'Save processed image');
    expect(study.name).toBe('value-study.jpg');
    expect(study.bytes.subarray(0, 3)).toEqual(Buffer.from([0xff, 0xd8, 0xff]));
    for (const [button, name] of [['Save palette', 'value-palette.png'], ['Save study sheet', 'value-study-sheet.png']]) {
      const file = await saveFrom(page, button);
      expect(file.name).toBe(name);
      expect(file.bytes.subarray(1, 4).toString()).toBe('PNG');
    }
    expect(refused).toEqual([]);
  });

  test.describe('on a phone', () => {
    test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

    test('mobile: Save under the study opens the save sheet with the study', async ({ page }) => {
      await page.goto('/app/study');
      await upload(page);
      // The study is ready a moment after the photo (a Save before that does nothing, as always).
      await expect(async () => {
        await page.getByRole('button', { name: 'Save', exact: true }).click();
        await expect(page.getByAltText('Image preview')).toBeVisible({ timeout: 1000 });
      }).toPass({ timeout: 15_000 });
    });
  });
});
