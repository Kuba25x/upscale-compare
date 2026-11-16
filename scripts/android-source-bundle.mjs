// Collect preferred upstream source without executing it. Production keys must be offline.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const commit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
if (!/^[a-f0-9]{40}$/.test(commit)) throw new Error('Expected exact source commit');
const output = resolve(process.argv[2] || 'release-artifacts/source');
await mkdir(output, { recursive: true });
const temporary = await mkdtemp(join(tmpdir(), 'upscale-source-'));
async function get(url) {
  const response = await fetch(url, { headers: { 'User-Agent': 'Upscale-Compare-source-bundle' } });
  if (!response.ok) throw new Error('Source download failed (' + response.status + '): ' + url);
  return response;
}
const hashes = [];
async function download(url, file) {
  const bytes = Buffer.from(await (await get(url)).arrayBuffer());
  if (!bytes.length) throw new Error('Empty source archive: ' + url);
  await writeFile(join(temporary, 'dependencies', file), bytes);
  hashes.push({ file, url, sha256: createHash('sha256').update(bytes).digest('hex') });
}
try {
  await mkdir(join(temporary, 'project'));
  await mkdir(join(temporary, 'dependencies'));
  const archive = join(temporary, 'project.tar');
  execFileSync('git', ['archive', '--format=tar', '--output=' + archive, commit]);
  execFileSync('tar', ['-xf', archive, '-C', join(temporary, 'project')]);
  await rm(archive);
  const native = JSON.parse(
    await readFile('android/app/build/reports/release-dependencies.json', 'utf8'),
  );
  async function auditPom(url, depth = 0) {
    if (depth > 5) throw new Error('Maven license inheritance exceeded: ' + url);
    const xml = await (await get(url)).text();
    const licenses = [...xml.matchAll(/<license>([\s\S]*?)<\/license>/g)].map((match) => match[1]);
    if (licenses.length) {
      if (licenses.some((license) => !/apache.org\/licenses\/LICENSE-2.0/i.test(license))) {
        throw new Error('Review non-Apache native runtime license: ' + url);
      }
      return;
    }
    const parent = xml.match(/<parent>([\s\S]*?)<\/parent>/)?.[1];
    const field = (name) =>
      parent?.match(new RegExp('<' + name + '>([^<]+)</' + name + '>'))?.[1].trim();
    const group = field('groupId'),
      artifact = field('artifactId'),
      version = field('version');
    if (![group, artifact, version].every((value) => /^[A-Za-z0-9_.-]+$/.test(value || ''))) {
      throw new Error('Missing auditable Maven runtime license: ' + url);
    }
    const root = url.startsWith('https://dl.google.com/')
      ? 'https://dl.google.com/dl/android/maven2/'
      : 'https://repo.maven.apache.org/maven2/';
    await auditPom(
      root +
        group.replaceAll('.', '/') +
        '/' +
        artifact +
        '/' +
        version +
        '/' +
        artifact +
        '-' +
        version +
        '.pom',
      depth + 1,
    );
  }
  for (const entry of native) {
    await auditPom(entry.pom);
    const name = entry.coordinate.replaceAll(':', '_') + '-sources.jar';
    await download(entry.source, name);
  }
  const metadata = async (name) =>
    JSON.parse(await readFile('node_modules/' + name + '/package.json', 'utf8'));
  const react = await metadata('react');
  const inputs = [
    ['facebook/react', 'v' + react.version, ['react', 'react-dom', 'scheduler']],
    ['lucide-icons/lucide', (await metadata('lucide-react')).version, ['lucide-react']],
    ['colinhacks/zod', 'v' + (await metadata('zod')).version, ['zod']],
    [
      'ionic-team/capacitor',
      (await metadata('@capacitor/core')).version,
      ['@capacitor/core', '@capacitor/android'],
    ],
    [
      'ionic-team/capacitor-plugins',
      '@capacitor/app@' + (await metadata('@capacitor/app')).version,
      ['@capacitor/app'],
    ],
  ];
  for (const [repository, ref, packages] of inputs) {
    const resolved = await (
      await get(
        'https://api.github.com/repos/' + repository + '/commits/' + encodeURIComponent(ref),
      )
    ).json();
    if (!/^[a-f0-9]{40}$/.test(resolved.sha))
      throw new Error('Cannot pin upstream source: ' + repository);
    const file = repository.replace('/', '_') + '-' + resolved.sha + '.tar.gz';
    await download('https://codeload.github.com/' + repository + '/tar.gz/' + resolved.sha, file);
    hashes.at(-1).packages = await Promise.all(
      packages.map(async (name) => ({ name, version: (await metadata(name)).version })),
    );
    hashes.at(-1).upstreamCommit = resolved.sha;
    hashes.at(-1).releaseRef = ref;
  }
  await writeFile(
    join(temporary, 'DEPENDENCY-SOURCES.json'),
    JSON.stringify({ commit, archives: hashes }, null, 2) + '\n',
  );
  await writeFile(
    join(temporary, 'README.txt'),
    [
      'Upscale Compare corresponding-source bundle',
      'Project commit: ' + commit,
      'See project/docs/ANDROID_RELEASE.md for building and self-signing.',
      'dependencies/ contains exact-version upstream runtime sources with their notices.',
      'DEPENDENCY-SOURCES.json records resolved upstream commits and archive SHA-256.',
      'Keep this complete archive available alongside the distributed APK.',
      'Production signing keys are private and are not part of this archive.',
      '',
    ].join('\n'),
  );
  execFileSync('tar', [
    '-czf',
    join(output, 'corresponding-source-' + commit + '.tar.gz'),
    '-C',
    temporary,
    '.',
  ]);
  console.log(
    'Collected source for ' +
      native.length +
      ' native runtime artifacts and ' +
      inputs.length +
      ' upstream repositories',
  );
} finally {
  await rm(temporary, { recursive: true, force: true });
}
