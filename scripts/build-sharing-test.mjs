import { build } from 'vite';
import settings from '../tests/production-sharing/settings.json' with { type: 'json' };

for (const address of [settings.frontendOrigin, settings.missingKeyOrigin, settings.apiOrigin]) {
  if (new URL(address).hostname !== '127.0.0.1')
    throw new Error('Sharing tests require loopback URLs.');
}
Object.assign(process.env, {
  VITE_BASE_PATH: settings.basePath,
  VITE_API_URL: settings.apiOrigin,
  VITE_DEMO_MODE: 'false',
});
for (const [directory, siteKey] of [
  ['with-key', settings.siteKey],
  ['missing-key', ''],
]) {
  process.env.VITE_TURNSTILE_SITE_KEY = siteKey;
  await build({
    mode: 'production',
    build: { outDir: `${settings.outputRoot}/${directory}`, emptyOutDir: true },
  });
}
