import { execFileSync } from 'node:child_process';
import { copyFileSync, lstatSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  checkBadging,
  checkSignature,
  hash,
  readVersion,
  requireCommit,
} from './android-release.mjs';
import { readApkAssets, readSourceProvenance, runTool } from './android-release-tools.mjs';

export const repository = 'Kuba25x/upscale-compare';
export const apkName = 'upscale-compare-debug.apk';
export const versionFile = 'android/release.properties';

export function validateTag(tag, { versionName }) {
  if (
    !/^v(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)-android-preview\.[1-9]\d*$/.test(tag) ||
    tag !== `v${versionName}`
  ) {
    throw new Error(`Expected the Android Preview tag v${versionName} from ${versionFile}`);
  }
}

export function validateBundleTag(tag, version, event) {
  // PRs exercise the entire debug distribution without reserving a public tag.
  if (event === 'pull_request' && tag === '') return;
  validateTag(tag, version);
}

function payloadNames(commit) {
  return [
    apkName,
    `corresponding-source-${requireCommit(commit)}.tar.gz`,
    'COMMIT',
    'DEPENDENCIES.json',
    'LICENSE.txt',
    'THIRD_PARTY_NOTICES.txt',
  ];
}

function checksums(files) {
  return files.map(({ name, sha256 }) => `${sha256}  ${name}\n`).join('');
}

export function verifyPreviewFiles(directory, commit, expectedChecksumDigest) {
  const names = [...payloadNames(commit), 'SHA256SUMS'];
  const actual = readdirSync(directory).sort();
  if (actual.join('\n') !== [...names].sort().join('\n')) {
    throw new Error('Unexpected or missing preview asset');
  }
  const files = names.map((name) => {
    const path = join(directory, name);
    const stat = lstatSync(path);
    if (!stat.isFile() || !stat.size) throw new Error(`Invalid preview asset: ${name}`);
    return { name, path, size: stat.size, sha256: hash(path) };
  });
  if (
    files.at(-1).sha256 !== expectedChecksumDigest ||
    readFileSync(join(directory, 'SHA256SUMS'), 'utf8') !== checksums(files.slice(0, -1)) ||
    readFileSync(join(directory, 'COMMIT'), 'utf8') !== `${commit}\n`
  ) {
    throw new Error('Preview file integrity or source commit mismatch');
  }
  return files;
}

function prepare(directory, tag, commit) {
  const version = readVersion(readFileSync(versionFile, 'utf8'));
  validateBundleTag(tag, version, process.env.GITHUB_EVENT_NAME);
  requireCommit(commit);
  const git = (args) => execFileSync('git', args, { encoding: 'utf8' }).trim();
  if (git(['rev-parse', 'HEAD']) !== commit || git(['status', '--porcelain', '-uno'])) {
    throw new Error('Preview requires an unchanged checkout of the exact build commit');
  }
  const source = readSourceProvenance(join(directory, `corresponding-source-${commit}.tar.gz`));
  const inventory = 'android/app/build/reports/debug-dependencies.json';
  const dependencies = JSON.parse(readFileSync(inventory, 'utf8'));
  const sourceNames = new Set(source.archives.map(({ file }) => file));
  if (
    source.commit !== commit ||
    !dependencies.length ||
    dependencies.some(
      ({ coordinate }) => !sourceNames.has(coordinate.replaceAll(':', '_') + '-sources.jar'),
    )
  ) {
    throw new Error('Corresponding source is missing debug runtime dependencies');
  }
  const apk = join(directory, apkName);
  copyFileSync('android/app/build/outputs/apk/debug/app-debug.apk', apk);
  checkBadging(runTool('aapt', ['dump', 'badging', apk]), version, true);
  runTool('zipalign', ['-c', '-P', '16', '4', apk]);
  const signature = runTool('apksigner', ['verify', '--verbose', '--print-certs', apk]);
  const certificate = signature.match(/^Signer #1 certificate SHA-256 digest: ([a-f0-9]+)$/m)?.[1];
  checkSignature(signature, certificate);
  if (!/^Signer #1 certificate DN: .*\bCN=Android Debug(?:,|$)/m.test(signature)) {
    throw new Error('Expected the Android debug signer');
  }
  const assets = readApkAssets(apk);
  const build = JSON.parse(assets['build-info.json']);
  if (
    build.commit !== commit ||
    build.source !== `https://github.com/${repository}/tree/${commit}` ||
    build.versionName !== version.versionName ||
    build.versionCode !== version.versionCode ||
    assets['LICENSE.txt'] !== readFileSync('LICENSE', 'utf8') ||
    assets['third-party-licenses.txt'] !==
      readFileSync('dist-android/third-party-licenses.txt', 'utf8') ||
    dependencies.some(({ coordinate }) => !assets['third-party-licenses.txt'].includes(coordinate))
  ) {
    throw new Error('Preview APK provenance or license materials mismatch');
  }
  copyFileSync(inventory, join(directory, 'DEPENDENCIES.json'));
  writeFileSync(join(directory, 'LICENSE.txt'), assets['LICENSE.txt']);
  writeFileSync(join(directory, 'THIRD_PARTY_NOTICES.txt'), assets['third-party-licenses.txt']);
  writeFileSync(join(directory, 'COMMIT'), `${commit}\n`);
  const checksum = join(directory, 'SHA256SUMS');
  writeFileSync(
    checksum,
    checksums(payloadNames(commit).map((name) => ({ name, sha256: hash(join(directory, name)) }))),
  );
  const digest = hash(checksum);
  verifyPreviewFiles(directory, commit, digest);
  console.log(
    `Verified ${tag || version.versionName} from ${commit}. Debug certificate SHA-256: ${certificate}`,
  );
  return digest;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const [directory, tag, commit] = process.argv.slice(2);
  const digest = prepare(resolve(directory), tag, commit);
  if (process.env.GITHUB_OUTPUT) {
    writeFileSync(process.env.GITHUB_OUTPUT, `checksum_digest=${digest}\n`, { flag: 'a' });
  }
}
