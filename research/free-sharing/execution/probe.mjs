// LOCAL ONLY. No Cloudflare binding/account/API or remote-capable option.
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createLab } from './lab.mjs';
import { workloadCases, output } from './fixtures.mjs';
const args = process.argv.slice(2),
  allowed = new Set(['--png-noise-only', '--workerd-only']);
if (args.some((a) => !allowed.has(a)) || new Set(args).size !== args.length)
  throw new Error('Only --png-noise-only and --workerd-only are accepted; never a remote target.');
const noiseOnly = args.includes('--png-noise-only'),
  workerOnly = args.includes('--workerd-only');
const suffix = [noiseOnly ? 'noise' : null, workerOnly ? 'workerd' : null]
  .filter(Boolean)
  .join('-');
const filePrefix = 'execution' + (suffix ? '-' + suffix : '');
const cases = (await workloadCases()).filter(
    (item) => !noiseOnly || item.name.endsWith('-png8-noise'),
  ),
  samples = [],
  sessions = [];
for (const item of cases) {
  for (const runtime of workerOnly ? ['workerd'] : ['browser', 'workerd']) {
    const lab = await createLab();
    let warmBrowser;
    try {
      for (let round = 0; round <= 6; round++) {
        // round 0: isolated cold session. round 1: unmeasured warm-up.
        // rounds 2..6: five warm jobs; reused browser is NOT a cold-cost model.
        if (runtime === 'browser' && round === 1) warmBrowser = await lab.openBrowser();
        const prepared = performance.now(),
          job = lab.jobs.begin(item.files),
          controllerPreparationWallMs = performance.now() - prepared;
        const result =
          runtime === 'browser'
            ? await lab.browserJob(job, { browser: round ? warmBrowser : undefined })
            : await lab.workerJob(job);
        if (round !== 1) {
          samples.push({
            case: item.name,
            runtime,
            round: round === 0 ? 'cold' : round - 1,
            controllerPreparationWallMs,
            originalBytes: item.files.reduce((n, f) => n + f.bytes.length, 0),
            fileCount: item.files.length,
            ...result,
          });
          console.log(
            JSON.stringify({
              case: item.name,
              runtime,
              round: round === 0 ? 'cold' : round - 1,
              state: result.state,
              wallMs: result.wholeLocalJobWallMs,
            }),
          );
        }
        for (let i = 0; i < item.files.length; i++)
          if (job.specs[i].sha256 !== item.files[i].sha256) throw new Error('Fixture changed');
        lab.jobs.forget(job);
      }
      sessions.push({
        case: item.name,
        runtime,
        stats: { ...lab.stats },
        openBrowsersBeforeCleanup: lab.browsers.size,
      });
    } finally {
      await lab.close();
    }
    // Keep completed cases reviewable if a later environment/runtime fails.
    await writeFile(
      resolve(output, filePrefix + '-samples.json'),
      JSON.stringify(
        {
          generatedAt: new Date().toISOString(),
          node: process.version,
          scope:
            'Synthetic LOCAL validation jobs only. Browser Chromium != Cloudflare Browser Run. No source-upload/D1/storage/deployment/Turnstile path. Workerd host latency != edge CPU. Browser renderer TaskDuration excludes other processes/native threads; memory counters are not peak memory. One cold and five measured warm jobs per case/runtime; one warm-up omitted.',
          cloudflareFreeCertified: false,
          samples,
          sessions,
        },
        null,
        2,
      ) + '\n',
    );
  }
}
await writeFile(
  resolve(output, filePrefix + '-fixtures.json'),
  JSON.stringify(
    cases.map((c) => ({
      name: c.name,
      files: c.files.map(({ bytes, ...f }) => ({ ...f, size: bytes.length })),
    })),
    null,
    2,
  ) + '\n',
);
