import { expect, type Page } from '@playwright/test';

export async function expectLocalComparisonUI(page: Page) {
  await expect(
    page.getByRole('button', { name: 'Share Comparison', exact: true, includeHidden: true }),
  ).toHaveCount(0);
  await expect(page.getByText(/(?:Demo|Offline)\s*·\s*Public sharing/i)).toHaveCount(0);
  await expect(page.locator('[aria-describedby="demo-sharing-note"]')).toHaveCount(0);
  await expect(page.locator('.image-panel-sharing, .image-panel-publication')).toHaveCount(0);
}
