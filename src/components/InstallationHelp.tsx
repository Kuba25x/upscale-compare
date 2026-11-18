import { useEffect, useState } from 'react';
import { offlineStatus, type OfflineStatus } from '../pwa/offline-status';

export function InstallationHelp() {
  const [status, setStatus] = useState<OfflineStatus>('checking');
  useEffect(() => {
    let disposed = false;
    let check = 0;
    let active: ServiceWorker | undefined;
    const refresh = async () => {
      const current = ++check;
      const result = await offlineStatus();
      if (!disposed && current === check) setStatus(result);
    };
    void refresh();
    window.addEventListener('focus', refresh);
    if (window.isSecureContext && 'serviceWorker' in navigator)
      void navigator.serviceWorker.ready
        .then((registration) => {
          if (disposed) return;
          active = registration.active || undefined;
          active?.addEventListener('statechange', refresh);
          return refresh();
        })
        .catch(() => {});
    return () => {
      disposed = true;
      window.removeEventListener('focus', refresh);
      active?.removeEventListener('statechange', refresh);
    };
  }, []);
  return (
    <section aria-labelledby="installation-offline-title">
      <h3 id="installation-offline-title">Installation and offline</h3>
      <p className="muted small">
        On Android Chrome, open the browser menu and choose Install app or Add to Home screen.
        Installation and offline readiness are separate.
      </p>
      <p className="muted small" role="status" data-testid="offline-readiness">
        {status === 'checking'
          ? 'Checking offline resources…'
          : status === 'ready'
            ? 'App resources are ready offline.'
            : 'Offline resources are not ready. Connect to the internet and reopen Help to check.'}
      </p>
      <p className="muted small">
        Screenshots and metadata stay in memory. Refreshing or reopening starts an empty comparison.
        Browser storage may be cleared; reconnect if the app cannot open offline.
      </p>
      <p className="muted small">
        Updates wait for all existing tabs and app windows to close. Your comparison is never
        automatically reloaded.
      </p>
      <p className="muted small">Version {__APP_RELEASE__}</p>
    </section>
  );
}
