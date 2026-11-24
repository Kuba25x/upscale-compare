import { expect, type Page } from '@playwright/test';
import { PNG } from 'pngjs';

export const mismatch = (page: Page) => page.getByRole('dialog', { name: 'Image size mismatch' });

export async function applyAlignment(page: Page, mode: string) {
  const dialog = mismatch(page);
  await dialog.getByRole('radio', { name: mode }).check();
  await dialog.getByRole('button', { name: 'Apply', exact: true }).click();
  await expect(dialog).toHaveCount(0);
}

export async function changeAlignment(page: Page, mode: string) {
  await page.getByRole('button', { name: 'Manage Images', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Your images' });
  await dialog.getByRole('radio', { name: mode }).check();
  await dialog.getByRole('button', { name: 'Close dialog', exact: true }).click();
  await expect(mismatch(page)).toHaveCount(0);
}

export async function geometry(page: Page) {
  return page.getByTestId('stage').evaluate((stage) => {
    function rect(node: Element) {
      const { x, y, width, height } = node.getBoundingClientRect();
      return { x, y, width, height };
    }
    function image(which: string) {
      const node = stage.querySelector<HTMLImageElement>(`[data-testid=image-${which}]`)!;
      return { ...rect(node), naturalWidth: node.naturalWidth, naturalHeight: node.naturalHeight };
    }
    return { a: image('A'), b: image('B'), stage: rect(stage), dpr: devicePixelRatio };
  });
}

export async function expectAligned(page: Page, factor: number, side = false, zoom?: number) {
  await expect
    .poll(async () => {
      const { a, b, stage, dpr } = await geometry(page);
      const scale = a.width / a.naturalWidth;
      const panelWidth = side ? (stage.width - 1) / 2 : stage.width;
      const expected =
        zoom === undefined
          ? Math.min(
              panelWidth / Math.max(a.naturalWidth, b.naturalWidth * factor),
              stage.height / Math.max(a.naturalHeight, b.naturalHeight * factor),
            )
          : zoom / dpr;
      return Math.max(
        Math.abs(a.width - a.naturalWidth * expected),
        Math.abs(a.height - a.naturalHeight * expected),
        Math.abs(b.width - b.naturalWidth * factor * expected),
        Math.abs(b.height - b.naturalHeight * factor * expected),
        Math.abs(b.x - a.x - (side ? panelWidth + 1 : 0)),
        Math.abs(b.y - a.y),
        Math.abs(scale - expected),
      );
    })
    .toBeLessThan(side ? 1 : 0.04);
}

export function solidImage(name: string, width: number, height: number, rgb: number[]) {
  const image = new PNG({ width, height });
  for (let i = 0; i < image.data.length; i += 4) image.data.set([...rgb, 255], i);
  return { name, mimeType: 'image/png', buffer: PNG.sync.write(image) };
}

export function pixelAt(image: PNG, x: number, y: number) {
  const index = (Math.floor(x) + Math.floor(y) * image.width) * 4;
  return [...image.data.subarray(index, index + 3)];
}

export async function storedComparison(page: Page, baseURL = '/') {
  return page.evaluate(async (scope) => {
    const result = <T>(request: IDBRequest<T>) =>
      new Promise<T>((resolve, reject) => {
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
    const path = new URL(scope, location.href).pathname;
    const database = await result(indexedDB.open(`upscale-compare:session:${path}`, 1));
    try {
      const transaction = database.transaction(['state', 'originals']);
      const [state, originals] = await Promise.all([
        result(transaction.objectStore('state').get('current')),
        result(transaction.objectStore('originals').count()),
      ]);
      return { session: state?.session, originals };
    } finally {
      database.close();
    }
  }, baseURL);
}
