// Kept in the web-only chunk for release diagnostics and the later help UI.
export const APP_RELEASE = __APP_RELEASE__;

export function registerOfflineApp(): void {
  const register = async () => {
    if (!window.isSecureContext || !('serviceWorker' in navigator)) return;
    try {
      const base = new URL(import.meta.env.BASE_URL, window.location.origin);
      await navigator.serviceWorker.register(new URL('sw.js', base), {
        scope: base.pathname,
        updateViaCache: 'none',
      });
      // Browser lifecycle only: no skipWaiting, clientsClaim, update polling,
      // controllerchange reload or persistence of the comparison in memory.
    } catch (error) {
      console.warn(
        `Offline app shell unavailable (${APP_RELEASE}). Online use can continue.`,
        error,
      );
    }
  };
  if (document.readyState === 'complete') void register();
  else window.addEventListener('load', () => void register(), { once: true });
}
