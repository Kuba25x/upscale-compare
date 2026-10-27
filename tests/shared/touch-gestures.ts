import { test, expect } from '@playwright/test';
import { imageFile } from '../e2e/fixtures';

// Native Chromium touch dispatch. This does not emulate Firefox for Android.
export function touchGestureTests() {
  for (const mode of ['Split Screen', 'Side-by-Side']) {
    test(`${mode}: touch pinch stays proportional through slow and rapid repeated gestures`, async ({
      page,
    }) => {
      test.setTimeout(60000);
      await page.goto('./');
      await page.getByTestId('file-input').setInputFiles([imageFile(), imageFile('FSR.png', 1)]);
      await page.getByRole('button', { name: mode, exact: true }).tap();
      const stage = page.getByTestId('stage');
      const box = (await stage.boundingBox())!;
      await expect(stage).toHaveCSS('touch-action', 'none');
      const viewportScale = await page.evaluate(() => visualViewport!.scale);
      const client = await page.context().newCDPSession(page);
      const x = Math.round(box.x + 65),
        y = Math.round(box.y + box.height * 0.45);
      const contacts = (spread: number) => [
        { x, y: y - 40 - spread, id: 1 },
        { x, y: y + 40 + spread, id: 2 },
      ];
      for (let round = 0; round < 4; round++) {
        await page.getByRole('button', { name: '100%', exact: true }).tap();
        await client.send('Input.dispatchTouchEvent', {
          type: 'touchStart',
          touchPoints: [contacts(0)[0]],
        });
        await client.send('Input.dispatchTouchEvent', {
          type: 'touchStart',
          touchPoints: contacts(0),
        });
        for (let index = 0; index < 24; index++) {
          const spread = (index < 12 ? index + 1 : 23 - index) * 2;
          await client.send('Input.dispatchTouchEvent', {
            type: 'touchMove',
            touchPoints: contacts(spread),
          });
          if (round % 2 === 0)
            await expect
              .poll(async () => Number(await stage.getAttribute('data-zoom')))
              .toBeCloseTo((80 + 2 * spread) / 80, 5);
        }
        await client.send('Input.dispatchTouchEvent', {
          type: round % 2 ? 'touchCancel' : 'touchEnd',
          touchPoints: [],
        });
        await expect
          .poll(async () => Number(await stage.getAttribute('data-zoom')))
          .toBeCloseTo(1, 5);
        await expect(stage).not.toHaveClass(/panning/);
        expect(await page.evaluate(() => visualViewport!.scale)).toBe(viewportScale);
        const a = (await page.getByTestId('image-A').boundingBox())!,
          b = (await page.getByTestId('image-B').boundingBox())!;
        expect(a.width).toBe(b.width);
        expect(a.y).toBe(b.y);
        expect(b.x - a.x).toBeCloseTo(mode === 'Split Screen' ? 0 : (box.width + 1) / 2, 4);
        const ratio = await page.evaluate(() => devicePixelRatio);
        expect(a.width * ratio).toBeCloseTo(640, 4);
      }
      await client.detach();
    });
  }
}
