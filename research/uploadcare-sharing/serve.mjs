import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { createMockProvider } from './mock.mjs';
import { APP_BASE, APP_PORT, APP_URL, LOOPBACK, PROVIDER_PORT } from './settings.ts';

const path = (relative) => fileURLToPath(new URL(relative, import.meta.url));
const vite = await createServer({
  root: path('./'),
  configFile: false,
  envFile: false,
  mode: 'uploadcare-experiment',
  publicDir: false,
  base: APP_BASE,
  cacheDir: path('../../node_modules/.vite-uploadcare-sharing'),
  esbuild: { jsx: 'automatic' },
  server: {
    host: LOOPBACK,
    port: APP_PORT,
    strictPort: true,
    cors: false,
    hmr: false,
    fs: {
      allow: [
        path('./'),
        path('../../node_modules'),
        path('../../shared'),
        path('../../src'),
        path('../../tests/fixtures/fidelity'),
        path('../../worker/src/image-validation.ts'),
      ],
    },
  },
});
const mock = await createMockProvider();
try {
  await once(mock.listen(PROVIDER_PORT, LOOPBACK), 'listening');
  await vite.listen();
} catch (error) {
  mock.close();
  await vite.close();
  throw error;
}
console.log(`Uploadcare sharing experiment at ${APP_URL}`);

async function stop() {
  mock.close();
  await vite.close();
}
process.once('SIGTERM', () => void stop());
process.once('SIGINT', () => void stop());
