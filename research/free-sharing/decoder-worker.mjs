// Local workerd compatibility experiment only; no production route or binding.
import { validateImage } from '../../worker/src/image-validation';
import { createDecoder, completeDecode } from './codecs.mjs';
import jpegModule from './codec-jpeg.wasm';
import webpModule from './codec-webp.wasm';
export default {
  async fetch(request, env) {
    if (
      env.RESEARCH_LOCAL_ONLY !== 'yes' ||
      new URL(request.url).hostname !== 'local-research.invalid'
    )
      return new Response(null, { status: 403 });
    try {
      const bytes = new Uint8Array(await request.arrayBuffer());
      const info = await validateImage(bytes, {
        maxFileBytes: 20971520,
        maxDimension: 16384,
        maxPixels: 36000000,
      });
      const outputBytes = info.width * info.height * 4;
      // This candidate creates an RGBA output copy; 8K cannot have credible
      // isolate headroom even before WASM/native/runtime state. Reject in LOCAL
      // probe rather than intentionally exhausting a workerd isolate.
      if (outputBytes + bytes.length > 96 * 1024 * 1024)
        return Response.json(
          {
            error: 'Candidate cannot admit this raster within its conservative memory profile.',
            outputBytes,
          },
          { status: 413 },
        );
      const format =
        info.type === 'image/jpeg' ? 'jpeg' : info.type === 'image/webp' ? 'webp' : null;
      if (!format) return new Response(null, { status: 415 });
      const module = format === 'jpeg' ? jpegModule : webpModule;
      const decoder = await createDecoder(format, {
        instantiateWasm(imports, callback) {
          const instance = new WebAssembly.Instance(module, imports);
          callback(instance);
          return instance.exports;
        },
      });
      const image = completeDecode(bytes, info, decoder);
      return Response.json({
        ...info,
        wasmLinearMemoryBytes: decoder.module.HEAPU8.buffer.byteLength,
        jsOutputBytes: image.data.byteLength,
      });
    } catch (error) {
      return Response.json({ error: String(error) }, { status: 415 });
    }
  },
};
