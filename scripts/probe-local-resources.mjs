import { build } from 'esbuild';
import { mkdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
if (process.argv.length !== 2)
  throw new Error('The local resource probe accepts no arguments or remote targets.');
await mkdir('.wrangler/operations', { recursive: true });
await build({
  entryPoints: ['scripts/local-resource-probe.ts'],
  outfile: '.wrangler/operations/local-resource-probe.mjs',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
});
execFileSync(process.execPath, ['--expose-gc', '.wrangler/operations/local-resource-probe.mjs'], {
  stdio: 'inherit',
});
