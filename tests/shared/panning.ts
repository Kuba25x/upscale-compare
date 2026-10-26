import { test, expect, type Page } from '@playwright/test';
import { imageFile } from '../e2e/fixtures';

async function openViewer(page: Page) {
  await page.goto('./');
  await page.getByTestId('file-input').setInputFiles([imageFile(), imageFile('FSR.png', 1)]);
  await expect(page.getByTestId('stage')).toBeVisible();
  await page.evaluate(() => {
    const events: string[] = [];
    (window as unknown as { nativeDrags: string[] }).nativeDrags = events;
    document.addEventListener('dragstart', (event) => {
      if ((event.target as Element).closest('[data-testid="stage"]') && !event.defaultPrevented)
        events.push((event.target as Element).className);
    });
  });
}
async function pan(page: Page, x: number, y: number, dx = 36, dy = 22) {
  const a = page.getByTestId('image-A'),
    b = page.getByTestId('image-B');
  const beforeA = await a.boundingBox(),
    beforeB = await b.boundingBox();
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx, y + dy, { steps: 4 });
  await page.mouse.up();
  const afterA = await a.boundingBox(),
    afterB = await b.boundingBox();
  expect(afterA!.x - beforeA!.x).toBeCloseTo(dx, 3);
  expect(afterA!.y - beforeA!.y).toBeCloseTo(dy, 3);
  expect(afterB!.x - beforeB!.x).toBeCloseTo(dx, 3);
  expect(afterB!.y - beforeB!.y).toBeCloseTo(dy, 3);
  await expect(page.getByTestId('stage')).not.toHaveClass(/panning/);
  await expect(page.getByTestId('stage')).toBeFocused();
  const stopped = await a.boundingBox();
  await page.mouse.move(x + dx + 12, y + dy + 12);
  expect(await a.boundingBox()).toEqual(stopped);
}
async function noNativeDrag(page: Page) {
  expect(
    await page.evaluate(() => (window as unknown as { nativeDrags: string[] }).nativeDrags),
  ).toEqual([]);
}
export function panningRegressionTests() {
  test('rapid clicks cannot start native dragging during repeated panning and mode changes', async ({
    page,
  }) => {
    test.setTimeout(60000);
    await openViewer(page);
    await page.getByLabel('Label for image A').fill('Custom DLSS');
    const initial = await page.getByTestId('stage').boundingBox();
    await pan(page, initial!.x + 120, initial!.y + 130);
    await page.keyboard.press('2');
    await expect(page.getByTestId('stage')).toHaveAttribute('data-zoom', '2');
    for (let round = 0; round < 2; round++) {
      for (const mode of ['Split Screen', 'Side-by-Side']) {
        await page.getByRole('button', { name: mode, exact: true }).click();
        for (const zoom of ['100%', '200%', '400%']) {
          const stage = await page.getByTestId('stage').boundingBox();
          for (const fraction of [0.25, 0.75]) {
            await page.getByRole('button', { name: zoom, exact: true }).click();
            const x = Math.round(stage!.x + stage!.width * fraction),
              y = Math.round(stage!.y + stage!.height * 0.4);
            // A real multi-click creates a browser selection on the unfixed viewer.
            if ((round === 0) === (fraction === 0.25))
              await page.mouse.click(x, y, { clickCount: 3 });
            const direction = round ? -1 : 1;
            await pan(page, x, y, 36 * direction, 22 * direction);
            await noNativeDrag(page);
          }
        }
      }
    }
  });

  test('an existing document selection cannot replace panning with a native drag', async ({
    page,
  }) => {
    await openViewer(page);
    for (const mode of ['Split Screen', 'Side-by-Side']) {
      await page.getByRole('button', { name: mode, exact: true }).click();
      await page.getByRole('button', { name: '200%', exact: true }).click();
      await page.locator('.comparison-layout').evaluate((element) => {
        const range = document.createRange();
        range.selectNodeContents(element);
        const selection = getSelection()!;
        selection.removeAllRanges();
        selection.addRange(range);
      });
      const stage = await page.getByTestId('stage').boundingBox();
      await pan(page, stage!.x + 120, stage!.y + 130);
      await noNativeDrag(page);
    }
  });

  test('interrupted pointer gestures release capture and never leave phantom panning', async ({
    page,
  }) => {
    await openViewer(page);
    const stage = page.getByTestId('stage');
    await stage.evaluate((element) =>
      element.addEventListener('pointerdown', (event) =>
        element.setAttribute('data-test-pointer-id', String((event as PointerEvent).pointerId)),
      ),
    );
    const bounds = await stage.boundingBox(),
      x = bounds!.x + 120,
      y = bounds!.y + 130;
    for (const interruption of ['pointercancel', 'lostpointercapture', 'blur', 'buttons']) {
      await page.mouse.move(x, y);
      await page.mouse.down();
      await expect(stage).toHaveClass(/panning/);
      const id = Number(await stage.getAttribute('data-test-pointer-id'));
      await stage.evaluate(
        (element, { kind, id }) => {
          if (kind === 'blur') window.dispatchEvent(new Event('blur'));
          else if (kind === 'lostpointercapture') element.releasePointerCapture(id);
          else
            element.dispatchEvent(
              new PointerEvent(kind === 'buttons' ? 'pointermove' : 'pointercancel', {
                bubbles: true,
                pointerId: id,
                pointerType: 'mouse',
                buttons: 0,
                clientX: 100,
                clientY: 100,
              }),
            );
        },
        { kind: interruption, id },
      );
      await page.mouse.move(x + 5, y + 5);
      await expect(stage, `Panning must stop after ${interruption}`).not.toHaveClass(/panning/);
      expect(
        await stage.evaluate((element, pointerId) => element.hasPointerCapture(pointerId), id),
      ).toBe(false);
      const stopped = await page.getByTestId('image-A').boundingBox();
      await page.mouse.move(x + 45, y + 35);
      expect(await page.getByTestId('image-A').boundingBox()).toEqual(stopped);
      await page.mouse.up();
      await pan(page, x, y);
    }
  });

  test('native dragstart is canceled on all image layers while external file drops still upload', async ({
    page,
  }) => {
    await openViewer(page);
    for (const mode of ['Split Screen', 'Side-by-Side']) {
      await page.getByRole('button', { name: mode, exact: true }).click();
      for (const side of ['A', 'B']) {
        expect(
          await page.getByTestId(`image-${side}`).evaluate((element) =>
            element.dispatchEvent(
              new DragEvent('dragstart', {
                bubbles: true,
                cancelable: true,
                dataTransfer: new DataTransfer(),
              }),
            ),
          ),
        ).toBe(false);
      }
      await noNativeDrag(page);
    }
    const file = imageFile('Dropped Native.png');
    const accepted = await page.getByTestId('stage').evaluate(
      (element, data) => {
        const transfer = new DataTransfer();
        transfer.items.add(
          new File([new Uint8Array(data)], 'Dropped Native.png', { type: 'image/png' }),
        );
        element.dispatchEvent(
          new DragEvent('dragenter', { bubbles: true, cancelable: true, dataTransfer: transfer }),
        );
        return !element.dispatchEvent(
          new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: transfer }),
        );
      },
      [...file.buffer],
    );
    expect(accepted).toBe(true);
    await expect(page.locator('.drop-overlay')).toBeVisible();
    await page.getByTestId('stage').evaluate(
      (element, data) => {
        const transfer = new DataTransfer();
        transfer.items.add(
          new File([new Uint8Array(data)], 'Dropped Native.png', { type: 'image/png' }),
        );
        element.dispatchEvent(
          new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer }),
        );
      },
      [...file.buffer],
    );
    await expect(page.getByLabel('Select image A').locator('option')).toHaveCount(3);
    await expect(page.locator('.drop-overlay')).toHaveCount(0);
    await page.getByLabel('Select image A').selectOption('2');
    await expect(page.locator('.badge-a')).toContainText('Dropped Native');
    const stage = await page.getByTestId('stage').boundingBox();
    await pan(page, stage!.x + 120, stage!.y + 130);
  });
}
