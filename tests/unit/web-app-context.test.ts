import { expect, it } from 'vitest';
import { isManifestFullscreenLaunch, pwaStartUrl } from '../../src/lib/web-app-context';

const launch = {
  enabled: true,
  search: '?pwa=fullscreen',
  fullscreen: true,
  browser: false,
  apiFullscreen: false,
};

it('requires the explicit launch hint, native fullscreen and a PWA-enabled build', () => {
  expect(isManifestFullscreenLaunch(launch)).toBe(true);
  for (const change of [
    { search: '' },
    { search: '?pwa=standalone' },
    { fullscreen: false },
    { browser: true },
    { apiFullscreen: true },
    { enabled: false },
  ])
    expect(isManifestFullscreenLaunch({ ...launch, ...change })).toBe(false);
});

it('does not identify ordinary browser/API/F11 fullscreen as an installed launch', () => {
  for (const apiFullscreen of [false, true])
    expect(isManifestFullscreenLaunch({ ...launch, search: '', apiFullscreen })).toBe(false);
  expect(isManifestFullscreenLaunch({ ...launch, browser: true })).toBe(false);
  expect(isManifestFullscreenLaunch({ ...launch, apiFullscreen: true })).toBe(false);
});

it('keeps launch URLs inside root and Pages scopes without changing their identities', () => {
  for (const base of ['/', '/upscale-compare/']) {
    const url = new URL(pwaStartUrl(base), 'https://example.test');
    expect(url.pathname).toBe(base);
    expect(url.search).toBe('?pwa=fullscreen');
    expect(url.hash).toBe('');
  }
});
