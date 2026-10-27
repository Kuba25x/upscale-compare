import { test, expect } from '@playwright/test';
import { openComparison } from './fixtures';
test('mobile keeps all main controls accessible without horizontal scrolling', async ({ page }) => {
  await page.goto('/');
  await page.screenshot({ path: 'test-results/landing-mobile.png' });
  await openComparison(page);
  for (const name of ['Split Screen', 'Side-by-Side', 'Share Comparison', 'Upload Images'])
    await expect(page.getByRole('button', { name, exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
  await page.getByRole('button', { name: '100%', exact: true }).tap();
  await expect(page.getByTestId('stage')).toHaveAttribute('data-zoom', '1');
  await page.getByRole('button', { name: 'Side-by-Side', exact: true }).tap();
  await expect(page.getByTestId('image-A')).toBeVisible();
  await page.screenshot({ path: 'test-results/viewer-mobile.png' });
});
test('touch divider and synchronized pinch navigation respond to touch input', async ({ page }) => {
  await openComparison(page);
  const stage = await page.getByTestId('stage').boundingBox();
  const client = await page.context().newCDPSession(page);
  const y = Math.round(stage!.y + stage!.height / 2),
    center = Math.round(stage!.x + stage!.width / 2);
  await client.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ x: center, y, id: 1 }],
  });
  await client.send('Input.dispatchTouchEvent', {
    type: 'touchMove',
    touchPoints: [{ x: 280, y, id: 1 }],
  });
  await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await expect(page.getByRole('slider')).toHaveAttribute(
    'aria-valuenow',
    String(Math.round(((280 - stage!.x) / stage!.width) * 100)),
  );
  await page.keyboard.press('q');
  await expect(page.getByTestId('stage')).toBeFocused();
  await expect(page.getByRole('slider')).not.toBeFocused();
  await expect(page.locator('.divider-handle')).toHaveCSS('outline-style', 'none');
  await page.getByRole('button', { name: '100%', exact: true }).tap();
  await client.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [
      { x: 70, y: y - 60, id: 1 },
      { x: 150, y: y - 60, id: 2 },
    ],
  });
  await client.send('Input.dispatchTouchEvent', {
    type: 'touchMove',
    touchPoints: [
      { x: 45, y: y - 60, id: 1 },
      { x: 175, y: y - 60, id: 2 },
    ],
  });
  await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await expect
    .poll(async () => Number(await page.getByTestId('stage').getAttribute('data-zoom')))
    .toBeGreaterThan(1);
  const a = await page.getByTestId('image-A').boundingBox(),
    b = await page.getByTestId('image-B').boundingBox();
  expect(a).toEqual(b);
});
