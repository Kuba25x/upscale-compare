import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const register = vi.fn<(url: URL, options: RegistrationOptions) => Promise<unknown>>();
let load: (() => void) | undefined;
beforeEach(() => {
  register.mockReset().mockResolvedValue({});
  load = undefined;
  vi.stubGlobal('__APP_RELEASE__', '0.1.0+test1234');
  vi.stubEnv('BASE_URL', '/upscale-compare/');
  vi.stubGlobal('window', {
    isSecureContext: true,
    location: { origin: 'https://example.test' },
    addEventListener: (_event: string, callback: () => void) => {
      load = callback;
    },
  });
  vi.stubGlobal('document', { readyState: 'loading' });
  vi.stubGlobal('navigator', { serviceWorker: { register } });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('web offline registration', () => {
  it('waits for load and registers the stable, scoped URL without the HTTP cache', async () => {
    const { registerOfflineApp } = await import('../../src/pwa/register');
    registerOfflineApp();
    expect(register).not.toHaveBeenCalled();
    load!();
    await vi.waitFor(() => expect(register).toHaveBeenCalledOnce());
    expect(register.mock.calls[0][0].href).toBe('https://example.test/upscale-compare/sw.js');
    expect(register.mock.calls[0][1]).toEqual({
      scope: '/upscale-compare/',
      updateViaCache: 'none',
    });
  });
  it('registers when the web-only module loads after the page load event', async () => {
    vi.stubGlobal('document', { readyState: 'complete' });
    (await import('../../src/pwa/register')).registerOfflineApp();
    await vi.waitFor(() => expect(register).toHaveBeenCalledOnce());
  });
  for (const unsupported of ['insecure', 'missing API']) {
    it(`leaves normal online use alone with ${unsupported}`, async () => {
      if (unsupported === 'insecure') window.isSecureContext = false;
      else vi.stubGlobal('navigator', {});
      (await import('../../src/pwa/register')).registerOfflineApp();
      expect(() => load!()).not.toThrow();
      expect(register).not.toHaveBeenCalled();
    });
  }
  it('contains registration failures without an unhandled rejection or reload', async () => {
    register.mockRejectedValue(new Error('Storage or network unavailable'));
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
    (await import('../../src/pwa/register')).registerOfflineApp();
    load!();
    await vi.waitFor(() => expect(warning).toHaveBeenCalledOnce());
    expect(warning.mock.calls[0][0]).toContain('0.1.0+test1234');
  });
});
