import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => ({
  plugins: [react()],
  base: loadEnv(mode, process.cwd(), '').VITE_BASE_PATH || '/',
  server: { host: '0.0.0.0', port: 5173 },
  build: { sourcemap: true },
}));
