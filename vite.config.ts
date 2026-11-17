import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { webPwaPlugins } from './scripts/pwa-build';
import { execFileSync } from 'node:child_process';
import { version } from './package.json';

function release() {
  try {
    const commit =
      process.env.GITHUB_SHA ||
      execFileSync('git', ['rev-parse', 'HEAD'], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim();
    return `${version}+${commit.slice(0, 8)}`;
  } catch {
    return `${version}+source`;
  }
}

export default defineConfig(({ mode, command }) => {
  const configuredBase =
    mode === 'android' ? '/' : loadEnv(mode, process.cwd(), '').VITE_BASE_PATH || '/';
  const base = configuredBase.endsWith('/') ? configuredBase : `${configuredBase}/`;
  const webPwa = command === 'build' && (mode === 'demo' || mode === 'production');
  return {
    plugins: [react(), ...(webPwa ? webPwaPlugins() : [])],
    base,
    define: { __WEB_PWA__: JSON.stringify(webPwa), __APP_RELEASE__: JSON.stringify(release()) },
    server: { host: '0.0.0.0', port: 5173 },
    build: { sourcemap: true, outDir: mode === 'android' ? 'dist-android' : 'dist' },
  };
});
