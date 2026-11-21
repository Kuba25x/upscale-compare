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
