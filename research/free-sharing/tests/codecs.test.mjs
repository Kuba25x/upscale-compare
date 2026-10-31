import { beforeAll, describe, expect, it } from 'vitest';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { validateImage } from '../../../worker/src/image-validation';
import { createDecoder, completeDecode } from '../codecs.mjs';
import { decoderCorpus } from '../corpus.mjs';
import { scratch } from '../harness.mjs';

const limits = { maxFileBytes: 20971520, maxDimension: 16384, maxPixels: 36000000 };
const root = resolve(import.meta.dirname, '..'),
  results = [];
let decoders, corpus;
beforeAll(async () => {
  decoders = {};
  for (const [format, file] of [
    ['jpeg', 'mozjpeg_dec'],
    ['webp', 'webp_dec'],
  ])
    decoders[format] = await createDecoder(format, {
      wasmBinary: await readFile(
        resolve(root, `node_modules/@jsquash/${format}/codec/dec/${file}.wasm`),
      ),
    });
  corpus = await decoderCorpus();
});
describe('additional complete-codec candidate without changing existing checks', () => {
  for (const name of [
    'jpeg-baseline',
    'jpeg-progressive',
    'webp-lossy',
    'webp-lossless-alpha',
    'jpeg-missing-tables-blocks',
    'webp-missing-coded-raster',
    'jpeg-truncated-entropy-valid-eoi',
    'jpeg-oversubscribed-huffman-table',
    'jpeg-missing-eoi',
    'webp-truncated-vp8-correct-container',
    'webp-truncated-vp8l-correct-container',
    'webp-truncated-container',
    'jpeg-rotated-exif',
    'jpeg-valid-after-rejections',
    'webp-valid-after-rejections',
  ]) {
    it(name, async () => {
      const item = corpus.find((x) => x.name === name),
        before = createHash('sha256').update(item.bytes).digest('hex');
      decoders[item.format].warnings.length = 0;
      let currentAccepted = false,
        candidateAccepted = false,
        error;
      try {
        const info = await validateImage(item.bytes, limits);
        currentAccepted = true;
        completeDecode(item.bytes, info, decoders[item.format]);
        candidateAccepted = true;
      } catch (e) {
        error = String(e);
      }
      expect(createHash('sha256').update(item.bytes).digest('hex')).toBe(before);
      results.push({
        name,
        bytes: item.bytes.length,
        sha256: before,
        valid: item.valid,
        currentAccepted,
        candidateAccepted,
        error,
        warnings: [...decoders[item.format].warnings],
      });
      // Required strictness; if a tolerant decoder accepts these, the candidate
      // is insufficient and needs investigation rather than weakening this test.
      expect(candidateAccepted).toBe(item.valid);
      await writeFile(
        resolve(scratch, 'codec-tests.json'),
        JSON.stringify(
          {
            scope:
              'Finite local malformed/valid fixture matrix, not complete codec/security proof.',
            results,
          },
          null,
          2,
        ) + '\n',
      );
    });
  }
});
