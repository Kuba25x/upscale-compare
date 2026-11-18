import { createHash } from 'node:crypto';

// One reviewed exception, never a package-name allowlist. See DEPENDENCY_AUDIT.md.
export const PICOMATCH_EXCEPTION = Object.freeze({
  advisory: 'https://github.com/advisories/GHSA-fc5q-39xc-vjpf',
  package: 'picomatch',
  version: '4.0.7',
  range: '<=4.0.7',
  node: 'node_modules/picomatch',
  reviewed: '2026-11-17T00:00:00Z',
  // Retired when GitHub withdrew the advisory. Never reactivate it on new reports.
  expires: '2026-11-18T15:38:56Z',
  lockSha256: '00ba25037039ee09bea8c85c5ddf8d71b967ca1eeb1d8ca4462feb9b0a70f73e',
  // A configuration/trust-boundary change requires a new risk review.
  inputs: {
    'package.json': '232e97c9246467dcf2c8c8e20b2048275dbb0a44939f549ecd796d78906a8053',
    'vite.config.ts': 'd6c0002c678b7260212c4f41393eda8b1c5401768d5cb9b4d5a1736af9f954a3',
    'vitest.config.ts': '406e353583d397d265910e80daec07fb7318a2549e9847fb901e05046083db54',
    'scripts/pwa-build.ts': 'b14b25fbb44a332745f1551892aee7763788c846b64e494ee16e197e79ee6272',
    '.github/workflows/ci.yml': 'fae1d83172efcc9b99befb3eed5890a1cc391ad214d5734af978fe01a6900e06',
    '.github/workflows/deploy-pages.yml':
      '3c3a54d55403f1c7b2cef80f6d7b676b1a2a39561d3aaced5a0a5be2e04128e5',
    'src/lib/web-app-context.ts':
      '3b8b82e8c0b1d7eb20df6531b797aa82f3870d3b04af5de6abac1fe6b5e4214b',
  },
});

const severities = ['info', 'low', 'moderate', 'high', 'critical'];
const serious = (severity) => severity === 'high' || severity === 'critical';
export const sha256 = (text) => createHash('sha256').update(text).digest('hex');

function validateReport(report) {
  if (
    !report ||
    report.error ||
    report.auditReportVersion !== 2 ||
    !report.vulnerabilities ||
    typeof report.vulnerabilities !== 'object' ||
    Array.isArray(report.vulnerabilities) ||
    !report.metadata?.vulnerabilities
  )
    throw new Error('Missing, failed or unsupported npm audit report');
  const counts = Object.fromEntries(severities.map((severity) => [severity, 0]));
  for (const [name, finding] of Object.entries(report.vulnerabilities)) {
    if (
      !finding ||
      finding.name !== name ||
      !severities.includes(finding.severity) ||
      !Array.isArray(finding.via) ||
      !Array.isArray(finding.nodes) ||
      !finding.nodes.every((node) => typeof node === 'string')
    )
      throw new Error(`Malformed audit finding: ${name}`);
    counts[finding.severity]++;
    for (const via of finding.via) {
      if (typeof via === 'string') {
        if (!Object.hasOwn(report.vulnerabilities, via))
          throw new Error(`Missing audit cause: ${name} -> ${via}`);
      } else if (
        !via ||
        !severities.includes(via.severity) ||
        typeof via.name !== 'string' ||
        typeof via.url !== 'string'
      ) {
        throw new Error(`Malformed audit advisory in ${name}`);
      }
    }
  }
  for (const severity of severities)
    if (report.metadata.vulnerabilities[severity] !== counts[severity])
      throw new Error(`Inconsistent audit counts for ${severity}`);
  return report.vulnerabilities;
}

export function parseAuditResult(result) {
  // npm uses 1 for findings and for some registry failures; JSON/schema decide.
  if (result.error || ![0, 1].includes(result.status))
    throw new Error('npm audit process failed or timed out');
  const report = JSON.parse(result.stdout);
  validateReport(report);
  return report;
}

export function evaluateAudit({
  full,
  production,
  lockText,
  latestVersion,
  inputs,
  now = new Date(),
}) {
  const findings = validateReport(full);
  const productionFindings = validateReport(production);
  const lock = JSON.parse(lockText);
  if (lock.lockfileVersion !== 3 || !lock.packages)
    throw new Error('Unsupported or missing package lock');
  const accepted = [],
    blocked = [],
    moderate = [];
  for (const finding of Object.values(productionFindings)) {
    if (serious(finding.severity))
      blocked.push({
        package: finding.name,
        reason: 'Production high/critical findings never receive exceptions',
      });
  }

  const memo = new Map();
  function causes(name, trail = new Set()) {
    if (trail.has(name) || trail.size > 64)
      throw new Error(`Cyclic or excessive audit cause graph: ${name}`);
    if (memo.has(name)) return memo.get(name);
    const advisories = new Map(),
      packages = new Set([name]);
    for (const via of findings[name].via) {
      if (typeof via === 'string') {
        const child = causes(via, new Set([...trail, name]));
        for (const [key, value] of child.advisories) advisories.set(key, value);
        for (const item of child.packages) packages.add(item);
      } else {
        advisories.set(
          JSON.stringify([via.name, via.dependency, via.url, via.severity, via.range]),
          via,
        );
      }
    }
    const result = { advisories, packages };
    memo.set(name, result);
    return result;
  }

  function exceptionGuard(packages) {
    const exception = PICOMATCH_EXCEPTION;
    if (
      !Number.isFinite(now.getTime()) ||
      now < new Date(exception.reviewed) ||
      now >= new Date(exception.expires)
    )
      return 'Exception expired or clock is outside its review window';
    if (sha256(lockText) !== exception.lockSha256)
      return 'Dependency lock changed; reassess the exception';
    if (latestVersion !== exception.version)
      return 'Upstream latest changed; review the available release instead of carrying the exception';
    for (const [file, digest] of Object.entries(exception.inputs))
      if (typeof inputs?.[file] !== 'string' || sha256(inputs[file]) !== digest)
        return `Reviewed pattern/configuration input changed: ${file}`;
    const leaf = findings[exception.package];
    if (
      !leaf ||
      leaf.nodes.length !== 1 ||
      leaf.nodes[0] !== exception.node ||
      lock.packages[exception.node]?.version !== exception.version ||
      Object.hasOwn(productionFindings, exception.package)
    )
      return 'Picomatch version, location or production reachability changed';
    for (const name of packages) {
      if (
        !findings[name].nodes.length ||
        findings[name].nodes.some((node) => lock.packages[node]?.dev !== true)
      )
        return `Cannot prove development-only scope for ${name}`;
    }
  }

  for (const finding of Object.values(findings)) {
    const { advisories, packages } = causes(finding.name);
    const highCauses = [...advisories.values()].filter((advisory) => serious(advisory.severity));
    if (!serious(finding.severity) && !highCauses.length) {
      if (finding.severity === 'moderate') moderate.push(finding.name);
      continue;
    }
    if (!serious(finding.severity)) {
      blocked.push({
        package: finding.name,
        reason: 'Reported severity is lower than its high/critical cause',
      });
      continue;
    }
    if (finding.severity === 'critical') {
      blocked.push({ package: finding.name, reason: 'Critical findings never receive exceptions' });
      continue;
    }
    if (
      !highCauses.length ||
      !highCauses.every(
        (advisory) =>
          advisory.name === PICOMATCH_EXCEPTION.package &&
          advisory.dependency === PICOMATCH_EXCEPTION.package &&
          advisory.url === PICOMATCH_EXCEPTION.advisory &&
          advisory.severity === 'high' &&
          typeof advisory.range === 'string' &&
          advisory.range.replace(/\s/g, '') === PICOMATCH_EXCEPTION.range,
      )
    ) {
      blocked.push({
        package: finding.name,
        reason: 'Unaccepted high/critical advisory or unexplained severity',
      });
      continue;
    }
    const reason = exceptionGuard(packages);
    if (reason) blocked.push({ package: finding.name, reason });
    else accepted.push(finding.name);
  }
  return { ok: blocked.length === 0, accepted, blocked, moderate };
}

export function assertNoRuntimePicomatch(sources) {
  if (
    !Array.isArray(sources) ||
    sources.some((source) => /(?:^|[/\\])node_modules[/\\]picomatch(?:[/\\]|$)/.test(source))
  )
    throw new Error('Picomatch runtime inclusion invalidates the build-only audit exception');
}
