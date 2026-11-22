import { expect, type Locator, type Page } from '@playwright/test';

export const manageImages = (page: Page) => page.getByRole('dialog', { name: 'Your images' });
export const helpDialog = (page: Page) =>
  page.getByRole('dialog', { name: 'A closer look at every pixel' });

export const phoneZoomTrigger = (page: Page) =>
  page.getByRole('button', { name: 'Zoom preset', exact: true });
export const zoomPresets = (page: Page) => page.getByRole('menu', { name: 'Zoom presets' });

export async function chooseZoomPreset(page: Page, zoom: number) {
  const trigger = phoneZoomTrigger(page);
  const preset = page.getByRole('combobox', { name: 'Zoom preset' });
  if (await trigger.isVisible()) {
    await trigger.click();
    await zoomPresets(page)
      .getByRole('menuitemradio', { name: `${zoom * 100}%`, exact: true })
      .click();
    await expect(zoomPresets(page)).toBeHidden();
  } else if (await preset.isVisible()) await preset.selectOption(String(zoom));
  else await page.getByRole('button', { name: `${zoom * 100}%`, exact: true }).click();
}

export const phoneImageTrigger = (scope: Page | Locator, slot: 'A' | 'B') =>
  scope.getByRole('button', { name: `Select image ${slot}`, exact: true });
export const imageChoices = (page: Page, slot: 'A' | 'B') =>
  page.getByRole('menu', { name: `Image ${slot} screenshots` }).getByRole('menuitemradio');

async function imageControl(page: Page, slot: 'A' | 'B') {
  const trigger = phoneImageTrigger(page, slot);
  const native = page.getByRole('combobox', { name: `Select image ${slot}` });
  const control = trigger.or(native);
  const panelToggle = page.getByRole('button', { name: 'Image controls', exact: true });
  await expect(control.or(panelToggle).first()).toBeVisible();
  if (!(await control.isVisible()) && (await panelToggle.isVisible())) {
    const closed = await panelToggle.evaluate((button) => {
      const panel = document.getElementById(button.getAttribute('aria-controls') ?? '');
      return button.getAttribute('aria-expanded') === 'false' && !panel?.matches(':popover-open');
    });
    if (closed) await panelToggle.click();
  }
  await expect(control).toBeVisible();
  return { trigger, native, custom: await trigger.isVisible() };
}

export async function selectImage(page: Page, slot: 'A' | 'B', index: number) {
  const { trigger, native, custom } = await imageControl(page, slot);
  if (custom) {
    await trigger.click();
    await imageChoices(page, slot).nth(index).click();
    await expect(trigger).toHaveAttribute('aria-expanded', 'false');
  } else {
    await native.selectOption(String(index));
  }
}

export async function expectSelectedImageLabel(page: Page, slot: 'A' | 'B', label: string) {
  const { trigger, native, custom } = await imageControl(page, slot);
  await expect(
    custom ? trigger.locator('.phone-image-label') : native.locator('option:checked'),
  ).toHaveText(label);
}

export async function expectSelectedImageIndex(page: Page, slot: 'A' | 'B', index: number) {
  const { trigger, native, custom } = await imageControl(page, slot);
  if (custom) {
    await trigger.click();
    await expect(imageChoices(page, slot).nth(index)).toHaveAttribute('aria-checked', 'true');
    await trigger.click();
    await expect(trigger).toHaveAttribute('aria-expanded', 'false');
  } else {
    await expect(native).toHaveValue(String(index));
  }
}

export async function expectPhoneImageMenuKeyboard(page: Page) {
  await phoneImageTrigger(page, 'A').focus();
  await page.keyboard.press('Tab');
  await expect(phoneImageTrigger(page, 'B')).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  for (const slot of ['A', 'B'] as const) {
    const trigger = phoneImageTrigger(page, slot);
    await expect(trigger).toBeFocused();
    await expect(trigger).toHaveCSS('outline-style', 'solid');
    await page.keyboard.press('Enter');
    await expect(page.getByRole('menuitemradio', { checked: true })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(trigger).toHaveAttribute('aria-expanded', 'false');
    await expect(trigger).toBeFocused();
    await expect(trigger).toHaveCSS('outline-style', 'solid');
    if (slot === 'A') await page.keyboard.press('Tab');
  }
}

export async function expectPortraitImagePanel(
  page: Page,
  { left = 0, right = 0, bottom = 0, gap = 8 } = {},
) {
  const panel = page.locator('.phone-image-controls');
  await expect(panel).toBeVisible();
  await expect(panel.locator('select')).toHaveCount(0);
  await expect(panel).toHaveCSS('border-radius', '0px');
  await expect(panel).toHaveCSS('border-width', '0px');
  await expect(panel).toHaveCSS('box-shadow', 'none');
  await expect
    .poll(() =>
      panel.evaluate((node, inset) => {
        const buttons = node.querySelectorAll('.phone-image-trigger, .swap-button');
        const lowestButton = Math.max(
          ...Array.from(buttons, (b) => b.getBoundingClientRect().bottom),
        );
        return innerHeight - inset - lowestButton;
      }, bottom),
    )
    .toBeCloseTo(gap + 5, 0);
  const geometry = await panel.evaluate((node) => {
    const app = node.closest('.app')!;
    const header = app.querySelector('.app-header')!;
    const stage = app.querySelector('.stage')!;
    return {
      panel: node.getBoundingClientRect().toJSON(),
      stage: stage.getBoundingClientRect().toJSON(),
      app: app.getBoundingClientRect().toJSON(),
      reservedBottom: parseFloat(getComputedStyle(app).paddingBottom),
      headerBottom: header.getBoundingClientRect().bottom,
      headerColor: getComputedStyle(header).backgroundColor,
      panelColor: getComputedStyle(node).backgroundColor,
    };
  });
  expect(geometry.stage.top).toBeCloseTo(geometry.headerBottom, 0);
  expect(geometry.stage.bottom).toBeCloseTo(geometry.panel.top, 0);
  expect(geometry.stage.left).toBeCloseTo(geometry.app.left, 0);
  expect(geometry.stage.right).toBeCloseTo(geometry.app.right, 0);
  expect(geometry.panel.left).toBeCloseTo(geometry.app.left, 0);
  expect(geometry.panel.right).toBeCloseTo(geometry.app.right, 0);
  expect(geometry.panel.bottom).toBeCloseTo(geometry.app.bottom - geometry.reservedBottom, 0);
  expect(geometry.panelColor).toBe(geometry.headerColor);
  expect(await panel.evaluate((node) => node.scrollWidth)).toBe(
    await panel.evaluate((node) => node.clientWidth),
  );
  const a = phoneImageTrigger(page, 'A');
  const b = phoneImageTrigger(page, 'B');
  const swap = panel.getByRole('button', { name: 'Swap images' });
  for (const button of [a, swap, b]) {
    await expect(button).toHaveCSS('border-width', '1px');
    await expect(button).toHaveCSS('border-radius', '6px');
    await expect(button).toHaveCSS('padding', button === swap ? '5px' : '4px');
  }
  const [aBox, swapBox, bBox] = await Promise.all([
    a.boundingBox(),
    swap.boundingBox(),
    b.boundingBox(),
  ]);
  const sidePadding = (await page.evaluate(() => matchMedia('(max-width: 620px)').matches))
    ? 13
    : 17;
  expect(aBox!.x).toBeCloseTo(geometry.app.left + left + sidePadding, 0);
  expect(bBox!.x + bBox!.width).toBeCloseTo(geometry.app.right - right - sidePadding, 0);
  expect(swapBox!.x - aBox!.x - aBox!.width).toBeCloseTo(4, 0);
  expect(bBox!.x - swapBox!.x - swapBox!.width).toBeCloseTo(4, 0);
  expect(swapBox!.width).toBeCloseTo(44, 0);
  for (const box of [aBox!, swapBox!, bBox!]) {
    expect(box.width).toBeGreaterThanOrEqual(44);
    expect(box.height).toBeGreaterThanOrEqual(44);
  }
}

export async function expectLandscapeImagePopover(
  page: Page,
  { left = 0, right = 0, bottom = 0 } = {},
) {
  const trigger = page.getByRole('button', { name: 'Image controls', exact: true });
  const panel = page.getByRole('group', { name: 'Image controls', exact: true });
  await expect(trigger).toHaveAttribute('aria-expanded', 'true');
  await expect(panel).toBeVisible();
  const anchor = (await trigger.boundingBox())!;
  const bounds = (await panel.boundingBox())!;
  const viewport = page.viewportSize()!;
  expect(bounds.width).toBeCloseTo(Math.min(320, viewport.width - left - right - 12), 0);
  expect(bounds.x).toBeGreaterThanOrEqual(left);
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(viewport.width - right);
  expect(bounds.x).toBeLessThanOrEqual(anchor.x + 1);
  expect(bounds.x + bounds.width).toBeGreaterThan(anchor.x + anchor.width / 2);
  expect(bounds.y).toBeCloseTo(anchor.y + anchor.height + 6, 0);
  expect(bounds.y + bounds.height).toBeLessThanOrEqual(viewport.height - bottom);
  await expect(panel.locator('select')).toHaveCount(0);
}

export async function expectPhoneZoomToolbar(
  page: Page,
  { left = 0, right = 0, oneRow = true } = {},
) {
  const toolbar = page.locator('.inspection-toolbar');
  await expect(phoneZoomTrigger(page)).toBeVisible();
  await expect(toolbar.locator('.zoom-readout')).toHaveCount(0);
  const { controls, scrollWidth, clientWidth, viewportWidth } = await toolbar.evaluate((node) => ({
    controls: Array.from(node.querySelectorAll(':scope > button'), (control) => ({
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

export async function expectZoomMenuPlacement(
  page: Page,
  { top = 0, bottom = 0, left = 0, right = 0, above = true } = {},
) {
  const popup = zoomPresets(page);
  await expect(popup).toBeVisible();
  const fits = () =>
    popup.evaluate(
      (menu, { top, bottom, left, right, above }) => {
        const trigger = document.querySelector('.phone-zoom-trigger')!.getBoundingClientRect();
        const box = menu.getBoundingClientRect();
        const viewport = document.documentElement;
        const expectedX = Math.max(
          left + 6,
          Math.min(trigger.left, viewport.clientWidth - right - box.width - 6),
        );
        const gap = above ? trigger.top - box.bottom : box.top - trigger.bottom;
        return (
          Math.abs(gap - 6) < 1 &&
          Math.abs(box.left - expectedX) < 1 &&
          box.left >= left &&
          box.right <= viewport.clientWidth - right &&
          box.top >= top &&
          box.bottom <= viewport.clientHeight - bottom &&
          menu.contains(
            document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2),
          )
        );
      },
      { top, bottom, left, right, above },
    );
  await expect.poll(fits).toBe(true);
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
