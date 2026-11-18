export type OfflineStatus = 'checking' | 'ready' | 'unavailable';
type Shell = { release: string; cachePrefix: string; assets: string[] };

function shell(document: Document): Shell | undefined {
  try {
    const data = JSON.parse(
      document.getElementById('upscale-compare-offline-shell')?.textContent || '',
    );
    if (
      data.release !== __APP_RELEASE__ ||
      data.cachePrefix !== 'upscale-compare' ||
      !Array.isArray(data.assets) ||
      !data.assets.length
    )
      return;
    return data;
  } catch {
    return;
  }
}

export async function offlineStatus(): Promise<OfflineStatus> {
  try {
    if (!window.isSecureContext || !('serviceWorker' in navigator) || !('caches' in window))
      return 'unavailable';
    const expected = shell(document);
    if (!expected) return 'unavailable';
    const base = new URL(import.meta.env.BASE_URL, location.origin);
    const registration = await navigator.serviceWorker.getRegistration(base.href);
    if (
      registration?.scope !== base.href ||
      registration.active?.state !== 'activated' ||
      registration.active.scriptURL !== new URL('sw.js', base).href
    )
      return 'unavailable';
    for (const name of await caches.keys()) {
      if (
        !name.startsWith(`${expected.cachePrefix}-precache-`) ||
        !name.endsWith(registration.scope)
      )
        continue;
      const cache = await caches.open(name);
      const entries = await cache.keys();
      const normalize = (url: string) => {
        const value = new URL(url);
        value.searchParams.delete('__WB_REVISION__');
        return value.href;
      };
      if (
        !expected.assets.every((asset) =>
          entries.some((entry) => normalize(entry.url) === new URL(asset, location.origin).href),
        )
      )
        continue;
      // Waiting updates share this cache; verify this document's release too.
      for (const entry of entries.filter(
        (entry) => normalize(entry.url) === new URL('index.html', base).href,
      )) {
        const response = await cache.match(entry);
        if (!response?.ok) continue;
        const cached = shell(new DOMParser().parseFromString(await response.text(), 'text/html'));
        if (cached && JSON.stringify(cached.assets) === JSON.stringify(expected.assets))
          return 'ready';
      }
    }
  } catch {
    /* Storage restrictions and eviction must not affect comparison. */
  }
  return 'unavailable';
}
