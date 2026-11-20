// Collect preferred upstream source without executing it. Production keys must be offline.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const commit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
if (!/^[a-f0-9]{40}$/.test(commit)) throw new Error('Expected exact source commit');
const output = resolve(process.argv[2] || 'release-artifacts/source');
const variant = process.argv[3] || 'release';
if (!['debug', 'release'].includes(variant)) throw new Error('Invalid Android runtime variant');
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
    await readFile(`android/app/build/reports/${variant}-dependencies.json`, 'utf8'),
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
  const pins = JSON.parse(await readFile('android/upstream-sources.json', 'utf8'));
  if (pins.schema !== 1 || pins.repositories.length !== 6)
    throw new Error('Review upstream source pins');
  const covered = new Set(pins.repositories.flatMap((entry) => Object.keys(entry.packages)));
  const project = JSON.parse(await readFile('package.json', 'utf8'));
  const lock = JSON.parse(await readFile('package-lock.json', 'utf8'));
  const pinnedVersions = Object.assign({}, ...pins.repositories.map((entry) => entry.packages));
  for (const [path, dependency] of Object.entries(lock.packages)) {
    if (!path || dependency.dev || dependency.devOptional) continue;
    const name = path.slice(path.lastIndexOf('node_modules/') + 'node_modules/'.length);
    if (pinnedVersions[name] !== dependency.version) {
      throw new Error('Missing exact transitive runtime source pin: ' + name);
    }
  }
  for (const name of Object.keys(project.dependencies)) {
    if (!covered.has(name)) throw new Error('Missing runtime source pin: ' + name);
  }
  for (const entry of pins.repositories) {
    if (
      !/^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/.test(entry.repository) ||
      !/^[a-f0-9]{40}$/.test(entry.commit)
    )
      throw new Error('Invalid upstream source pin');
    const packages = [];
    for (const [name, version] of Object.entries(entry.packages)) {
      if ((await metadata(name)).version !== version)
        throw new Error('Update upstream source pin for ' + name);
      packages.push({ name, version });
    }
    const file = entry.repository.replace('/', '_') + '-' + entry.commit + '.tar.gz';
    await download(
      'https://codeload.github.com/' + entry.repository + '/tar.gz/' + entry.commit,
      file,
    );
    hashes.at(-1).packages = packages;
    hashes.at(-1).upstreamCommit = entry.commit;
    hashes.at(-1).releaseRef = entry.releaseRef;
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
      pins.repositories.length +
      ' upstream repositories',
  );
} finally {
  await rm(temporary, { recursive: true, force: true });
}
