import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => ({
  plugins: [
    react(),
    ...(mode === 'android'
      ? [
          {
            name: 'android-edge-to-edge-viewport',
            transformIndexHtml: (html: string) =>
              html.replace(
                'width=device-width, initial-scale=1.0',
                'width=device-width, initial-scale=1.0, viewport-fit=cover',
              ),
          },
        ]
      : []),
  ],
  base: mode === 'android' ? '/' : loadEnv(mode, process.cwd(), '').VITE_BASE_PATH || '/',
  server: { host: '0.0.0.0', port: 5173 },
  build: { sourcemap: true, outDir: mode === 'android' ? 'dist-android' : 'dist' },
}));
