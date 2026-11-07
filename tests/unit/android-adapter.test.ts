import { afterEach, expect, it, vi } from 'vitest';
import { emptyMetadata } from '../../shared/model';
const native = vi.hoisted(() => ({
  pick: vi.fn(),
  paths: vi.fn(),
  discard: vi.fn(),
  save: vi.fn(),
  restore: vi.fn(),
  show: vi.fn(),
  hide: vi.fn(),
}));
vi.mock('@capacitor/core', () => ({
  Capacitor: { convertFileSrc: (path: string) => `local:${path}` },
  registerPlugin: () => native,
}));
afterEach(() => {
  vi.resetModules();
  vi.resetAllMocks();
});
const original = {
  id: '00000000-0000-4000-8000-000000000001',
  name: '8K.png',
  type: 'image/png',
  width: 7680,
  height: 4320,
  size: 64 * 1024 * 1024,
  sha256: 'a'.repeat(64),
};
it('accepts Android originals larger than the unchanged web limit without loading bytes into JS', async () => {
  native.pick.mockResolvedValue({ images: [original] });
  native.paths.mockResolvedValue({ paths: { [original.id]: '/private/original' } });
  const { pickOriginals } = await import('../../src/lib/android');
  const [image] = await pickOriginals(1);
  expect(image.url).toBe('local:/private/original');
  expect(image.file).toBeUndefined();
  const { MAX_FILE_BYTES } = await import('../../shared/model');
  expect(MAX_FILE_BYTES).toBe(20 * 1024 * 1024);
});
it('discards a rejected native batch including unknown-length oversized input', async () => {
  native.pick.mockResolvedValue({ images: [{ ...original, size: 256 * 1024 * 1024 + 1 }] });
  native.discard.mockResolvedValue({});
  const { pickOriginals } = await import('../../src/lib/android');
  await expect(pickOriginals(1)).rejects.toThrow();
  expect(native.discard).toHaveBeenCalledWith({ ids: [original.id] });
  expect(native.paths).not.toHaveBeenCalled();
});
it('does not replace a corrupt saved session with an empty one', async () => {
  native.restore.mockResolvedValue({ session: { images: [] }, paths: {} });
  const { restoreAndroidSession } = await import('../../src/lib/android');
  await expect(restoreAndroidSession()).rejects.toThrow();
  expect(native.save).not.toHaveBeenCalled();
});
it('strips transient URLs from the persisted session and preserves cleanup warnings', async () => {
  native.save.mockResolvedValue({ warning: 'Cleanup will be retried.' });
  const { saveAndroidSession } = await import('../../src/lib/android');
  const result = await saveAndroidSession({
    images: [1, 2].map((n) => ({
      ...original,
      id: `00000000-0000-4000-8000-00000000000${n}`,
      label: `Image ${n}`,
      url: 'file:///private/transient',
      metadata: { technology: '', preset: '', renderingResolution: '' },
    })),
    metadata: emptyMetadata(),
    config: {
      mode: 'split',
      selected: [0, 1],
      divider: 0.5,
      view: { zoom: null, center: { x: 0, y: 0 } },
    },
  });
  expect(result.warning).toContain('Cleanup');
  expect(native.save).toHaveBeenCalledOnce();
  const saved = native.save.mock.calls[0][0].session.images[0];
  expect(saved.url).toBeUndefined();
  expect(saved.file).toBeUndefined();
  expect(saved.sha256).toBe(original.sha256);
  expect(saved.size).toBe(original.size);
});

it('keeps Android system bars visible without a hide API in fullscreen transitions', async () => {
  const { ensureAndroidSystemBarsVisible } = await import('../../src/lib/android');
  await ensureAndroidSystemBarsVisible();
  expect(native.show).toHaveBeenCalledOnce();
  expect(native.hide).not.toHaveBeenCalled();
  const { default: config } = await import('../../capacitor.config');
  expect(config.plugins?.SystemBars).toMatchObject({ hidden: false, insetsHandling: 'native' });
});
