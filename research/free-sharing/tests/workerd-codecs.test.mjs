import { it, expect } from 'vitest';
import { build } from 'esbuild';
import { Miniflare, convertV4MiniflareOptions, Log, LogLevel } from 'miniflare';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { decoderCorpus } from '../corpus.mjs';
import { scratch } from '../harness.mjs';

it('loads precompiled full-codec WASM in local workerd without remote fetch, eval or production bindings', async () => {
  const root = resolve(import.meta.dirname, '..');
  const bundle = await build({
    entryPoints: [resolve(root, 'decoder-worker.mjs')],
    bundle: true,
    write: false,
    platform: 'browser',
    format: 'esm',
    external: ['./codec-jpeg.wasm', './codec-webp.wasm'],
  });
  const mf = new Miniflare(
    convertV4MiniflareOptions({
      modulesRoot: scratch,
      modules: [
        {
          type: 'ESModule',
          path: resolve(scratch, 'decoder-worker.mjs'),
          contents: bundle.outputFiles[0].text,
        },
        {
          type: 'CompiledWasm',
          path: resolve(scratch, 'codec-jpeg.wasm'),
          contents: await readFile(
            resolve(root, 'node_modules/@jsquash/jpeg/codec/dec/mozjpeg_dec.wasm'),
          ),
        },
        {
          type: 'CompiledWasm',
          path: resolve(scratch, 'codec-webp.wasm'),
          contents: await readFile(
            resolve(root, 'node_modules/@jsquash/webp/codec/dec/webp_dec.wasm'),
          ),
        },
      ],
      compatibilityDate: '2026-07-01',
      bindings: { RESEARCH_LOCAL_ONLY: 'yes' },
      outboundService: () => {
        throw new Error('Outbound networking forbidden.');
      },
      log: new Log(LogLevel.NONE),
      cf: false,
    }),
  );
  const samples = [];
  try {
    for (const input of await decoderCorpus()) {
      const start = performance.now(),
        response = await mf.dispatchFetch('http://local-research.invalid/decode', {
          method: 'POST',
          body: input.bytes,
        });
      const result = await response.json(),
        hostRoundTripWallMs = performance.now() - start;
      samples.push({
        name: input.name,
        status: response.status,
        valid: input.valid,
        result,
        hostRoundTripWallMs,
      });
      expect(response.ok, JSON.stringify(result)).toBe(input.valid);
    }
    await writeFile(
      resolve(scratch, 'workerd-codecs.json'),
      JSON.stringify(
        {
          scope:
            'Local workerd WASM compatibility and tiny-fixture decode/rejection; round-trip wall time is not provider CPU or peak isolate memory.',
          samples,
        },
        null,
        2,
      ) + '\n',
    );
  } finally {
    await mf.dispose();
  }
});
