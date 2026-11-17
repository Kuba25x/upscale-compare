import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { build } from 'esbuild';
import {
  PICOMATCH_EXCEPTION as exception,
  evaluateAudit,
  parseAuditResult,
  assertNoRuntimePicomatch,
} from '../../scripts/dependency-audit-policy.mjs';

const recorded = JSON.parse(
  await readFile(new URL('./fixtures/picomatch-audit.json', import.meta.url), 'utf8'),
);
const lockText = await readFile('package-lock.json', 'utf8');
const inputs = Object.fromEntries(
  await Promise.all(
    Object.keys(exception.inputs).map(async (file) => [file, await readFile(file, 'utf8')]),
  ),
);
function report(findings = {}) {
  const counts = { info: 0, low: 0, moderate: 0, high: 0, critical: 0, total: 0 };
  for (const value of Object.values(findings)) {
    counts[value.severity]++;
    counts.total++;
  }
  return {
    auditReportVersion: 2,
    vulnerabilities: findings,
    metadata: { vulnerabilities: counts },
  };
}
function evaluate(overrides = {}) {
  return evaluateAudit({
    full: structuredClone(recorded),
    production: report(),
    lockText,
    latestVersion: '4.0.7',
    inputs,
    now: new Date('2026-11-17T20:00:00Z'),
    ...overrides,
  });
}
function other(severity = 'high', name = 'picomatch') {
  return {
    name,
    dependency: name,
    url: 'https://github.com/advisories/GHSA-other-1111-2222',
    severity,
    range: '*',
  };
}

test('accepts only the 11 direct/derived rows from the reviewed advisory and leaves the raw report intact', () => {
  const full = structuredClone(recorded),
    before = JSON.stringify(full);
  const result = evaluate({ full });
  assert.equal(result.ok, true);
  assert.equal(result.accepted.length, 11);
  assert.deepEqual(result.moderate.sort(), ['glob', 'minimatch']);
  assert.deepEqual(result.blocked, []);
  assert.equal(JSON.stringify(full), before);
});
test('passes a clean audit without using an exception', () => {
  assert.deepEqual(evaluate({ full: report() }), {
    ok: true,
    accepted: [],
    blocked: [],
    moderate: [],
  });
});
test('a new high in the accepted leaf still blocks every affected ancestor', () => {
  const full = structuredClone(recorded);
  full.vulnerabilities.picomatch.via.push(other());
  const result = evaluate({ full });
  assert.equal(result.ok, false);
  assert.equal(result.accepted.length, 0);
  assert.equal(result.blocked.length, 11);
});
test('mixed approved/unapproved causes in an ancestor are never hidden', () => {
  const full = structuredClone(recorded);
  full.vulnerabilities.vite.via.push(other('high', 'vite'));
  const result = evaluate({ full });
  assert.equal(result.ok, false);
  assert.ok(result.blocked.some((row) => row.package === 'vite'));
  assert.ok(result.blocked.some((row) => row.package === 'vitest'));
});
test('advisories with different dependency identities cannot overwrite each other', () => {
  const full = structuredClone(recorded);
  const accepted = structuredClone(full.vulnerabilities.picomatch.via[0]);
  full.vulnerabilities.picomatch.via = [{ ...accepted, dependency: 'another-package' }, accepted];
  assert.equal(evaluate({ full }).ok, false);
});
for (const severity of ['high', 'critical']) {
  test(`an unrelated ${severity} advisory blocks`, () => {
    const full = structuredClone(recorded).vulnerabilities;
    full.unrelated = {
      name: 'unrelated',
      severity,
      via: [other(severity, 'unrelated')],
      nodes: ['node_modules/unrelated'],
    };
    assert.equal(evaluate({ full: report(full) }).ok, false);
  });
  test(`production ${severity} never receives the exception`, () => {
    const finding = { ...structuredClone(recorded.vulnerabilities.picomatch), severity };
    assert.equal(evaluate({ production: report({ picomatch: finding }) }).ok, false);
  });
}
test('critical severity on the accepted package is never exempt', () => {
  const full = structuredClone(recorded).vulnerabilities;
  full.picomatch.severity = 'critical';
  assert.equal(evaluate({ full: report(full) }).ok, false);
});
test('unknown advisory URLs or changed vulnerable ranges require a review', () => {
  for (const update of [
    { url: exception.advisory + '-other' },
    { range: '<=5.0.0' },
    { dependency: 'another-package' },
  ]) {
    const full = structuredClone(recorded);
    Object.assign(full.vulnerabilities.picomatch.via[0], update);
    assert.equal(evaluate({ full }).ok, false);
  }
});
test('expiry is enforced at the exact boundary', () => {
  assert.equal(evaluate({ now: new Date('2026-11-30T23:59:59Z') }).ok, true);
  assert.equal(evaluate({ now: new Date(exception.expires) }).ok, false);
  assert.equal(evaluate({ now: new Date('2026-11-16') }).ok, false);
});
test('upstream release changes stop acceptance rather than silently carrying the exception', () => {
  for (const latestVersion of ['4.0.8', '5.0.0', undefined])
    assert.equal(evaluate({ latestVersion }).ok, false);
});
test('changed lock, installed version and configuration require a new review', () => {
  const lock = JSON.parse(lockText);
  lock.packages['node_modules/picomatch'].version = '4.0.8';
  assert.equal(evaluate({ lockText: JSON.stringify(lock) }).ok, false);
  assert.equal(evaluate({ lockText: lockText + ' ' }).ok, false);
  const changed = { ...inputs, 'vite.config.ts': inputs['vite.config.ts'] + '\n// changed input' };
  assert.equal(evaluate({ inputs: changed }).ok, false);
});
test('a missing/unknown node or no proven development scope cannot be accepted', () => {
  for (const node of ['node_modules/other-picomatch', 'node_modules/zod']) {
    const full = structuredClone(recorded);
    full.vulnerabilities.picomatch.nodes = [node];
    assert.equal(evaluate({ full }).ok, false);
  }
  const full = structuredClone(recorded);
  full.vulnerabilities.vite.nodes = ['node_modules/zod'];
  assert.equal(evaluate({ full }).ok, false);
});
test('missing causes and cycles fail closed', () => {
  for (const cause of ['not-in-report', 'fdir']) {
    const full = structuredClone(recorded);
    full.vulnerabilities.picomatch.via.push(cause);
    assert.throws(() => evaluate({ full }));
  }
});
test('unexplained high severity is blocked and under-reported severity is not trusted', () => {
  const full = structuredClone(recorded).vulnerabilities;
  full.vite.via = [];
  assert.equal(evaluate({ full: report(full) }).ok, false);
  const changed = structuredClone(recorded).vulnerabilities;
  changed.picomatch.severity = 'moderate';
  assert.equal(evaluate({ full: report(changed) }).ok, false);
});
test('npm exit 1 may represent findings but malformed/network/tool failures never pass', () => {
  assert.deepEqual(parseAuditResult({ status: 1, stdout: JSON.stringify(recorded) }), recorded);
  for (const result of [
    { status: 2, stdout: JSON.stringify(recorded) },
    { status: 1, stdout: '{"error":{"code":"ENETUNREACH"}}' },
    { status: 0, stdout: '{"auditReportVersion":3}' },
    { status: 0, stdout: '{}' },
    { status: 0, stdout: 'not JSON' },
    { status: null, error: new Error('timeout'), stdout: '' },
  ])
    assert.throws(() => parseAuditResult(result));
  const broken = structuredClone(recorded);
  broken.metadata.vulnerabilities.high = 0;
  assert.throws(() => evaluate({ full: broken }));
});
test('runtime package matching is path-aware and handles Windows paths', () => {
  for (const input of [
    'node_modules/picomatch/index.js',
    '../../node_modules/picomatch/lib/parse.js',
    'node_modules\\picomatch\\index.js',
  ])
    assert.throws(() => assertNoRuntimePicomatch([input]));
  assertNoRuntimePicomatch(['node_modules/picomatch-extra/index.js', 'src/lib/images.ts']);
});
test('the Cloudflare Worker build does not include picomatch', async () => {
  const result = await build({
    entryPoints: ['worker/src/index.ts'],
    bundle: true,
    write: false,
    metafile: true,
    format: 'esm',
    platform: 'browser',
    target: 'es2022',
    external: ['cloudflare:*'],
  });
  assertNoRuntimePicomatch(Object.keys(result.metafile.inputs));
});
