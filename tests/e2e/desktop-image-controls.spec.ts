import { expect, test, type Page } from '@playwright/test';
import { imageFile } from './fixtures';

const longLabel = 'W'.repeat(120);
const trigger = (page: Page, slot: 'A' | 'B') =>
  page.getByRole('button', { name: `Select image ${slot}`, exact: true });
const pencil = (page: Page, slot: 'A' | 'B') =>
  page.getByRole('button', { name: `Edit label for image ${slot}`, exact: true });
const choices = (page: Page, slot: 'A' | 'B') =>
  page.getByRole('menu', { name: `Image ${slot} screenshots`, exact: true });

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page
    .getByTestId('file-input')
    .setInputFiles(
      ['A', longLabel, 'Native', 'FSR'].map((name, i) => imageFile(`${name}.png`, i % 2)),
    );
  await expect(page.getByTestId('stage')).toBeVisible();
});

test('keeps short names snug and long names separate from desktop controls', async ({ page }) => {
  const panel = page.locator('.desktop-image-controls');
  await expect(panel.locator('input, select')).toHaveCount(0);
  for (const width of [1600, 980, 620, 410]) {
    await page.setViewportSize({ width, height: 700 });
    const swap = (await panel.getByRole('button', { name: 'Swap images' }).boundingBox())!;
    for (const slot of ['A', 'B'] as const) {
      const select = trigger(page, slot);
      const text = select.locator('.choice-menu-value');
      const name = (await text.boundingBox())!;
      const chevron = (await select.locator('svg').boundingBox())!;
      const edit = (await pencil(page, slot).boundingBox())!;
      expect(chevron.x - (name.x + name.width)).toBeGreaterThanOrEqual(0);
      expect(chevron.x - (name.x + name.width)).toBeLessThanOrEqual(6);
      expect(edit.x - (chevron.x + chevron.width)).toBeGreaterThanOrEqual(0);
      expect(edit.x - (chevron.x + chevron.width)).toBeLessThanOrEqual(8);
      if (slot === 'A') expect(edit.x + edit.width).toBeLessThan(swap.x);
      else expect(name.x).toBeGreaterThan(swap.x + swap.width);
      expect(await text.evaluate((node) => node.scrollWidth > node.clientWidth)).toBe(slot === 'B');
      await expect(text).toHaveCSS('text-overflow', 'ellipsis');
    }
    await expect(panel.getByText(/640 × 480.*MB · PNG/)).toHaveCount(2);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
  }

  await trigger(page, 'B').click();
  const menu = choices(page, 'B');
  await expect(menu).toBeInViewport({ ratio: 1 });
  const box = (await menu.boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(6);
  expect(box.x + box.width).toBeLessThanOrEqual(410 - 6);
  await expect(menu.getByRole('menuitemradio', { name: longLabel, checked: true })).toBeVisible();
  expect(await menu.evaluate((node) => node.scrollWidth)).toBe(
    await menu.evaluate((node) => node.clientWidth),
  );
});

test('edits in place, restores focus and commits only a validated label', async ({ page }) => {
  const editor = page.getByRole('textbox', { name: 'Label for image A', exact: true });
  const original = (await page.getByTestId('image-A').getAttribute('src'))!;
  const panel = page.locator('.image-selection-bar');
  const originalPanel = await panel.boundingBox();
  await expect(editor).toHaveCount(0);
  await pencil(page, 'A').click();
  await expect(editor).toBeFocused();
  expect(
    await editor.evaluate((el: HTMLInputElement) => [el.selectionStart, el.selectionEnd]),
  ).toEqual([0, 1]);
  expect(await panel.boundingBox()).toEqual(originalPanel);
  await expect(choices(page, 'A')).toBeHidden();
  await expect(trigger(page, 'A')).toHaveCount(0);

  await editor.fill('Discard this label');
  await expect(page.getByTestId('image-A')).toHaveAttribute('alt', 'A');
  await editor.press('Escape');
  await expect(pencil(page, 'A')).toBeFocused();
  await expect(trigger(page, 'A')).toHaveAccessibleDescription('A');

  await pencil(page, 'A').press('Enter');
  await editor.fill('Custom A');
  await editor.press('Enter');
  await expect(pencil(page, 'A')).toBeFocused();
  await expect(editor).toHaveCount(0);
  await expect(page.locator('.badge-a')).toContainText('Custom A');
  await expect(page.getByTestId('image-A')).toHaveAttribute('alt', 'Custom A');
  await expect(trigger(page, 'A')).toHaveAccessibleDescription('Custom A');
  await trigger(page, 'A').click();
  await expect(
    choices(page, 'A').getByRole('menuitemradio', { name: 'Custom A', checked: true }),
  ).toBeVisible();
  await page.keyboard.press('Escape');

  await pencil(page, 'A').click();
  await editor.fill('Saved on blur');
  await page.getByTestId('stage').click({ position: { x: 50, y: 90 } });
  await expect(editor).toHaveCount(0);
  await expect(page.getByTestId('image-A')).toHaveAttribute('alt', 'Saved on blur');
  await page.getByRole('button', { name: 'Manage Images' }).click();
  const manage = page.getByRole('dialog', { name: 'Your images' });
  await expect(manage.getByText('Saved on blur', { exact: true })).toBeVisible();
  await expect(
    manage.getByRole('button', { name: 'Remove image A.png', exact: true }),
  ).toBeVisible();
  await manage.getByRole('button', { name: 'Close dialog' }).click();

  await pencil(page, 'A').click();
  await expect(editor).toHaveAttribute('maxlength', '120');
  await page.keyboard.insertText('x'.repeat(130));
  await expect(editor).toHaveValue('x'.repeat(120));
  await editor.press('Enter');
  await expect(page.getByTestId('image-A')).toHaveAttribute('alt', 'x'.repeat(120));

  for (const blank of ['', '   ']) {
    await pencil(page, 'A').click();
    await editor.fill(`Replace before clearing (${blank.length})`);
    await editor.press('Enter');
    await pencil(page, 'A').click();
    await editor.fill(blank);
    await editor.press('Enter');
    await expect(trigger(page, 'A')).toHaveAccessibleDescription('A');
  }

  await expect(page.getByTestId('image-A')).toHaveAttribute('src', original);
});

test('announces selection, supports keyboard navigation, and preserves both ways to swap', async ({
  page,
}) => {
  const select = trigger(page, 'A');
  const menu = choices(page, 'A');
  const options = menu.getByRole('menuitemradio');
  await expect(select).toHaveAccessibleDescription('A');
  await expect(select).toHaveAttribute('aria-haspopup', 'menu');
  await select.focus();
  await page.keyboard.press('Tab');
  await expect(pencil(page, 'A')).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(select).toBeFocused();
  await expect(select).toHaveCSS('outline-style', 'solid');
  await page.keyboard.press('Enter');
  await expect(select).toHaveAttribute('aria-expanded', 'true');
  await expect(options).toHaveText(['A', longLabel, 'Native', 'FSR']);
  await expect(options.nth(0)).toBeFocused();
  await expect(options.nth(0)).toHaveAttribute('aria-checked', 'true');
  await page.keyboard.press('End');
  await expect(options.nth(3)).toBeFocused();
  await page.keyboard.press('Home');
  await page.keyboard.press('ArrowDown');
  await expect(options.nth(1)).toBeFocused();
  await page.keyboard.press('Space');
  await expect(menu).toBeHidden();
  await expect(select).toBeFocused();
  await expect(select).toHaveAccessibleDescription(longLabel);
  await expect(trigger(page, 'B')).toHaveAccessibleDescription('A');

  await page.keyboard.press('ArrowUp');
  await expect(options.nth(3)).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(select).toHaveAttribute('aria-expanded', 'false');
  await expect(select).toBeFocused();
  await select.click();
  await expect(options.nth(1)).toHaveAttribute('aria-checked', 'true');
  await menu.getByRole('menuitemradio', { name: 'Native' }).click();
  await expect(select).toHaveAccessibleDescription('Native');
  await expect(select).toBeFocused();
  await page.keyboard.press('Space');
  await expect(options.nth(2)).toBeFocused();
  await page.getByRole('heading', { name: 'Upscale Compare' }).click();
  await expect(menu).toBeHidden();
  await expect(page.getByRole('textbox', { name: 'Label for image A' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Swap images' }).click();
  await expect(select).toHaveAccessibleDescription('A');
  await expect(trigger(page, 'B')).toHaveAccessibleDescription('Native');
});
