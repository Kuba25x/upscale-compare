import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

// Deliberate stage-7 release lock. Changing JSON, environment variables or a
// workflow confirmation cannot certify resources or authorize billable R2.
// A reviewed code change is required after the documented blockers are resolved.
export async function productionReadiness() {
  const plan = JSON.parse(
    await readFile(new URL('../ops/production-readiness.json', import.meta.url), 'utf8'),
  );
  if (
    plan.schemaVersion !== 1 ||
    plan.status !== 'blocked' ||
    !Array.isArray(plan.blockers) ||
    plan.blockers.length < 1
  )
    throw new Error('Invalid production readiness record; deployment remains blocked.');
  const expected = {
    maximumChargeUsd: 0,
    workersPlan: 'Free',
    d1Plan: 'Free',
    r2StorageClass: 'Standard',
    workersCpuMs: 10,
    workersMemoryMb: 128,
    subrequestsPerInvocation: 50,
  };
  for (const [key, value] of Object.entries(expected))
    if (plan.policy?.[key] !== value)
      throw new Error('The zero-charge Free-only policy must not be relaxed.');
  return { ready: false, policy: expected, blockers: plan.blockers };
}
export async function requireProductionReady() {
  const report = await productionReadiness();
  throw new Error(
    'Production deployment is locked: ' +
      report.blockers.map((item) => item.id).join(', ') +
      '. See docs/OPERATIONS.md and docs/FREE_TIER_OPERATIONS.md.',
  );
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 2)
    throw new Error('This read-only guard accepts no arguments or override flags.');
  try {
    await requireProductionReady();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
