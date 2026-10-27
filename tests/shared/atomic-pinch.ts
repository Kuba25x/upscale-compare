import { test, expect, type Page } from '@playwright/test';
import { openViewer, points } from './pinch';
type Contact = { id: number; x: number; y: number; divider?: boolean };
export async function touchSnapshot(page: Page, type: string, contacts: Contact[]) {
  await page.getByTestId('stage').evaluate(
    (stage, { type, contacts }) => {
      // Touch constructors are not available in every desktop engine. These are handler replays,
      // not a claim of native Android execution. Touch IDs intentionally differ from Pointer IDs.
      const touches = contacts.map((point) => ({
        identifier: point.id,
        clientX: point.x,
        clientY: point.y,
        pageX: point.x,
        pageY: point.y,
        target: point.divider ? stage.querySelector('[role="slider"]')! : stage,
      }));
      const event = new Event(type, { bubbles: true, cancelable: true });
      Object.defineProperties(event, {
        touches: { value: touches },
        targetTouches: { value: touches },
        changedTouches: { value: touches },
      });
      stage.dispatchEvent(event);
    },
    { type, contacts },
  );
}
async function zoom(page: Page) {
  return Number(await page.getByTestId('stage').getAttribute('data-zoom'));
}
export function atomicPinchTests() {
  for (const mode of ['Split Screen', 'Side-by-Side']) {
    test(`${mode}: complete touch snapshots prevent the secondary-pointer catch-up jump from device logs`, async ({
      page,
    }) => {
      const box = await openViewer(page, mode);
      const a = { id: 10, x: box.x + box.width * 0.75, y: box.y + 350 };
      const b = { id: 20, x: a.x - 32, y: box.y + 186 };
      const span = Math.hypot(a.x - b.x, a.y - b.y);
      const image = page.getByTestId(mode === 'Split Screen' ? 'image-A' : 'image-B');
      const before = (await image.boundingBox())!;
      const midpoint = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const source = {
        x: (midpoint.x - before.x) / before.width,
        y: (midpoint.y - before.y) / before.height,
      };
      await points(page, 'pointerdown', [[1000, a]]);
      await touchSnapshot(page, 'touchstart', [a]);
      await points(page, 'pointerdown', [[1001, b]]);
      await touchSnapshot(page, 'touchstart', [a, b]);
      let currentA = a,
        currentB = b;
      for (let frame = 1; frame <= 12; frame++) {
        currentA = { ...a, x: a.x - frame / 20, y: a.y - frame / 20 };
        currentB = { ...b, x: b.x + frame * 2, y: b.y + frame * 6 };
        // Firefox log: only the primary pointer moves while TouchEvent already updates both.
        await points(page, 'pointermove', [[1000, currentA]]);
        await touchSnapshot(page, 'touchmove', [currentA, currentB]);
        const ratio = Math.hypot(currentA.x - currentB.x, currentA.y - currentB.y) / span;
        await expect.poll(() => zoom(page)).toBeCloseTo(ratio, 6);
        const rendered = (await image.boundingBox())!;
        expect(
          Math.abs(rendered.x + source.x * rendered.width - (currentA.x + currentB.x) / 2),
        ).toBeLessThanOrEqual(1.1);
        expect(
          Math.abs(rendered.y + source.y * rendered.height - (currentA.y + currentB.y) / 2),
        ).toBeLessThanOrEqual(1.1);
      }
      const beforeCatchUp = await image.boundingBox();
      await points(page, 'pointermove', [[1001, currentB]]);
      await touchSnapshot(page, 'touchmove', [currentB, currentA]); // TouchList order is not identity.
      expect(await image.boundingBox()).toEqual(beforeCatchUp);
      await points(page, 'pointerup', [
        [1000, currentA],
        [1001, currentB],
      ]);
      await touchSnapshot(page, 'touchend', []);
      await expect(page.getByTestId('stage')).not.toHaveClass(/panning/);
    });
    test(`${mode}: touch snapshots own motion through both pointer deliveries, contact changes and cancellation`, async ({
      page,
    }) => {
      const box = await openViewer(page, mode);
      let a = { id: 10, x: box.x + 70, y: box.y + 140 },
        b = { id: 20, x: box.x + 70, y: box.y + 220 };
      await points(page, 'pointerdown', [[1000, a]]);
      await touchSnapshot(page, 'touchstart', [a]);
      await points(page, 'pointerdown', [[1001, b]]);
      await touchSnapshot(page, 'touchstart', [a, b]);
      const initial = await page.getByTestId('image-A').boundingBox();
      a = { ...a, y: a.y - 20 };
      b = { ...b, y: b.y + 20 };
      // Chrome delivers both pointer updates; neither may apply zoom before the full touch frame.
      await points(page, 'pointermove', [
        [1000, a],
        [1001, b],
      ]);
      expect(await page.getByTestId('image-A').boundingBox()).toEqual(initial);
      await touchSnapshot(page, 'touchmove', [a, b]);
      await expect.poll(() => zoom(page)).toBeCloseTo(1.5, 6);
      await touchSnapshot(page, 'touchend', [b]); // A browser may end Touch before Pointer.
      await points(page, 'pointerup', [[1000, a]]);
      const before = (await page.getByTestId('image-A').boundingBox())!;
      b = { ...b, x: b.x + 12, y: b.y + 8 };
      await points(page, 'pointermove', [[1001, b]]);
      await touchSnapshot(page, 'touchmove', [b]);
      const after = (await page.getByTestId('image-A').boundingBox())!;
      expect(after.x - before.x).toBeCloseTo(12, 3);
      expect(after.y - before.y).toBeCloseTo(8, 3);
      let c = { id: 30, x: b.x, y: b.y + 80 };
      await points(page, 'pointerdown', [[1002, c]]);
      await touchSnapshot(page, 'touchstart', [c, b]);
      expect(await page.getByTestId('image-A').boundingBox()).toEqual(after);
      c = { ...c, y: c.y + 16 };
      await points(page, 'pointermove', [[1002, c]]);
      await touchSnapshot(page, 'touchmove', [b, c]);
      await expect.poll(() => zoom(page)).toBeCloseTo(1.8, 6);
      const d = { id: 40, x: b.x + 30, y: b.y + 100 };
      await touchSnapshot(page, 'touchstart', [d, c, b]);
      await touchSnapshot(page, 'touchmove', [{ ...d, x: d.x + 20 }, b, c]);
      await expect.poll(() => zoom(page)).toBeCloseTo(1.8, 6);
      await touchSnapshot(page, 'touchcancel', []);
      await expect(page.getByTestId('stage')).not.toHaveClass(/panning/);
      const stopped = await page.getByTestId('image-A').boundingBox();
      await touchSnapshot(page, 'touchmove', [a, b]);
      await points(page, 'pointermove', [[1001, { ...b, x: b.x + 40 }]]);
      expect(await page.getByTestId('image-A').boundingBox()).toEqual(stopped);
      // Mouse input must still pan after the browser's touch stream has been selected.
      await page.mouse.move(box.x + 70, box.y + 130);
      await page.mouse.down();
      await page.mouse.move(box.x + 85, box.y + 140, { steps: 3 });
      await page.mouse.up();
      const mouse = (await page.getByTestId('image-A').boundingBox())!;
      expect(mouse.x - stopped!.x).toBeCloseTo(15, 3);
      expect(mouse.y - stopped!.y).toBeCloseTo(10, 3);
    });
  }
}
