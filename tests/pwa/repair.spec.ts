import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { serve, control, cacheSnapshot } from './helpers';

test('documented repair is scoped and preserves unrelated caches and publication keys', async ({
  page,
  request,
  baseURL,
}) => {
  const documentation = await readFile('docs/DEPLOYMENT.md', 'utf8');
  const repair = documentation.match(/<!-- pwa-scoped-repair -->\s*```js\n([\s\S]*?)```/)?.[1];
  expect(repair).toBeTruthy();
  await serve(request);
  await page.goto(baseURL!);
  await control(page);
  const foreign = await page.evaluate(async () => {
    const name = `foreign-precache-${location.href}`;
    await (await caches.open(name)).put('/foreign-data', new Response('keep me'));
    localStorage.setItem('upscale-compare:delete:sentinel', 'keep deletion key');
    localStorage.setItem('upscale-compare:publication:sentinel', 'keep journal');
    return name;
  });
  const before = await cacheSnapshot(page);
  if (new URL(baseURL!).pathname === '/') {
    await expect(page.evaluate(repair!)).rejects.toThrow('Open the Upscale Compare Pages app');
    expect(await cacheSnapshot(page)).toEqual(before);
  } else {
    await page.evaluate(repair!);
    expect(Object.keys(await cacheSnapshot(page))).toEqual([foreign]);
  }
  expect(
    await page.evaluate(
      async (name) => ({
        foreign: await (await (await caches.open(name)).match('/foreign-data'))!.text(),
        deletion: localStorage.getItem('upscale-compare:delete:sentinel'),
        journal: localStorage.getItem('upscale-compare:publication:sentinel'),
      }),
      foreign,
    ),
  ).toEqual({ foreign: 'keep me', deletion: 'keep deletion key', journal: 'keep journal' });
});
