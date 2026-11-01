import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { output, root } from './fixtures.mjs';
import { browserBudget } from './budget.mjs';
const batches = [],
  catalog = new Map(),
  chosen = new Map();
for (const prefix of [
  'execution',
  'execution-noise',
  'execution-workerd',
  'execution-noise-workerd',
]) {
  try {
    const report = JSON.parse(await readFile(resolve(output, prefix + '-samples.json'), 'utf8'));
    const fixtureRows = JSON.parse(
      await readFile(resolve(output, prefix + '-fixtures.json'), 'utf8'),
    );
    batches.push({ name: prefix, generatedAt: report.generatedAt, scope: report.scope });
    for (const item of fixtureRows) catalog.set(item.name, item);
    for (const sample of report.samples) {
      const key = sample.case + '/' + sample.runtime;
      const previous = chosen.get(key);
      if (!previous || report.generatedAt > previous.generatedAt)
        chosen.set(key, {
          generatedAt: report.generatedAt,
          batch: prefix,
          rows: report.samples.filter(
            (s) => s.case === sample.case && s.runtime === sample.runtime,
          ),
        });
    }
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}
const report = {
    generatedAt: new Date().toISOString(),
    scope:
      'Local Chromium and workerd only, not Browser Run or Free certification. Latest complete six-sample case/runtime batch selected; packaging is outside final workerd timers. Warm browser jobs exclude browser launch/close and are not a cold-cost model.',
    samples: [...chosen.values()].flatMap((group) =>
      group.rows.map((r) => ({ ...r, batch: group.batch })),
    ),
  },
  fixtures = [...catalog.values()];
const destination = resolve(root, 'research/free-sharing/execution-results');
await mkdir(destination, { recursive: true });
const summary = [];
for (const name of new Set(report.samples.map((s) => s.case)))
  for (const runtime of ['browser', 'workerd']) {
    const rows = report.samples.filter((s) => s.case === name && s.runtime === runtime),
      cold = rows.find((s) => s.round === 'cold'),
      warm = rows.filter((s) => s.round !== 'cold'),
      ordered = warm.map((s) => s.wholeLocalJobWallMs).sort((a, b) => a - b);
    const retained = rows
      .flatMap((s) => s.files.map((f) => f.metrics?.knownRetainedMinimumBytes))
      .filter(Number.isFinite);
    const profileReasons = [
      ...new Set(
        rows.flatMap((s) => s.files.filter((f) => f.state !== 'validated').map((f) => f.reason)),
      ),
    ];
    if (rows.length !== 6 || warm.length !== 5 || !cold)
      throw new Error('Incomplete sample group: ' + name + '/' + runtime);
    summary.push({
      case: name,
      runtime,
      sampleCount: rows.length,
      coldLocalJobWallMs: cold.wholeLocalJobWallMs,
      warmMedianLocalJobWallMs: ordered[Math.floor(ordered.length / 2)],
      warmMinLocalJobWallMs: ordered[0],
      warmMaxLocalJobWallMs: ordered.at(-1),
      validatedJobs: rows.filter((s) => s.state === 'validated').length,
      maximumPerFileRetainedLowerBoundBytes: retained.length ? Math.max(...retained) : null,
      profileReasons,
      ...(runtime === 'browser'
        ? {
            coldLaunchWallMs: cold.launchWallMs,
            coldCloseWallMs: cold.browserCloseWallMs,
            localColdUnder30Seconds:
              cold.state === 'validated' && cold.wholeLocalJobWallMs <= 30000,
            budgetScenarios: [3, 5].flatMap((publicationsPerDay) =>
              [1, 3, 10].map((slowdown) =>
                browserBudget(cold.wholeLocalJobWallMs / 1000, { publicationsPerDay, slowdown }),
              ),
            ),
            fivePublicationsPlusFiveFailuresAndIdleTailsAtTenfoldSlowdown: browserBudget(
              cold.wholeLocalJobWallMs / 1000,
              { publicationsPerDay: 5, slowdown: 10, failedAttempts: 5, uncertainClosures: 5 },
            ),
          }
        : {}),
    });
  }
await writeFile(
  resolve(destination, 'summary.json'),
  JSON.stringify(
    {
      generatedAt: report.generatedAt,
      scope: report.scope,
      batches: batches.filter((b) => report.samples.some((s) => s.batch === b.name)),
      cloudflareFreeCertified: false,
      summary,
    },
    null,
    2,
  ) + '\n',
);
const compact = report.samples.map((s) => ({
  batch: s.batch,
  case: s.case,
  runtime: s.runtime,
  round: s.round,
  state: s.state,
  originalBytes: s.originalBytes,
  fileCount: s.fileCount,
  controllerPreparationWallMs: s.controllerPreparationWallMs,
  wholeLocalJobWallMs: s.wholeLocalJobWallMs,
  launchWallMs: s.launchWallMs,
  pageSetupWallMs: s.pageSetupWallMs,
  pageCloseWallMs: s.pageCloseWallMs,
  contextCloseWallMs: s.contextCloseWallMs,
  browserCloseWallMs: s.browserCloseWallMs,
  chromiumVersion: s.chromiumVersion,
  browserSessionClosed: s.browserSessionClosed,
  reason: s.reason,
  identityAndOriginalChecksPassed: s.state === 'validated',
  files: s.files.map((f) => ({
    index: f.index,
    state: f.state,
    reason: f.reason,
    metrics: f.metrics,
  })),
  cloudflareFreeCertified: false,
}));
await writeFile(
  resolve(destination, 'samples.jsonl'),
  compact.map((s) => JSON.stringify(s)).join('\n') + '\n',
);
await writeFile(resolve(destination, 'fixtures.json'), JSON.stringify(fixtures, null, 2) + '\n');
console.log(
  JSON.stringify(
    summary.map((s) => ({
      case: s.case,
      runtime: s.runtime,
      pass: s.validatedJobs,
      coldMs: Math.round(s.coldLocalJobWallMs),
      warmMs: Math.round(s.warmMedianLocalJobWallMs),
      minimumMiB: s.maximumPerFileRetainedLowerBoundBytes / 1048576,
    })),
    null,
    2,
  ),
);
