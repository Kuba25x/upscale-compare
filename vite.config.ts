import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { webPwaPlugins } from './scripts/pwa-build';

export default defineConfig(({ mode, command }) => {
  const configuredBase =
    mode === 'android' ? '/' : loadEnv(mode, process.cwd(), '').VITE_BASE_PATH || '/';
  const base = configuredBase.endsWith('/') ? configuredBase : `${configuredBase}/`;
  const webPwa = command === 'build' && (mode === 'demo' || mode === 'production');
  return {
    plugins: [react(), ...(webPwa ? webPwaPlugins() : [])],
    base,
    server: { host: '0.0.0.0', port: 5173 },
    build: { sourcemap: true, outDir: mode === 'android' ? 'dist-android' : 'dist' },
  };
});
