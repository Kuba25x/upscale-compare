import { expect, type Page } from '@playwright/test';

export const manageImages = (page: Page) => page.getByRole('dialog', { name: 'Your images' });
export const helpDialog = (page: Page) =>
  page.getByRole('dialog', { name: 'A closer look at every pixel' });

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
