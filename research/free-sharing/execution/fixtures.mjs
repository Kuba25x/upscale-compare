import { build } from 'esbuild';
import { readFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { hash } from './controller.mjs';
export const root = resolve(import.meta.dirname, '../../..');
export const output = resolve(root, '.wrangler/free-validation-execution');
export async function components() {
  await mkdir(output, { recursive: true });
  await build({
    stdin: {
      contents: `export {validateImage} from './worker/src/image-validation'; export {rasterPng,pngChunk} from './tests/fixtures/png';`,
      resolveDir: root,
      loader: 'ts',
    },
    bundle: true,
    format: 'esm',
    platform: 'node',
    outfile: resolve(output, 'components.mjs'),
  });
  return import(resolve(output, 'components.mjs'));
}
export async function describe(bytes, name, type, validator) {
  let info;
  try {
    info = await validator(bytes, {
      maxFileBytes: 20971520,
      maxDimension: 16384,
      maxPixels: 36000000,
    });
  } catch {
    info = { width: 1, height: 1, type };
  }
  return { name, bytes, type, ...info, sha256: hash(bytes) };
}
export async function workloadCases() {
  const { validateImage, rasterPng, pngChunk } = await components(),
    files = [];
  const pngs = [
    ['4k-png8-grid', await readFile(resolve(root, 'tests/fixtures/fidelity/uhd.png'))],
    ['8k-png8-zero', rasterPng(7680, 4320)],
    ['4k-png16-zero', rasterPng(3840, 2160, 16)],
    ['8k-png16-zero', rasterPng(7680, 4320, 16)],
  ];
  for (const [name, bytes] of pngs)
    files.push(await describe(bytes, name, 'image/png', validateImage));
  for (const name of ['4k-png8-noise', '8k-png8-noise'])
    files.push(
      await describe(
        await readFile(resolve(output, 'png-inputs', name + '.png')),
        name,
        'image/png',
        validateImage,
      ),
    );
  const catalog = JSON.parse(
    await readFile(
      resolve(root, '.wrangler/free-storage-research/codec-inputs/catalog.json'),
      'utf8',
    ),
  );
  for (const item of catalog.fixtures) {
    const bytes = await readFile(
      resolve(root, '.wrangler/free-storage-research/codec-inputs', item.name),
    );
    if (hash(bytes) !== item.sha256) throw new Error('Synthetic codec fixture changed.');
    files.push(
      await describe(
        bytes,
        item.name,
        item.name.endsWith('.jpg') ? 'image/jpeg' : 'image/webp',
        validateImage,
      ),
    );
  }
  function pad(base, size) {
    const text = Buffer.alloc(size - base.length - 12, 120);
    text.write('Padding\0');
    return Buffer.concat([base.subarray(0, 33), pngChunk('tEXt', text), base.subarray(33)]);
  }
  for (const name of ['4k-png8-grid', '8k-png8-zero']) {
    const base = files.find((f) => f.name === name);
    files.push(
      await describe(pad(base.bytes, 20971520), name + '-20mib', 'image/png', validateImage),
    );
  }
  const cases = files.map((f) => ({ name: f.name, files: [f, f] }));
  const ten = await describe(
    pad(files[0].bytes, 10485760),
    '4k-png8-10mib',
    'image/png',
    validateImage,
  );
  cases.push({ name: 'four-4k-png-exact-40mib', files: [ten, ten, ten, ten] });
  const mixed = [];
  for (const name of ['baseline.jpg', 'progressive.jpg', 'lossy.webp', 'lossless-alpha.webp'])
    mixed.push(
      await describe(
        await readFile(resolve(root, 'tests/fixtures/fidelity', name)),
        name,
        name.endsWith('.jpg') ? 'image/jpeg' : 'image/webp',
        validateImage,
      ),
    );
  cases.push({ name: 'four-mixed-small-originals', files: mixed });
  return cases;
}
