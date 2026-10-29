import { afterEach, expect, it } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const directories: string[] = [];
function generate(cpu = '') {
  const directory = mkdtempSync(join(tmpdir(), 'upscale-production-guards-'));
  directories.push(directory);
  mkdirSync(join(directory, 'worker'));
  const result = spawnSync(process.execPath, [resolve('scripts/prepare-production.mjs')], {
    cwd: directory,
    encoding: 'utf8',
    env: {
      D1_ID: '00000000-0000-0000-0000-000000000000',
      BUCKET: 'private-test-bucket',
      FRONTEND_URL: 'https://viewer.example/upscale-compare/',
      APPROVED_PAID_CPU_MS: cpu,
    },
  });
  return { result, directory };
}
afterEach(() => {
  for (const path of directories.splice(0)) rmSync(path, { recursive: true, force: true });
});
it('generates a closed production configuration without public bypass hostnames, logs or plan selection', () => {
  const { result, directory } = generate();
  expect(result.status).toBe(0);
  const config = JSON.parse(
    readFileSync(join(directory, 'worker/wrangler.production.json'), 'utf8'),
  );
  expect(config).toMatchObject({
    workers_dev: false,
    preview_urls: false,
    observability: { enabled: false },
    triggers: { crons: [] },
    vars: { ENVIRONMENT: 'production', UPLOADS_ENABLED: 'false' },
  });
  expect(config.limits).toBeUndefined();
  expect(config.usage_model).toBeUndefined();
  expect(config.routes).toBeUndefined();
});
it.each(['50', '0', '-1', '1001', 'NaN', '1.5', '9007199254740992'])(
  'refuses every paid CPU override under the Free-only policy: %s',
  (cap) => {
    expect(generate(cap).result.status).not.toBe(0);
  },
);
it('refuses remote or extra arguments to the local-only budget bootstrap before invoking Wrangler', () => {
  expect(() =>
    execFileSync(process.execPath, ['scripts/configure-local-controls.mjs', '--remote'], {
      stdio: 'pipe',
    }),
  ).toThrow();
});
