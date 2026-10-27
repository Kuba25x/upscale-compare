import { test, expect, type Page } from '@playwright/test';
import { imageFile } from '../e2e/fixtures';
type Point = { x: number; y: number };

async function openViewer(page: Page, mode: string) {
  await page.goto('./');
  await page.getByTestId('file-input').setInputFiles([imageFile(), imageFile('FSR.png', 1)]);
  await page.getByRole('button', { name: mode, exact: true }).click();
  await page.getByRole('button', { name: '100%', exact: true }).click();
  // Synthetic touch IDs have no native contact. Shim only their capture bookkeeping.
  // This tests React handlers in each engine, not a physical Android touch pipeline.
  await page.getByTestId('stage').evaluate((stage) => {
    const captures = new Set<number>();
    const set = stage.setPointerCapture.bind(stage);
    const has = stage.hasPointerCapture.bind(stage);
    const release = stage.releasePointerCapture.bind(stage);
    stage.setPointerCapture = (id) => (id >= 1000 ? void captures.add(id) : set(id));
    stage.hasPointerCapture = (id) => (id >= 1000 ? captures.has(id) : has(id));
    stage.releasePointerCapture = (id) => {
      if (id < 1000) return release(id);
      captures.delete(id);
      stage.dispatchEvent(new PointerEvent('lostpointercapture', { pointerId: id, bubbles: true }));
    };
  });
  return (await page.getByTestId('stage').boundingBox())!;
}
async function points(page: Page, type: string, contacts: Array<[number, Point]>) {
  await page.getByTestId('stage').evaluate(
    (stage, { type, contacts }) => {
      for (const [pointerId, point] of contacts)
        stage.dispatchEvent(
          new PointerEvent(type, {
            pointerId,
            pointerType: 'touch',
            isPrimary: pointerId === 1000,
            button: 0,
            buttons: type === 'pointerup' || type === 'pointercancel' ? 0 : 1,
            clientX: point.x,
            clientY: point.y,
            bubbles: true,
            cancelable: true,
          }),
        );
    },
    { type, contacts },
  );
}
async function zoom(page: Page) {
  return Number(await page.getByTestId('stage').getAttribute('data-zoom'));
}
export function pinchRegressionTests() {
  for (const mode of ['Split Screen', 'Side-by-Side']) {
    test(`${mode}: compatibility events cannot overwrite an active or completed pinch`, async ({
      page,
    }) => {
      const box = await openViewer(page, mode);
      const a = { x: box.x + 110, y: box.y + 150 },
        b = { x: a.x, y: a.y + 100 };
      await points(page, 'pointerdown', [
        [1000, a],
        [1001, b],
      ]);
      await points(page, 'pointermove', [[1001, { ...b, y: b.y + 50 }]]);
      await expect.poll(() => zoom(page)).toBeCloseTo(1.5, 6);

      await page.getByTestId('stage').dispatchEvent('wheel', { deltaY: -300, ctrlKey: true });
      await expect.poll(() => zoom(page)).toBeCloseTo(1.5, 6);
      await page.getByTestId('stage').dispatchEvent('dblclick');
      await expect.poll(() => zoom(page)).toBeCloseTo(1.5, 6);
      await points(page, 'pointerup', [
        [1001, b],
        [1000, a],
      ]);
      await page.getByTestId('stage').dispatchEvent('dblclick');
      await expect.poll(() => zoom(page)).toBeCloseTo(1.5, 6);
      await expect(page.getByTestId('stage')).not.toHaveClass(/panning/);
      await page.getByTestId('stage').dblclick({ position: { x: 70, y: 120 } });
      await expect.poll(() => zoom(page)).toBeCloseTo(1, 6);
      await page.getByTestId('stage').dispatchEvent('wheel', { deltaY: 100 });
      await expect.poll(() => zoom(page)).toBeCloseTo(Math.exp(-0.15), 6);
    });
  }
  for (const mode of ['Split Screen', 'Side-by-Side']) {
    test(`${mode}: slow and batched pinch streams retain proportional scale and midpoint`, async ({
      page,
    }) => {
      test.setTimeout(60000);
      const box = await openViewer(page, mode);
      for (let round = 0; round < 4; round++) {
        const x = box.x + box.width * (round % 2 ? 0.75 : 0.25),
          y = box.y + 180;
        const a = { x, y: y - 50 },
          b = { x, y: y + 50 };
        const image = page.getByTestId(
          mode === 'Side-by-Side' && round % 2 ? 'image-B' : 'image-A',
        );
        const before = (await image.boundingBox())!;
        const source = { x: (x - before.x) / before.width, y: (y - before.y) / before.height };
        await points(page, 'pointerdown', [
          [1000, a],
          [1001, b],
        ]);
        const frames = Array.from({ length: 24 }, (_, index) => {
          const spread = index < 12 ? index + 1 : 23 - index;
          return [
            [1000, { x: x + spread / 2, y: y - 50 - spread * 2 }],
            [1001, { x: x + spread / 2, y: y + 50 + spread * 2 }],
          ] as Array<[number, Point]>;
        });
        if (round % 2) {
          // Dispatch the entire stream in one browser task to exercise queued React updates.
          await page.getByTestId('stage').evaluate((stage, frames) => {
            for (const frame of frames)
              for (const [pointerId, point] of frame)
                stage.dispatchEvent(
                  new PointerEvent('pointermove', {
                    pointerId,
                    pointerType: 'touch',
                    clientX: point.x,
                    clientY: point.y,
                    buttons: 1,
                    bubbles: true,
                  }),
                );
          }, frames);
        } else {
          for (let index = 0; index < frames.length; index++) {
            await points(page, 'pointermove', frames[index]);
            const spread = index < 12 ? index + 1 : 23 - index;
            await expect.poll(() => zoom(page)).toBeCloseTo((100 + spread * 4) / 100, 6);
            const current = (await image.boundingBox())!;
            expect(
              Math.abs(current.x + source.x * current.width - (x + spread / 2)),
            ).toBeLessThanOrEqual(1.1);
            expect(Math.abs(current.y + source.y * current.height - y)).toBeLessThanOrEqual(1.1);
          }
        }
        await expect.poll(() => zoom(page)).toBeCloseTo(1, 6);
        await points(page, 'pointerup', [
          [1000, a],
          [1001, b],
        ]);
        await expect(page.getByTestId('stage')).not.toHaveClass(/panning/);
      }
    });

    test(`${mode}: finger replacement, cancellation and capture loss rebase without stale movement`, async ({
      page,
    }) => {
      const box = await openViewer(page, mode);
      const a = { x: box.x + 90, y: box.y + 150 };
      let b = { x: a.x, y: a.y + 100 };
      await points(page, 'pointerdown', [
        [1000, a],
        [1001, b],
      ]);
      b = { ...b, y: b.y + 100 };
      await points(page, 'pointermove', [[1001, b]]);
      await expect.poll(() => zoom(page)).toBeCloseTo(2, 6);
      await points(page, 'pointerup', [[1000, a]]);
      const before = (await page.getByTestId('image-A').boundingBox())!;
      b = { x: b.x + 10, y: b.y + 15 };
      await points(page, 'pointermove', [[1001, b]]);
      const moved = (await page.getByTestId('image-A').boundingBox())!;
      expect(moved.x - before.x).toBeCloseTo(10, 3);
      expect(moved.y - before.y).toBeCloseTo(15, 3);
      let c = { x: b.x, y: b.y + 100 };
      await points(page, 'pointerdown', [[1002, c]]);
      expect(await page.getByTestId('image-A').boundingBox()).toEqual(moved);
      c = { ...c, y: c.y + 25 };
      await points(page, 'pointermove', [[1002, c]]);
      await expect.poll(() => zoom(page)).toBeCloseTo(2.5, 6);
      await points(page, 'pointerdown', [[1003, { x: c.x + 40, y: c.y }]]);
      await points(page, 'pointermove', [[1003, { x: c.x + 60, y: c.y }]]);
      await expect.poll(() => zoom(page)).toBeCloseTo(2.5, 6);
      await points(page, 'pointercancel', [
        [1001, b],
        [1002, c],
      ]);
      await page.getByTestId('stage').evaluate((stage) => stage.releasePointerCapture(1003));
      await expect(page.getByTestId('stage')).not.toHaveClass(/panning/);
      const stopped = await page.getByTestId('image-A').boundingBox();
      await points(page, 'pointermove', [
        [1001, a],
        [1002, a],
        [1003, a],
      ]);
      expect(await page.getByTestId('image-A').boundingBox()).toEqual(stopped);
      expect(
        await page
          .getByTestId('stage')
          .evaluate((stage) => [1000, 1001, 1002, 1003].some((id) => stage.hasPointerCapture(id))),
      ).toBe(false);
      await points(page, 'pointerdown', [
        [1000, a],
        [1001, { ...a, y: a.y + 100 }],
      ]);
      await points(page, 'pointermove', [[1001, { ...a, y: a.y + 120 }]]);
      await expect.poll(() => zoom(page)).toBeCloseTo(3, 6);
      await page.evaluate(() => window.dispatchEvent(new Event('blur')));
      await expect(page.getByTestId('stage')).not.toHaveClass(/panning/);
    });
  }
  test('Side-by-Side: a pinch midpoint crossing the seam keeps the same image anchor', async ({
    page,
  }) => {
    const box = await openViewer(page, 'Side-by-Side');
    const x = box.x + box.width / 2 - 25,
      y = box.y + 160;
    const a = { x, y },
      b = { x, y: y + 100 };
    const before = (await page.getByTestId('image-A').boundingBox())!;
    await points(page, 'pointerdown', [
      [1000, a],
      [1001, b],
    ]);
    await points(page, 'pointermove', [
      [1000, { ...a, x: x + 40 }],
      [1001, { ...b, x: x + 40 }],
    ]);
    await expect.poll(() => zoom(page)).toBeCloseTo(1, 6);
    const after = (await page.getByTestId('image-A').boundingBox())!;
    expect(after.x - before.x).toBeCloseTo(40, 2);
    expect(after.y - before.y).toBeCloseTo(0, 2);
  });
}
