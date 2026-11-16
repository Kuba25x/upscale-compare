import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { readFile, writeFile } from 'node:fs/promises';
const require = createRequire(import.meta.url);
// These modules supply the generated worker. Build tooling/window registration is not shipped.
export const workboxRuntimePackages = [
  'workbox-core',
  'workbox-precaching',
  'workbox-routing',
  'workbox-strategies',
];
export async function runtimeNotices(includeWorkbox = false) {
  const notices = [
    'Upscale Compare — third-party runtime licenses\n\nUpscale Compare is distributed under AGPL-3.0. The following components retain their respective licenses.\n',
  ];
  for (const name of [
    'react',
    'react-dom',
    'scheduler',
    'lucide-react',
    'zod',
    ...(includeWorkbox ? workboxRuntimePackages : []),
  ]) {
    const directory = dirname(require.resolve(`${name}/package.json`));
    const metadata = JSON.parse(await readFile(join(directory, 'package.json'), 'utf8'));
    const license = await readFile(join(directory, 'LICENSE'), 'utf8');
    notices.push(
      `${'='.repeat(72)}\n${name} ${metadata.version} — ${metadata.license}\n${'='.repeat(72)}\n\n${license.trim()}\n`,
    );
    try {
      notices.push(await readFile(join(directory, 'NOTICE'), 'utf8'));
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  return `${notices.join('\n')}\n`;
}

// Keep the tracked, shared notices identical for Android and normal source preparation.
// Web builds emit an extended copy before Workbox computes the precache revision.
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await writeFile('public/third-party-licenses.txt', await runtimeNotices());
}
