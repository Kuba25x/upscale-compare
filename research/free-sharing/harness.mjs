import { Miniflare, convertV4MiniflareOptions, Log, LogLevel } from 'miniflare';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { mkdir } from 'node:fs/promises';
const root = fileURLToPath(new URL('../../', import.meta.url));
export const scratch = resolve(root, '.wrangler/free-storage-research');
export async function localRuntime({ persistence, caps = {}, enabled = true } = {}) {
  await mkdir(scratch, { recursive: true });
  const output = await build({
    entryPoints: [resolve(root, 'research/free-sharing/prototype.ts')],
    bundle: true,
    platform: 'browser',
    format: 'esm',
    write: false,
    target: 'es2022',
  });
  return new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      script: output.outputFiles[0].text,
      compatibilityDate: '2026-07-01',
      durableObjects: {
        LIBRARY: {
          className: 'ResearchLibrary',
          useSQLite: true,
          unsafeUniqueKey: 'upscale-free-storage-local-v1',
        },
      },
      kvNamespaces: ['ORIGINALS'],
      resourcePersistencePath: persistence,
      bindings: {
        RESEARCH_LOCAL_ONLY: enabled ? 'yes' : 'no',
        RESEARCH_CAPS: JSON.stringify(caps),
      },
      // Fail every attempted external request. Local dispatch requires no DNS.
      outboundService: () => {
        throw new Error('Research outbound networking forbidden.');
      },
      log: new Log(LogLevel.NONE),
      cf: false,
    }),
  );
}
