// Trusted native executables only: never pass signing paths through cmd.exe or a batch file.
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, openSync, closeSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export function toolCommand(name, args, env = process.env, platform = process.platform) {
  const paths = platform === 'win32' ? path.win32 : path.posix;
  const suffix = platform === 'win32' ? '.exe' : '';
  const jdk = env.JAVA_HOME;
  const sdk = env.ANDROID_HOME || env.ANDROID_SDK_ROOT;
  if (!jdk || !paths.isAbsolute(jdk)) throw new Error('Set JAVA_HOME to a trusted JDK 21');
  const binary = (tool) => paths.join(jdk, 'bin', tool + suffix);
  if (name === 'keytool') return { file: binary(name), args };
  const javaOptions = ['-Dfile.encoding=UTF-8', '-Duser.language=en', '-Duser.country=US'];
  const source = fileURLToPath(new URL('./AndroidReleaseArchive.java', import.meta.url));
  const java = (mode, values) => {
    if (platform === 'win32' && /[^\x00-\x7f]/.test(source)) {
      throw new Error(
        'Keep the reviewed signing helper files in an ASCII-only directory on Windows.',
      );
    }
    // Windows' JDK launcher can lose characters in native argv. Decode public UTF-8
    // paths/options inside Java instead; credentials never use this transport.
    return {
      file: binary('java'),
      args: [
        ...javaOptions,
        '--source',
        '21',
        source,
        mode,
        ...values.map((value) => Buffer.from(value, 'utf8').toString('base64')),
      ],
    };
  };
  if (name === 'archive') return java('archive', args);
  if (!sdk || !paths.isAbsolute(sdk)) throw new Error('Set ANDROID_HOME to a trusted Android SDK');
  const tools = paths.join(sdk, 'build-tools', '35.0.0');
  if (name === 'apksigner') {
    return java('apksigner', [paths.join(tools, 'lib', 'apksigner.jar'), ...args]);
  }
  if (!['aapt', 'zipalign'].includes(name)) throw new Error('Unsupported release tool');
  return { file: paths.join(tools, name + suffix), args };
}

export function spawnTool(name, args, options = {}) {
  const command = toolCommand(name, args);
  if (!existsSync(command.file)) throw new Error('Missing trusted release tool: ' + command.file);
  return spawnSync(command.file, command.args, { ...options, shell: false });
}

export function runTool(name, args, options = {}) {
  const command = toolCommand(name, args);
  if (!existsSync(command.file)) throw new Error('Missing trusted release tool: ' + command.file);
  return execFileSync(command.file, command.args, {
    encoding: 'utf8',
    stdio: 'pipe',
    maxBuffer: 16 * 1024 * 1024,
    ...options,
    shell: false,
  });
}

export function tarCommand(env = process.env, platform = process.platform) {
  if (platform !== 'win32') return 'tar';
  if (!env.SystemRoot || !path.win32.isAbsolute(env.SystemRoot)) {
    throw new Error('Windows system directory is unavailable');
  }
  return path.win32.join(env.SystemRoot, 'System32', 'tar.exe');
}

export function readSourceProvenance(archive) {
  // Pass a binary file handle, not a filename through tar.exe's native code page.
  // This also avoids PowerShell's text pipelines and does not consume console input.
  const input = openSync(archive, 'r');
  try {
    return JSON.parse(
      execFileSync(tarCommand(), ['-xzOf', '-', './DEPENDENCY-SOURCES.json'], {
        stdio: [input, 'pipe', 'pipe'],
        encoding: 'utf8',
        maxBuffer: 16 * 1024 * 1024,
        shell: false,
      }),
    );
  } finally {
    closeSync(input);
  }
}

export function readApkAssets(apk) {
  const names = ['build-info.json', 'LICENSE.txt', 'third-party-licenses.txt'];
  // The bounded JDK ZipFile reader does not extract archive paths onto the filesystem.
  // Base64 here transports three small public metadata texts, never imported images or keys.
  const lines = runTool('archive', [path.resolve(apk)])
    .trimEnd()
    .split(/\r?\n/);
  if (lines.length !== names.length) throw new Error('Invalid APK metadata response');
  return Object.fromEntries(
    names.map((name, i) => [name, Buffer.from(lines[i], 'base64').toString('utf8')]),
  );
}

export function requireInteractiveSigning(input = process.stdin, output = process.stdout) {
  if (!input.isTTY || !output.isTTY) {
    throw new Error(
      'Signing requires an interactive terminal with hidden Java password prompts. Do not redirect input/output or run in PowerShell ISE.',
    );
  }
}
