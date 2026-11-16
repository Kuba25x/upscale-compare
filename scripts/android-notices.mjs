import { execFileSync } from 'node:child_process';
import { copyFile, writeFile } from 'node:fs/promises';
import { readFile, appendFile } from 'node:fs/promises';
import { readVersion } from './android-release.mjs';
for (const name of ['core', 'android', 'app']) {
  const base = `node_modules/@capacitor/${name}`;
  const metadata = JSON.parse(await readFile(`${base}/package.json`, 'utf8'));
  await appendFile(
    'dist-android/third-party-licenses.txt',
    `\n@capacitor/${name} ${metadata.version}\n${await readFile(`${base}/LICENSE`, 'utf8')}\n`,
  );
}
const tslib = JSON.parse(await readFile('node_modules/tslib/package.json', 'utf8'));
await appendFile(
  'dist-android/third-party-licenses.txt',
  '\ntslib ' + tslib.version + ' — 0BSD\n' +
    await readFile('node_modules/tslib/CopyrightNotice.txt', 'utf8') + '\n' +
    await readFile('node_modules/tslib/LICENSE.txt', 'utf8') + '\n',
);
await appendFile(
  'dist-android/third-party-licenses.txt',
  await readFile('android/THIRD_PARTY_NOTICES.txt', 'utf8'),
);

await copyFile('LICENSE', 'dist-android/LICENSE.txt');
let commit;
try {
  commit = execFileSync('git', ['rev-parse', 'HEAD'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  }).trim();
} catch {
  // A corresponding-source archive has no .git directory.
  commit = process.env.SOURCE_COMMIT;
}
if (!/^[a-f0-9]{40}$/.test(commit || ''))
  throw new Error('Set SOURCE_COMMIT for an extracted source archive');
if (process.env.SOURCE_COMMIT && process.env.SOURCE_COMMIT !== commit)
  throw new Error('SOURCE_COMMIT differs from checkout');
await writeFile(
  'dist-android/build-info.json',
  JSON.stringify(
    {
      commit,
      ...readVersion(await readFile('android/release.properties', 'utf8')),
      source: `https://github.com/Kuba25x/upscale-compare/tree/${commit}`,
      deviceQualified: false,
    },
    null,
    2,
  ) + '\n',
);
