import { expect, type Page } from '@playwright/test';

export async function expectCenteredBrand(page: Page) {
  const heading = page.getByRole('heading', { name: 'Upscale Compare', exact: true });
  await expect(heading).toBeVisible();
  await expect
    .poll(() =>
      heading.evaluate((node) => {
        const header = node.closest('.app-header')!;
        const { left, right } = header.getBoundingClientRect();
        const { paddingLeft, paddingRight } = getComputedStyle(header);
        const logo = node.querySelector('.brand-mark')!.getBoundingClientRect();
        const title = node.querySelector('.brand-name')!.getBoundingClientRect();
        const center = (left + parseFloat(paddingLeft) + right - parseFloat(paddingRight)) / 2;
        return Math.abs((logo.left + title.right) / 2 - center);
      }),
    )
    .toBeLessThan(1);
}

export async function expectSplitPosition(page: Page, percent: number) {
  const slider = page.getByRole('slider', { name: 'Comparison divider' });
  await expect(slider).toHaveAttribute('aria-valuenow', String(Math.round(percent)));
  await expect
    .poll(() =>
      slider.evaluate((node, expectedPercent) => {
        const stage = node.parentElement!.getBoundingClientRect();
        const track = node.getBoundingClientRect();
        const handle = node.querySelector('.divider-handle')!.getBoundingClientRect();
        const line = getComputedStyle(node, '::before');
        const [a, b] = Array.from(node.parentElement!.querySelectorAll('.split-layer'), (layer) => {
          const rect = layer.getBoundingClientRect();
          const [top, right = top, , left = right] = getComputedStyle(layer)
            .clipPath.slice('inset('.length, -1)
            .split(/\s+/);
          const pixels = (length: string) =>
            length.endsWith('%') ? (parseFloat(length) / 100) * rect.width : parseFloat(length);
          return { left: rect.left + pixels(left), right: rect.right - pixels(right) };
        });
        const expected = stage.left + (stage.width * expectedPercent) / 100;
        return Math.max(
          ...[
            a.right,
            b.left,
            track.left + parseFloat(line.left) + parseFloat(line.width) / 2,
            handle.left + handle.width / 2,
          ].map((x) => Math.abs(x - expected)),
          Math.abs(a.left - stage.left),
          Math.abs(b.right - stage.right),
          Math.abs(node.parentElement!.scrollLeft),
        );
      }, percent),
    )
    .toBeLessThan(0.05);
}

export async function expectSplitRange(page: Page) {
  const slider = page.getByRole('slider', { name: 'Comparison divider' });
  await slider.focus();
  for (const [edgeKey, arrow, edge, direction] of [
    ['Home', 'ArrowRight', 0, 1],
    ['End', 'ArrowLeft', 100, -1],
  ] as const) {
    await slider.press(edgeKey);
    await expectSplitPosition(page, edge);
    for (let step = 1; step <= 5; step++) {
      await slider.press(arrow);
      if (step <= 2 || step === 5) await expectSplitPosition(page, edge + direction * step);
    }
  }
  await slider.press('Home');
  for (let step = 0; step < 5; step++) await slider.press('Shift+ArrowRight');
  await expectSplitPosition(page, 50);
}

export async function expectCenteredDividerArrows(page: Page) {
  const divider = page.getByRole('slider', { name: 'Comparison divider' });
  const handle = divider.locator('.divider-handle');
  await expect(handle).toHaveText('');
  await expect(handle.locator(':scope > *')).toHaveCount(2);
  await expect(handle.locator('svg.lucide-chevron-left')).toBeVisible();
  await expect(handle.locator('svg.lucide-chevron-right')).toBeVisible();
  const { center, arrows, line } = await handle.evaluate((node) => {
    const midpoint = (element: Element) => {
      const { x, y, width, height } = element.getBoundingClientRect();
      return { x: x + width / 2, y: y + height / 2 };
    };
    const divider = node.parentElement!;
    const line = getComputedStyle(divider, '::before');
    return {
      center: midpoint(node),
      arrows: Array.from(node.querySelectorAll('svg path'), midpoint),
      line: {
        content: line.content,
        width: line.width,
        height: parseFloat(line.height),
        stageHeight: divider.parentElement!.getBoundingClientRect().height,
      },
    };
  });
  const [left, right] = arrows;
  expect(left.x).toBeLessThan(center.x);
  expect(right.x).toBeGreaterThan(center.x);
  expect(Math.abs((left.x + right.x) / 2 - center.x)).toBeLessThan(1);
  expect(Math.abs(left.y - center.y)).toBeLessThan(1);
  expect(Math.abs(right.y - center.y)).toBeLessThan(1);
  expect(line.content).toBe('""');
  expect(line.width).toBe('1px');
  expect(Math.abs(line.height - line.stageHeight)).toBeLessThan(1);
}
