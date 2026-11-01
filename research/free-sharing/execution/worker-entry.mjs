import jpegModule from './codec-jpeg.wasm';
import webpModule from './codec-webp.wasm';
import { validateOriginal } from './validate.mjs';
export default {
  async fetch(request, env) {
    if (
      env.LOCAL_EXECUTION_RESEARCH !== 'yes' ||
      new URL(request.url).hostname !== 'local-research.invalid'
    )
      return new Response(null, { status: 403 });
    try {
      const { spec, identity } = JSON.parse(request.headers.get('X-Research-Descriptor'));
      // The fixture controller is trusted LOCAL code, never a client certificate.
      const bytes = new Uint8Array(await request.arrayBuffer());
      const result = await validateOriginal(
        bytes,
        spec,
        identity,
        async (format) => ({
          instantiateWasm(imports, callback) {
            const instance = new WebAssembly.Instance(
              format === 'jpeg' ? jpegModule : webpModule,
              imports,
            );
            callback(instance);
            return instance.exports;
          },
        }),
        { isolateProfile: true },
      );
      return Response.json(result);
    } catch (error) {
      return Response.json({ state: 'rejected', reason: String(error) }, { status: 400 });
    }
  },
};
