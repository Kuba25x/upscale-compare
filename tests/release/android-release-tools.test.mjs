import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { crc32, deflateRawSync } from 'node:zlib';
import {
  toolCommand,
  tarCommand,
  readApkAssets,
  requireInteractiveSigning,
} from '../../scripts/android-release-tools.mjs';

test('Windows tools use native executables and the SDK jar without shell quoting', () => {
  const env = {
    JAVA_HOME: 'C:\\Program Files\\JDK 21',
    ANDROID_HOME: 'C:\\Android SDK\\żółć & %! (tools)',
  };
  const args = ['verify', 'C:\\Files żółć\\a & b; %PATH%!.apk'];
  const signer = toolCommand('apksigner', args, env, 'win32');
  assert.equal(signer.file, 'C:\\Program Files\\JDK 21\\bin\\java.exe');
  assert.equal(signer.args.at(-1), args[1]);
  assert.ok(signer.args.includes(env.ANDROID_HOME + '\\build-tools\\35.0.0\\lib\\apksigner.jar'));
  for (const name of ['aapt', 'zipalign']) {
    const command = toolCommand(name, args, env, 'win32');
    assert.equal(command.file, env.ANDROID_HOME + '\\build-tools\\35.0.0\\' + name + '.exe');
    assert.deepEqual(command.args, args);
  }
  assert.ok(toolCommand('keytool', args, env, 'win32').file.endsWith('keytool.exe'));
  assert.equal(
    tarCommand({ SystemRoot: 'C:\\Windows' }, 'win32'),
    'C:\\Windows\\System32\\tar.exe',
  );
  assert.throws(() => tarCommand({}, 'win32'));
  assert.throws(() => toolCommand('aapt', [], { ...env, JAVA_HOME: 'relative' }, 'win32'));
});

test('POSIX tools retain native execution and support ANDROID_SDK_ROOT', () => {
  const env = { JAVA_HOME: '/trusted/JDK 21', ANDROID_SDK_ROOT: '/trusted/SDK' };
  assert.equal(
    toolCommand('zipalign', [], env, 'linux').file,
    '/trusted/SDK/build-tools/35.0.0/zipalign',
  );
  assert.equal(toolCommand('apksigner', [], env, 'darwin').file, '/trusted/JDK 21/bin/java');
  assert.throws(() => toolCommand('cmd', [], env, 'linux'));
});

test('production signing refuses redirected password input or output', () => {
  requireInteractiveSigning({ isTTY: true }, { isTTY: true });
  for (const [input, output] of [
    [false, true],
    [true, false],
    [false, false],
  ]) {
    assert.throws(
      () => requireInteractiveSigning({ isTTY: input }, { isTTY: output }),
      /interactive terminal/,
    );
  }
});

// Minimal ZIP fixture writer: include duplicates and oversized compressed entries deliberately.
function zip(entries) {
  const local = [],
    central = [];
  let offset = 0;
  for (const [name, value] of entries) {
    const filename = Buffer.from(name),
      bytes = Buffer.from(value),
      compressed = deflateRawSync(bytes);
    const header = Buffer.alloc(30),
      directory = Buffer.alloc(46);
    header.writeUInt32LE(0x04034b50);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(0x800, 6);
    header.writeUInt16LE(8, 8);
    header.writeUInt32LE(crc32(bytes), 14);
    header.writeUInt32LE(compressed.length, 18);
    header.writeUInt32LE(bytes.length, 22);
    header.writeUInt16LE(filename.length, 26);
    directory.writeUInt32LE(0x02014b50);
    directory.writeUInt16LE(20, 4);
    directory.writeUInt16LE(20, 6);
    directory.writeUInt16LE(0x800, 8);
    directory.writeUInt16LE(8, 10);
    directory.writeUInt32LE(crc32(bytes), 16);
    directory.writeUInt32LE(compressed.length, 20);
    directory.writeUInt32LE(bytes.length, 24);
    directory.writeUInt16LE(filename.length, 28);
    directory.writeUInt32LE(offset, 42);
    local.push(header, filename, compressed);
    central.push(directory, filename);
    offset += header.length + filename.length + compressed.length;
  }
  const table = Buffer.concat(central),
    end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(table.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, table, end]);
}

const metadata = [
  ['assets/public/build-info.json', '{"commit":"test"}'],
  ['assets/public/LICENSE.txt', 'License żółć ©'],
  ['assets/public/third-party-licenses.txt', 'Runtime notices'],
];
test('JDK ZIP reading preserves bytes, handles Unicode paths and never extracts archive paths', () => {
  const directory = mkdtempSync(join(tmpdir(), 'APK żółć & %! (test) '));
  try {
    const apk = join(directory, 'public & (test); %!.apk');
    const outside = directory + '-escaped.txt';
    const bytes = zip([...metadata, ['../' + outside.split(/[\\/]/).at(-1), 'outside']]);
    writeFileSync(apk, bytes);
    assert.deepEqual(readApkAssets(apk), {
      'build-info.json': metadata[0][1],
      'LICENSE.txt': metadata[1][1],
      'third-party-licenses.txt': metadata[2][1],
    });
    assert.deepEqual(readFileSync(apk), bytes);
    assert.equal(existsSync(join(directory, 'assets')), false);
    assert.equal(existsSync(outside), false);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('JDK ZIP reading rejects missing, duplicate and oversized public metadata', () => {
  const directory = mkdtempSync(join(tmpdir(), 'upscale-bad-apk-'));
  try {
    const apk = join(directory, 'test.apk');
    for (const entries of [
      metadata.slice(0, 2),
      [...metadata, metadata[0]],
      [[metadata[0][0], 'x'.repeat(65537)], ...metadata.slice(1)],
    ]) {
      writeFileSync(apk, zip(entries));
      assert.throws(() => readApkAssets(apk));
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
