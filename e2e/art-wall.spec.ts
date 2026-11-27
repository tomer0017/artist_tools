import { expect, test, type Page } from '@playwright/test';

// Art on Your Wall, end to end, as an admin (who has every option): add an
// artwork, crop it, frame it, hang it in a room with a picture light, compare
// two frames, save the image, then place it on a photo of a wall.

const ARTWORK = 'public/images/home/home-hero.webp';
const ROOM_PHOTO = 'public/images/home/home-color.webp';

async function upload(page: Page, trigger: () => Promise<void>, file: string) {
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), trigger()]);
  await chooser.setFiles(file);
}

async function shot(page: Page, name: string) {
  await page.screenshot({ path: test.info().outputPath(`${name}.png`) });
}

test.describe('Art on Your Wall', () => {
  test.use({ storageState: 'e2e/.auth/admin.json', locale: 'en-US' });

  test('frame an artwork, hang it in a room and on a photo, compare frames and save the image (desktop and mobile)', async ({ page }) => {
    // A long journey through every step, with full renders: more than the default 30 s.
    test.setTimeout(240_000);
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto('/app/wall');
    // The first visit introduces the tool (once per account): start from it if it is there.
    const intro = page.getByRole('button', { name: 'Start framing' });
    const heading = page.getByRole('heading', { name: 'Art on Your Wall', level: 1 });
    await expect(intro.or(heading)).toBeVisible({ timeout: 20_000 });
    if (await intro.isVisible()) await intro.click();
    await expect(heading).toBeVisible();

    // 1. Artwork: upload, a square crop, its real size.
    await upload(page, () => page.getByText('Drop an image here or click to upload').click(), ARTWORK);
    await page.getByRole('button', { name: 'Edit crop', exact: true }).click();
    await expect(page.getByRole('group', { name: 'Crop area' })).toBeVisible({ timeout: 20_000 });
    await page.getByRole('group', { name: 'Crop shape' }).getByRole('button', { name: 'Square' }).click();
    await expect(page.getByRole('group', { name: 'Crop shape' }).getByRole('button', { name: 'Square' })).toHaveAttribute('aria-pressed', 'true');
    await page.getByLabel('Width').fill('60');
    await expect(page.getByLabel('Height')).toHaveValue('60');
    // Leave the field; on a phone the bottom bar then comes back: let the layout settle before tapping on.
    await page.getByLabel('Width').blur();
    await expect(page.getByRole('navigation', { name: 'Tools' }).first()).toBeVisible();
    await shot(page, '1-crop');

    // 2. Frame: floating, light gold.
    await page.getByRole('tab', { name: 'Frame', exact: true }).click();
    await page.getByRole('group', { name: 'Frame' }).getByRole('button', { name: 'Floating', exact: true }).click();
    await page.getByRole('radio', { name: 'Light gold' }).click();
    await expect(page.getByText(/^Framed size: /)).toBeVisible();
    await shot(page, '2-frame');

    // 3. Space: the classic salon, with a picture light.
    await page.getByRole('tab', { name: 'Room / Wall', exact: true }).click();
    await page.getByRole('group', { name: 'Where it hangs' }).getByRole('button', { name: 'Room', exact: true }).click();
    await page.getByRole('group', { name: 'Room' }).getByRole('button', { name: 'Classic salon' }).click();
    await page.getByRole('tab', { name: 'Lighting', exact: true }).click();
    await page.getByRole('switch', { name: 'Picture light' }).click();
    await expect(page.getByRole('switch', { name: 'Picture light' })).toHaveAttribute('aria-checked', 'true');
    const stage = page.locator('.wall-editor-preview');
    const before = await stage.boundingBox();
    await page.locator('#wall-settings').evaluate(el => { el.scrollTop = el.scrollHeight; });
    expect(await stage.boundingBox()).toEqual(before);
    await shot(page, '3-room');

    // 4. Compare two frames, then save.
    await page.getByRole('tab', { name: 'Export', exact: true }).click();
    await page.getByRole('button', { name: 'Add this frame' }).click();
    await page.getByRole('tab', { name: 'Frame', exact: true }).click();
    await page.getByRole('group', { name: 'Frame' }).getByRole('button', { name: 'Classic', exact: true }).click();
    await page.getByRole('radio', { name: 'Dark brown wood' }).click();
    await page.getByRole('tab', { name: 'Room / Wall', exact: true }).click();
    await page.getByRole('tab', { name: 'Export', exact: true }).click();
    await page.getByRole('button', { name: 'Add this frame' }).click();
    await page.getByRole('button', { name: 'Show side by side' }).click();
    await expect(page.getByRole('button', { name: /Frame 2$/ })).toBeVisible();
    await shot(page, '4-compare');
    await page.getByRole('button', { name: 'Save the comparison' }).click();
    await expect(page.getByText('Your artwork on the wall').first()).toBeVisible({ timeout: 30_000 });
    await shot(page, '5-saved');
    await page.getByRole('button', { name: 'Close', exact: true }).first().click();

    // 5. My room: a photo of a wall, the piece placed and given perspective.
    await page.getByRole('button', { name: 'Back to one view' }).click().catch(() => undefined);
    await page.getByRole('tab', { name: 'Room / Wall', exact: true }).click();
    await page.getByRole('group', { name: 'Where it hangs' }).getByRole('button', { name: 'My room', exact: true }).click();
    await upload(page, () => page.getByRole('button', { name: 'Choose a photo' }).first().click(), ROOM_PHOTO);
    const corner = page.getByLabel('Corner 2');
    await expect(corner).toBeVisible({ timeout: 20_000 });
    const box = (await corner.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 12, box.y + box.height / 2 + 10, { steps: 4 });
    await page.mouse.up();
    await shot(page, '6-photo');

    // The project is kept on this device: it is listed.
    await page.getByRole('button', { name: 'Projects' }).click();
    await expect(page.getByRole('dialog', { name: 'Your projects' })).toBeVisible();
    await expect(page.getByRole('dialog').getByText('Open now')).toBeVisible({ timeout: 10_000 });
    expect(errors).toEqual([]);
  });
});
