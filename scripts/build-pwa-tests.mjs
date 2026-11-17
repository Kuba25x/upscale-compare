import { build } from 'vite';

// Disposable, local-only A/B releases. Never used by publishing workflows.
for (const [name, base] of [
  ['root', '/'],
  ['pages', '/upscale-compare/'],
]) {
  process.env.VITE_BASE_PATH = base;
  for (const [release, commit] of [
    ['a', 'aaaaaaa1'],
    ['b', 'bbbbbbb2'],
  ]) {
    await build({
      mode: 'demo',
      logLevel: 'error',
      define: { __APP_RELEASE__: JSON.stringify(`0.1.0+${commit}`) },
      build: { outDir: `.wrangler/pwa-tests/${name}-${release}`, emptyOutDir: true },
    });
  }
}
