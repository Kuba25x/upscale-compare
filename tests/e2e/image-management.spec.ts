import { expect, test, type Locator, type Page } from '@playwright/test';
import { imageFile } from './fixtures';

const originals = ['A', 'B', 'C', 'D'].map((name, i) => imageFile(`${name}.png`, i % 2));

async function manage(page: Page, count: number) {
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Upload Images', exact: true })).toBeVisible();
  await page.getByTestId('file-input').setInputFiles(originals.slice(0, count));
  await page.getByRole('button', { name: 'Manage Images', exact: true }).click();
  return page.getByRole('dialog', { name: 'Your images' });
}

async function choose(page: Page, button: Locator, files: (typeof originals)[number][]) {
  const chooser = page.waitForEvent('filechooser');
  await button.click();
  await (await chooser).setFiles(files);
}

for (const count of [2, 3, 4]) {
  test(`removes one of ${count} images, keeps the dialog open and closes to the right screen`, async ({
    page,
  }) => {
    const dialog = await manage(page, count);
    const actions = dialog.locator('.modal-actions button');
    await expect(actions).toHaveText(['Clear comparison', 'Replace all images', 'Add images']);
    await expect(dialog.locator('.modal-actions button.primary')).toHaveText('Add images');
    await expect(dialog).not.toContainText(/publish|sharing/i);

    const removeA = dialog.getByRole('button', { name: 'Remove image A.png' });
    await expect(dialog.getByRole('button', { name: 'Close dialog' })).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(
      dialog.getByRole('button', { name: 'Replace', exact: true }).first(),
    ).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(removeA).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('button', { name: /^Remove image / })).toHaveCount(count - 1);
    await expect(dialog.getByRole('button', { name: 'Remove image B.png' })).toBeFocused();
    await dialog.getByRole('button', { name: 'Close dialog' }).click();
    if (count === 2) {
      await expect(page.getByTestId('stage')).toHaveCount(0);
      await expect(page.getByRole('button', { name: 'Upload Images', exact: true })).toBeFocused();
    } else {
      await expect(page.getByTestId('stage')).toBeVisible();
      await expect(page.getByLabel('Select image A')).toHaveValue('1');
      await expect(page.getByLabel('Select image B')).toHaveValue('0');
      await expect(page.getByRole('button', { name: 'Manage Images', exact: true })).toBeFocused();
    }
  });
}

test('preserves a surviving selection, metadata and bytes when removing the current image B', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByTestId('file-input').setInputFiles(originals);
  await page.getByLabel('Select image A').selectOption('2');
  await page.getByLabel('Label for image A').fill('Custom C');
  await page.getByRole('button', { name: 'Comparison details' }).click();
  await page.getByLabel('Game title').fill('Comparison metadata');
  await page.getByLabel('Upscaling technology').nth(2).fill('Original C settings');
  await page.getByRole('button', { name: 'Save details' }).click();
  const retainedSrc = await page.getByTestId('image-A').getAttribute('src');
  const removedSrc = await page.getByTestId('image-B').getAttribute('src');
  await page.getByRole('button', { name: 'Manage Images', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Your images' });
  await expect(dialog.getByRole('button', { name: 'Add images' })).toBeDisabled();
  await dialog.getByRole('button', { name: 'Remove image B.png' }).click();
  await expect(dialog.getByRole('button', { name: 'Add images' })).toBeEnabled();
  await dialog.getByRole('button', { name: 'Close dialog' }).click();

  await expect(page.getByLabel('Select image A')).toHaveValue('1');
  await expect(page.getByLabel('Select image B')).toHaveValue('0');
  await expect(page.getByLabel('Label for image A')).toHaveValue('Custom C');
  await expect(page.getByTestId('image-A')).toHaveAttribute('src', retainedSrc!);
  const bytes = await page
    .getByTestId('image-A')
    .evaluate(async (image: HTMLImageElement) =>
      Array.from(new Uint8Array(await (await fetch(image.src)).arrayBuffer())),
    );
  expect(bytes).toEqual(Array.from(originals[2].buffer));
  expect(
    await page.evaluate(
      async (src) =>
        fetch(src!).then(
          () => true,
          () => false,
        ),
      removedSrc,
    ),
  ).toBe(false);
  await page.getByRole('button', { name: 'Comparison details' }).click();
  await expect(page.getByLabel('Game title')).toHaveValue('Comparison metadata');
  await expect(page.getByLabel('Upscaling technology').nth(1)).toHaveValue('Original C settings');
});

test('continues to add and replace from single and empty drafts', async ({ page }) => {
  const dialog = await manage(page, 3);
  await dialog.getByRole('button', { name: 'Remove image B.png' }).click();
  await dialog.getByRole('button', { name: 'Remove image C.png' }).click();
  await expect(page.getByTestId('stage')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Upload Images', exact: true })).toHaveCount(0);
  await expect(dialog.getByRole('button', { name: /^Remove image / })).toHaveCount(1);
  await choose(page, dialog.getByRole('button', { name: 'Replace', exact: true }), [originals[1]]);
  await expect(dialog.getByRole('button', { name: 'Remove image B.png' })).toBeVisible();
  await choose(page, dialog.getByRole('button', { name: 'Add images' }), [originals[2]]);
  await expect(dialog.getByRole('button', { name: /^Remove image / })).toHaveCount(2);

  await dialog.getByRole('button', { name: 'Clear comparison' }).click();
  await expect(dialog).toContainText('No images in this comparison.');
  await expect(page.getByRole('button', { name: 'Upload Images', exact: true })).toHaveCount(0);
  await expect(dialog.getByRole('button', { name: 'Add images' })).toBeFocused();
  await choose(page, dialog.getByRole('button', { name: 'Add images' }), [originals[0]]);
  await expect(dialog.getByRole('button', { name: 'Remove image A.png' })).toBeVisible();
  await expect(page.getByTestId('stage')).toHaveCount(0);
  await choose(page, dialog.getByRole('button', { name: 'Add images' }), [originals[1]]);
  await expect(dialog.getByRole('button', { name: /^Remove image / })).toHaveCount(2);
  await choose(page, dialog.getByRole('button', { name: 'Replace all images' }), originals);
  await expect(dialog.getByRole('button', { name: /^Remove image / })).toHaveCount(4);
  await dialog.getByRole('button', { name: 'Close dialog' }).click();
  await expect(page.getByTestId('stage')).toBeVisible();
  await expect(page.getByLabel('Select image A').locator('option')).toHaveCount(4);
});

test('clear resets settings and metadata and allows closing from an empty list', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByTestId('file-input').setInputFiles(originals.slice(0, 2));
  const dialog = page.getByRole('dialog', { name: 'Your images' });
  await page.getByRole('button', { name: 'Manage Images', exact: true }).click();
  await dialog.getByRole('button', { name: 'Clear comparison' }).click();
  await expect(dialog.getByRole('button', { name: 'Replace', exact: true })).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Close dialog' }).click();
  await expect(page.getByRole('button', { name: 'Upload Images', exact: true })).toBeVisible();

  await choose(
    page,
    page.getByRole('button', { name: 'Upload Images', exact: true }),
    originals.slice(1, 3),
  );
  await page.getByRole('button', { name: 'Side-by-Side', exact: true }).click();
  await page.getByRole('button', { name: 'Comparison details' }).click();
  await page.getByLabel('Game title').fill('Old game');
  await page.getByRole('button', { name: 'Save details' }).click();
  await page.getByRole('button', { name: 'Manage Images', exact: true }).click();
  await dialog.getByRole('button', { name: 'Clear comparison' }).click();
  await choose(page, dialog.getByRole('button', { name: 'Add images' }), originals.slice(2));
  await expect(dialog.getByRole('button', { name: /^Remove image / })).toHaveCount(2);
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Split Screen', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await page.getByRole('button', { name: 'Comparison details' }).click();
  await expect(page.getByLabel('Game title')).toBeEmpty();
});
