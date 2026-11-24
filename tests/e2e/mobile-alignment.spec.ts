import { expect, test } from '@playwright/test';
import { imageFile } from './fixtures';
import { expectAligned, geometry, mismatch } from '../shared/image-alignment';
import { chooseZoomPreset } from '../shared/phone-controls';

test('keeps touch alignment in portrait, landscape, and a pinch across the two panels', async ({
  page,
  context,
}) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await page.goto('/');
  await page
    .getByTestId('file-input')
    .setInputFiles([imageFile(), imageFile('B.png', 1, 480, 200)]);
  const dialog = mismatch(page);
  await expect(dialog).toBeInViewport();
  await dialog.getByRole('radio', { name: 'Match Width' }).tap();
  await page.setViewportSize({ width: 640, height: 320 });
  await expect(dialog.getByRole('radio', { name: 'Match Width' })).toBeChecked();
  await dialog.getByRole('button', { name: 'Apply' }).tap();
  await expectAligned(page, 4 / 3);
  await page.getByRole('button', { name: 'Side-by-Side', exact: true }).tap();
  await expectAligned(page, 4 / 3, true);
  await chooseZoomPreset(page, 1);
  await expectAligned(page, 4 / 3, true, 1);

  const before = await geometry(page);
  const x = before.stage.x + before.stage.width * 0.72;
  const y = before.stage.y + before.stage.height * 0.44;
  const sourcePoint = (image: typeof before.b) => ({
    x: ((x - image.x) * image.naturalWidth) / image.width,
    y: ((y - image.y) * image.naturalHeight) / image.height,
  });
  const source = sourcePoint(before.b);
  const cdp = await context.newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [
      { x: x - 20, y, id: 1 },
      { x: x + 20, y, id: 2 },
    ],
  });
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchMove',
    touchPoints: [
      { x: x - 40, y, id: 1 },
      { x: x + 40, y, id: 2 },
    ],
  });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await cdp.detach();
  await expectAligned(page, 4 / 3, true, 2);
  const pinched = sourcePoint((await geometry(page)).b);
  expect(Math.abs(pinched.x - source.x)).toBeLessThan(0.6);
  expect(Math.abs(pinched.y - source.y)).toBeLessThan(0.6);
  await page.setViewportSize({ width: 320, height: 640 });
  await expectAligned(page, 4 / 3, true, 2);
  await expect(dialog).toHaveCount(0);
});
