import { afterEach, describe, expect, it, vi } from 'vitest';
import { emptyMetadata, emptyImageMetadata, type Manifest } from '../../shared/model';
const manifest: Manifest = {
  metadata: emptyMetadata(),
  images: ['A', 'B'].map((label) => ({ label, metadata: emptyImageMetadata() })),
  config: {
    mode: 'split',
    selected: [0, 1],
    divider: 0.5,
    view: { zoom: null, center: { x: 1, y: 1 } },
  },
};
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.resetModules();
});
describe.each([
  { mode: 'demo', flag: 'false', name: 'demo build even if a flag is overridden' },
  { mode: 'production', flag: 'true', name: 'explicit demo flag' },
])('sharing guard: $name', ({ mode, flag }) => {
  it('prevents every sharing entry point from reaching the network', async () => {
    vi.resetModules();
    vi.stubEnv('MODE', mode);
    vi.stubEnv('VITE_DEMO_MODE', flag);
    vi.stubEnv('VITE_API_URL', 'https://sharing.example');
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    const api = await import('../../src/lib/api');
    expect(api.API_URL).toBe('');
    await expect(api.apiFetch('/api/health')).rejects.toThrow('Public sharing is not available');
    await expect(api.fetchComparison('a'.repeat(16))).rejects.toThrow(
      'Public sharing is not available',
    );
    await expect(api.publish([], manifest, 'token', { key: '', deleteToken: '' })).rejects.toThrow(
      'Public sharing is not available',
    );
    await expect(api.recoverPublication({ key: '', deleteToken: '' })).rejects.toThrow(
      'Public sharing is not available',
    );
    const journal = await import('../../src/lib/publication-journal');
    await expect(journal.preparePublication([], manifest)).rejects.toThrow(
      'Public sharing is not available',
    );
    expect(() => api.publicImageUrl('a'.repeat(16), 0)).toThrow('Public sharing is not available');
    expect(() => api.shareHashUrl('a'.repeat(16))).toThrow('Public sharing is not available');
    expect(fetch).not.toHaveBeenCalled();
  });
});
it('preserves configured production sharing', async () => {
  vi.resetModules();
  vi.stubEnv('MODE', 'production');
  vi.stubEnv('VITE_DEMO_MODE', 'false');
  vi.stubEnv('VITE_API_URL', 'https://sharing.example/');
  const fetch = vi.fn().mockResolvedValue(Response.json({ status: 'ok' }));
  vi.stubGlobal('fetch', fetch);
  const api = await import('../../src/lib/api');
  expect(api.API_URL).toBe('https://sharing.example');
  await api.apiFetch('/api/health');
  expect(fetch).toHaveBeenCalledWith('https://sharing.example/api/health', undefined);
  expect(api.publicImageUrl('a'.repeat(16), 1)).toBe(
    `https://sharing.example/api/comparisons/${'a'.repeat(16)}/images/1`,
  );
});
it('preserves the local development backend outside demo mode', async () => {
  vi.resetModules();
  vi.stubEnv('MODE', 'development');
  vi.stubEnv('VITE_DEMO_MODE', 'false');
  vi.stubEnv('VITE_API_URL', '');
  const api = await import('../../src/lib/api');
  expect(api.API_URL).toBe('http://localhost:8787');
});
