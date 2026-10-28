import { execFileSync } from 'node:child_process';
const args = process.argv.slice(2);
if (
  args.length &&
  (args.length !== 2 || args[0] !== '--persist-to' || !args[1] || args[1].startsWith('-'))
)
  throw new Error(
    'Only an optional --persist-to <local-directory> is supported. This command always uses --local.',
  );
execFileSync(
  process.execPath,
  [
    'node_modules/wrangler/bin/wrangler.js',
    'd1',
    'execute',
    'upscale-compare',
    '--local',
    '--config',
    'worker/wrangler.jsonc',
    '--file',
    'worker/local-controls.sql',
    ...args,
  ],
  { stdio: 'inherit' },
);
