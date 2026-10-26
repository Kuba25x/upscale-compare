import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { readFile, writeFile } from 'node:fs/promises';
const require = createRequire(import.meta.url);
const notices = [
  'Upscale Compare — third-party runtime licenses\n\nUpscale Compare is distributed under AGPL-3.0. The following components retain their respective licenses.\n',
];
for (const name of ['react', 'react-dom', 'scheduler', 'lucide-react', 'zod']) {
  const directory = dirname(require.resolve(`${name}/package.json`));
  const metadata = JSON.parse(await readFile(join(directory, 'package.json'), 'utf8'));
  const license = await readFile(join(directory, 'LICENSE'), 'utf8');
  notices.push(
    `${'='.repeat(72)}\n${name} ${metadata.version} — ${metadata.license}\n${'='.repeat(72)}\n\n${license.trim()}\n`,
  );
}
await writeFile('public/third-party-licenses.txt', `${notices.join('\n')}\n`);
