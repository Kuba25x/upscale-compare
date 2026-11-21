import { expect, test } from '@playwright/test';
import { imageFile } from './fixtures';
import { expectPhonePortraitHeader, helpDialog, manageImages } from '../shared/phone-controls';
import { installWebDisplay } from '../shared/web-display';
import { expectCenteredBrand } from '../shared/layout-alignment';

const files = ['A', 'B', 'C', 'D'].map((name, i) => imageFile(`${name}.png`, i % 2));

for (const width of [320, 360, 390, 430]) {
  test(`portrait at ${width}px centers the landing brand and fits comparison controls in one row`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 820 });
    await page.goto('/');
    if (width === 320)
      await page.addStyleTag({
        content: '.app-header { font-family: "DejaVu Sans", system-ui; }',
      });
    await expectCenteredBrand(page);
    await page.getByTestId('file-input').setInputFiles(files);
    await expectPhonePortraitHeader(page, { icons: width > 320 });
    await expectCenteredBrand(page);
    const header = page.locator('.app-header');
    expect((await header.boundingBox())!.height).toBeLessThan(96);
    const split = header.getByRole('button', { name: 'Split Screen' });
    const side = header.getByRole('button', { name: 'Side-by-Side' });
    await expect(split).toHaveCSS('background-color', 'rgb(38, 46, 34)');
    await expect(side).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
    await expect(header.getByRole('button', { name: 'Manage Images' })).toHaveCSS(
      'background-color',
      'rgb(178, 227, 142)',
    );
    await side.tap();
    await expect(side).toHaveAttribute('aria-pressed', 'true');
    await expect(side).toHaveCSS('background-color', 'rgb(38, 46, 34)');
    await expect(page.locator('.image-selection-bar input')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Keyboard shortcuts' })).toHaveCount(0);
  });
}

test('landscape centers the landing brand and keeps the comparison brand at the start', async ({
  page,
}) => {
  await installWebDisplay(page, 'screen');
  await page.setViewportSize({ width: 844, height: 390 });
  await page.goto('/');
  await expect(page.locator('.app')).toHaveClass(/comparison-compact/);
  await expectCenteredBrand(page);
  await page.getByTestId('file-input').setInputFiles(files);
  const logo = page.locator('.app-header .brand-mark');
  await expect(page.getByTestId('stage')).toBeVisible();
  expect((await logo.boundingBox())!.x).toBeCloseTo(8, 0);
});

test('portrait edits all screenshot labels and keeps the comparison while visiting Help', async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await page.goto('/');
  await page.getByRole('button', { name: 'Help & About' }).tap();
  const help = helpDialog(page);
  await expect(help).toContainText('On touchscreens');
  await expect(help).toContainText('HDR inspection');
  await expect(help.getByRole('link', { name: /Third-party licenses/ })).toBeVisible();
  await help.getByRole('button', { name: 'Got it' }).tap();
  await page.getByTestId('file-input').setInputFiles(files);
  await page.getByRole('button', { name: 'Manage Images' }).tap();
  const manage = manageImages(page);
  await expect(manage.getByRole('textbox')).toHaveCount(4);
  await expect(manage.getByRole('button', { name: 'Replace', exact: true })).toHaveCount(4);
  await expect(manage.getByRole('button', { name: /^Remove image / })).toHaveCount(4);
  for (const [index, name] of ['A', 'B', 'C', 'D'].entries()) {
    const label = manage.getByRole('textbox', { name: `Label for ${name}.png` });
    await expect(label).toHaveAttribute('maxlength', '120');
    expect((await label.boundingBox())!.width).toBeGreaterThan(125);
    await label.fill(`Edited ${index + 1}`);
  }
  await expect(page.getByTestId('image-A')).toHaveAttribute('alt', 'Edited 1');
  const empty = manage.getByRole('textbox', { name: 'Label for B.png' });
  await empty.fill('  ');
  const helpButton = manage.getByRole('button', { name: 'Help & About' });
  await helpButton.focus();
  await page.keyboard.press('Enter');
  await expect(help).toBeVisible();
  await help.getByRole('button', { name: 'Privacy', exact: true }).tap();
  await page
    .getByRole('dialog', { name: 'Your images, your choice' })
    .getByRole('button', { name: 'Close dialog' })
    .tap();
  await help.getByRole('button', { name: 'Close dialog' }).tap();
  await expect(manage).toBeVisible();
  await expect(helpButton).toBeFocused();
  await expect(empty).toHaveValue('B');
  await expect(manage.getByRole('textbox', { name: 'Label for D.png' })).toHaveValue('Edited 4');
  await manage.getByRole('button', { name: 'Close dialog' }).tap();
  await page.getByLabel('Select image B').selectOption('3');
  await expect(page.getByTestId('image-B')).toHaveAttribute('alt', 'Edited 4');
  await page.getByTestId('stage').focus();
  await page.keyboard.press('2');
  await expect(page.getByTestId('stage')).toHaveAttribute('data-zoom', '2');
  await page.keyboard.press('?');
  await expect(help).toBeVisible();
});

test('rotating with an empty label restores its filename fallback and keeps Manage Images open', async ({
  page,
}) => {
  await installWebDisplay(page);
  await page.goto('/');
  await page.getByTestId('file-input').setInputFiles(files);
  await page.getByRole('button', { name: 'Manage Images' }).tap();
  const manage = manageImages(page);
  await manage.getByRole('textbox', { name: 'Label for B.png' }).fill('');
  await page.setViewportSize({ width: 844, height: 390 });
  await expect(page.locator('.app')).toHaveClass(/comparison-phone-landscape/);
  await expect(manage).toBeVisible();
  await manage.getByRole('button', { name: 'Close dialog' }).tap();
  await page.getByRole('button', { name: 'Image controls' }).tap();
  await expect(page.getByLabel('Label for image B')).toHaveValue('B');
});

test('phone landscape keeps icons and inline label editing while Help stays in Manage Images', async ({
  page,
}) => {
  await installWebDisplay(page);
  await page.setViewportSize({ width: 844, height: 390 });
  await page.goto('/');
  await page.getByTestId('file-input').setInputFiles(files);
  await expect(page.locator('.app')).toHaveClass(/comparison-phone-landscape/);
  await expect(page.locator('.app-header .eyebrow')).toHaveText('MODE');
  await expect(page.locator('.app-header .eyebrow')).toBeHidden();
  await expect(page.locator('.app-header .segmented button svg')).toHaveCount(2);
  await expect(page.getByRole('button', { name: 'Manage Images' }).locator('svg')).toHaveCount(1);
  expect((await page.locator('.app-header').boundingBox())!.height).toBe(52);
  await expect(page.getByRole('button', { name: 'Keyboard shortcuts' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Image controls' }).tap();
  await page.getByLabel('Label for image A').fill('Landscape label');
  await expect(page.getByTestId('image-A')).toHaveAttribute('alt', 'Landscape label');
  await page.getByRole('button', { name: 'Manage Images' }).tap();
  await expect(manageImages(page).getByRole('textbox')).toHaveCount(0);
  await manageImages(page).getByRole('button', { name: 'Help & About' }).tap();
  await expect(helpDialog(page)).toBeVisible();
});

test('touch tablet keeps its controls even in a narrow portrait window', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(screen, 'width', { value: 800 });
    Object.defineProperty(screen, 'height', { value: 1280 });
  });
  await page.setViewportSize({ width: 430, height: 900 });
  await page.goto('/');
  await page.getByTestId('file-input').setInputFiles(files);
  await expect(page.locator('.app')).not.toHaveClass(/comparison-phone-/);
  await expect(page.locator('.app-header').getByText('MODE', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Label for image A')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Keyboard shortcuts' })).toBeVisible();
  await expect(page.locator('.app-header .segmented button svg')).toHaveCount(2);
});
