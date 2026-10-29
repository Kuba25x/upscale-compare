import { afterEach, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, copyFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
const plan = JSON.parse(readFileSync('ops/production-readiness.json', 'utf8'));
const directories: string[] = [];
afterEach(() => {
  for (const path of directories.splice(0)) rmSync(path, { recursive: true, force: true });
});
function guard(record = plan, args: string[] = [], overrides: Record<string, string> = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'upscale-operations-'));
  directories.push(directory);
  for (const sub of ['scripts', 'ops']) mkdirSync(join(directory, sub));
  copyFileSync(
    'scripts/production-readiness.mjs',
    join(directory, 'scripts/production-readiness.mjs'),
  );
  writeFileSync(join(directory, 'ops/production-readiness.json'), JSON.stringify(record));
  return spawnSync(
    process.execPath,
    [join(directory, 'scripts/production-readiness.mjs'), ...args],
    {
      encoding: 'utf8',
      env: { ...process.env, ...overrides },
    },
  );
}
it('locks production to the owner-selected zero-charge Free constraints', () => {
  expect(plan.policy).toEqual({
    maximumChargeUsd: 0,
    workersPlan: 'Free',
    d1Plan: 'Free',
    r2StorageClass: 'Standard',
    workersCpuMs: 10,
    workersMemoryMb: 128,
    subrequestsPerInvocation: 50,
  });
  const result = guard();
  expect(result.status).toBe(1);
  for (const blocker of plan.blockers) expect(result.stderr).toContain(blocker.id);
});
it.each([
  { ...plan, status: 'ready' },
  { ...plan, blockers: [] },
  { ...plan, policy: { ...plan.policy, workersPlan: 'Paid' } },
  { ...plan, policy: { ...plan.policy, maximumChargeUsd: 1 } },
  { ...plan, policy: { ...plan.policy, workersCpuMs: 50 } },
])('cannot unlock deployment by changing only a readiness record', (record) => {
  expect(guard(record).status).toBe(1);
});
it.each(['--force', '--approve', '--remote'])('rejects guard override argument %s', (arg) => {
  expect(guard(plan, [arg]).status).toBe(1);
});
it('does not accept environment assertions as resource evidence or spending approval', () => {
  expect(
    guard(plan, [], { PRODUCTION_READY: 'true', APPROVED_PAID_CPU_MS: '50', R2_BUDGET_USD: '0' })
      .status,
  ).toBe(1);
});
it('places the production guard before installs, checks, remote actions and secrets', () => {
  for (const file of ['deploy-worker.yml', 'deploy-pages.yml']) {
    const workflow = readFileSync('.github/workflows/' + file, 'utf8');
    expect(workflow).toContain("github.ref == 'refs/heads/main'");
    const guard = workflow.indexOf('run: node scripts/production-readiness.mjs');
    expect(guard).toBeGreaterThan(0);
    expect(guard).toBeLessThan(workflow.indexOf('run: npm ci'));
    expect(guard).toBeLessThan(workflow.indexOf('npm run test:sharing:local'));
    if (file === 'deploy-worker.yml') {
      expect(workflow).not.toContain('migrations apply');
      expect(workflow).not.toContain('APPROVED_PAID_CPU_MS');
      expect(guard).toBeLessThan(workflow.indexOf('secrets.CLOUDFLARE_API_TOKEN'));
    } else {
      expect(workflow).toContain(
        "if: inputs.deployment_mode == 'production'\n        run: node scripts/production-readiness.mjs",
      );
      expect(workflow).toContain('default: demo');
    }
  }
});

it('refuses remote targets on the offline resource probe before constructing inputs', () => {
  const result = spawnSync(process.execPath, ['scripts/probe-local-resources.mjs', '--remote'], {
    encoding: 'utf8',
  });
  expect(result.status).not.toBe(0);
  expect(result.stderr).toContain('accepts no arguments or remote targets');
});
