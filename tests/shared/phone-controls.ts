import { expect, type Page } from '@playwright/test';

export const manageImages = (page: Page) => page.getByRole('dialog', { name: 'Your images' });
export const helpDialog = (page: Page) =>
  page.getByRole('dialog', { name: 'A closer look at every pixel' });

export async function chooseZoomPreset(page: Page, zoom: 1 | 2 | 4) {
  const preset = page.getByRole('combobox', { name: 'Zoom preset' });
  if (await preset.isVisible()) await preset.selectOption(String(zoom));
  else await page.getByRole('button', { name: `${zoom * 100}%`, exact: true }).click();
}

export async function expectPhoneSelectFocus(page: Page, tap = false) {
  for (const name of ['Zoom preset', 'Select image A', 'Select image B']) {
    const select = page.getByRole('combobox', { name, exact: true });
    await select.focus();
    await page.keyboard.press('Shift+Tab');
    await page.keyboard.press('Tab');
    await expect(select).toBeFocused();
    await expect(select).toHaveCSS('outline-color', 'rgb(178, 227, 142)');
    await expect(select).toHaveCSS('outline-style', 'solid');

    // Synthetic touch keeps :focus-visible active and exercises the Android heuristic.
    if (tap) await select.tap();
    else await select.dispatchEvent('pointerdown', { pointerType: 'touch' });
    await expect(select).toBeFocused();
    await expect(select).toHaveCSS('outline-style', 'none');

    await page.keyboard.press('Tab');
    await page.keyboard.press('Shift+Tab');
    await expect(select).toBeFocused();
    await expect(select).toHaveCSS('outline-style', 'solid');
    await expect(select).toHaveCSS('outline-color', 'rgb(178, 227, 142)');
  }
}

export async function expectPhoneZoomToolbar(
  page: Page,
  { left = 0, right = 0, oneRow = true } = {},
) {
  const toolbar = page.locator('.inspection-toolbar');
  await expect(toolbar.getByRole('combobox', { name: 'Zoom preset' })).toBeVisible();
  await expect(toolbar.locator('.zoom-readout')).toHaveCount(0);
  const { controls, scrollWidth, clientWidth, viewportWidth } = await toolbar.evaluate((node) => ({
    controls: Array.from(node.querySelectorAll('button, select'), (control) => ({
      name: control.getAttribute('aria-label') ?? control.textContent?.trim(),
      bounds: control.getBoundingClientRect().toJSON(),
    })),
    scrollWidth: node.scrollWidth,
    clientWidth: node.clientWidth,
    viewportWidth: document.documentElement.clientWidth,
  }));
  expect(controls.map(({ name }) => name).slice(0, 5)).toEqual([
    'Fit',
    'Zoom preset',
    'Zoom out',
    'Zoom in',
    'Comparison details',
  ]);
  expect(controls).toHaveLength(6);
  expect(controls.at(-1)!.name).toMatch(/fullscreen|minimalist/i);
  expect(scrollWidth).toBe(clientWidth);
  for (const { bounds } of controls) {
    expect(bounds.width).toBeGreaterThanOrEqual(44);
    expect(bounds.height).toBeGreaterThanOrEqual(44);
    expect(bounds.left).toBeGreaterThanOrEqual(left);
    expect(bounds.right).toBeLessThanOrEqual(viewportWidth - right);
    if (oneRow) expect(bounds.y).toBeCloseTo(controls[0].bounds.y, 1);
  }
}

export async function openComparisonHelp(page: Page) {
  await expect(page.getByTestId('stage')).toBeVisible();
  const shortcuts = page.getByRole('button', { name: 'Keyboard shortcuts', exact: true });
  if (await shortcuts.isVisible()) {
    await shortcuts.click();
  } else {
    const manage = manageImages(page);
    if (!(await manage.isVisible()))
      await page.getByRole('button', { name: 'Manage Images', exact: true }).click();
    await manage.getByRole('button', { name: 'Help & About' }).click();
  }
  return helpDialog(page);
}

export async function renameSelectedImage(
  page: Page,
  slot: 'A' | 'B',
  filename: string,
  label: string,
) {
  const selectedEditor = page.getByRole('textbox', {
    name: `Label for image ${slot}`,
    exact: true,
  });
  await expect(page.getByTestId('stage')).toBeVisible();
  if (await selectedEditor.isVisible()) {
    await selectedEditor.fill(label);
  } else {
    await page.getByRole('button', { name: 'Manage Images', exact: true }).click();
    await manageImages(page)
      .getByRole('textbox', { name: `Label for ${filename}`, exact: true })
      .fill(label);
    await manageImages(page).getByRole('button', { name: 'Close dialog' }).click();
  }
}

export async function expectPhonePortraitHeader(
  page: Page,
  { icons, allowWrappedLabels = false }: { icons?: boolean; allowWrappedLabels?: boolean } = {},
) {
  await expect(page.locator('.app')).toHaveClass(/comparison-phone-portrait/);
  const header = page.locator('.app-header');
  const modes = header.getByRole('group', { name: 'Comparison mode', exact: true });
  await expect(modes.getByRole('button')).toHaveText(['Split Screen', 'Side-by-Side']);
  await expect(header.getByText('MODE', { exact: true })).toHaveCount(0);
  const row = header.locator('.header-controls');
  const buttons = row.getByRole('button');
  await expect(buttons).toHaveText(['Split Screen', 'Side-by-Side', 'Manage Images']);
  if (icons !== undefined)
    await expect(row.locator('button svg:visible')).toHaveCount(icons ? 3 : 0);

  const { left, right } = await header.evaluate((node) => {
    const box = node.getBoundingClientRect();
    const style = getComputedStyle(node);
    return {
      left: box.left + parseFloat(style.paddingLeft),
      right: box.right - parseFloat(style.paddingRight),
    };
  });
  const boxes = await buttons.evaluateAll((nodes) =>
    nodes.map((node) => {
      const { left, right, top, height, width } = node.getBoundingClientRect();
      const label = node.querySelector('span')!;
      const text = document.createRange();
      text.selectNodeContents(label);
      return {
        left,
        right,
        top,
        height,
        width,
        clipped: node.scrollWidth > node.clientWidth || label.scrollWidth > label.clientWidth,
        lines: text.getClientRects().length,
      };
    }),
  );
  expect(boxes[0].left).toBeGreaterThanOrEqual(left);
  expect(boxes[0].left - left).toBeLessThanOrEqual(2);
  expect(boxes.at(-1)!.right).toBeCloseTo(right, 0);
  for (const [index, box] of boxes.entries()) {
    if (index > 0) {
      const gap = box.left - boxes[index - 1].right;
      expect(gap).toBeGreaterThanOrEqual(0);
      expect(gap).toBeLessThanOrEqual(8);
    }
    expect(box.width).toBeGreaterThanOrEqual(44);
    expect(box.height).toBeGreaterThanOrEqual(44);
    expect(Math.abs(box.top + box.height / 2 - boxes[0].top - boxes[0].height / 2)).toBeLessThan(2);
    expect(box.clipped).toBe(false);
    if (!allowWrappedLabels) expect(box.lines).toBe(1);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(
    page.viewportSize()!.width,
  );
}
