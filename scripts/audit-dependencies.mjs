import { spawnSync } from 'node:child_process';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import {
  PICOMATCH_EXCEPTION,
  evaluateAudit,
  parseAuditResult,
} from './dependency-audit-policy.mjs';

const directory = '.wrangler/security-audit';
await rm(directory, { recursive: true, force: true });
await mkdir(directory, { recursive: true });
try {
  const npm = process.env.npm_execpath;
  if (!npm) throw new Error('Run this gate through npm run audit:dependencies');
  const run = (args) =>
    spawnSync(process.execPath, [npm, ...args, '--cache', '.wrangler/security-audit-npm-cache'], {
      encoding: 'utf8',
      timeout: 60000,
      maxBuffer: 20 * 1024 * 1024,
    });
  const reports = {};
  for (const [name, selection] of [
    ['full', '--include=dev'],
    ['production', '--omit=dev'],
  ]) {
    const result = run(['audit', '--json', selection]);
    // Preserve the complete original report, including accepted and moderate rows.
    await writeFile(`${directory}/${name}.json`, result.stdout || '');
    reports[name] = parseAuditResult(result);
  }
  const latest = run(['view', 'picomatch', 'version', '--json', '--prefer-online']);
  if (latest.error || latest.status !== 0)
    throw new Error('Could not verify upstream picomatch release');
  const latestVersion = JSON.parse(latest.stdout);
  if (typeof latestVersion !== 'string')
    throw new Error('Invalid upstream package version response');
  const inputs = Object.fromEntries(
    await Promise.all(
      Object.keys(PICOMATCH_EXCEPTION.inputs).map(async (file) => [
        file,
        await readFile(file, 'utf8'),
      ]),
    ),
  );
  const result = evaluateAudit({
    ...reports,
    lockText: await readFile('package-lock.json', 'utf8'),
    latestVersion,
    inputs,
  });
  await writeFile(
    `${directory}/decision.json`,
    JSON.stringify(
      {
        ...result,
        checkedAt: new Date().toISOString(),
        latestVersion,
        exception: PICOMATCH_EXCEPTION,
      },
      null,
      2,
    ) + '\n',
  );
  console.log(`Raw npm audit: ${JSON.stringify(reports.full.metadata.vulnerabilities)}`);
  console.log(`Production audit: ${JSON.stringify(reports.production.metadata.vulnerabilities)}`);
  if (result.accepted.length) {
    console.log(
      `TEMPORARY BUILD-ONLY EXCEPTION: ${PICOMATCH_EXCEPTION.advisory}; expires ${PICOMATCH_EXCEPTION.expires}`,
    );
    console.log(`Accepted direct/derived rows: ${result.accepted.join(', ')}`);
  } else console.log('No exception used. Remove its policy once the advisory is resolved.');
  console.log(
    `Moderate findings remain reported (unchanged high threshold): ${result.moderate.join(', ') || 'none'}`,
  );
  for (const finding of result.blocked) console.error(`BLOCKED: ${JSON.stringify(finding)}`);
  console.log(`Full, production and decision reports: ${directory}/`);
  if (!result.ok) process.exitCode = 1;
} catch (error) {
  console.error(`Dependency audit gate failed closed: ${error.message}`);
  process.exitCode = 1;
}
