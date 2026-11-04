import { execFileSync } from 'node:child_process';
import { copyFile, writeFile } from 'node:fs/promises';
import { readFile, appendFile } from 'node:fs/promises';
for (const name of ['core', 'android', 'app']) {
  const base = `node_modules/@capacitor/${name}`;
  const metadata = JSON.parse(await readFile(`${base}/package.json`, 'utf8'));
  await appendFile(
    'dist-android/third-party-licenses.txt',
    `\n@capacitor/${name} ${metadata.version}\n${await readFile(`${base}/LICENSE`, 'utf8')}\n`,
  );
}
await appendFile(
  'dist-android/third-party-licenses.txt',
  await readFile('android/THIRD_PARTY_NOTICES.txt', 'utf8'),
);

await copyFile('LICENSE', 'dist-android/LICENSE.txt');
const commit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
await writeFile(
  'dist-android/build-info.json',
  JSON.stringify(
    {
      commit,
      source: `https://github.com/Kuba25x/upscale-compare/tree/${commit}`,
      deviceQualified: false,
    },
    null,
    2,
  ) + '\n',
);
