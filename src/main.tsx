import React from 'react';
import { createRoot } from 'react-dom/client';
import WebApp from './WebApp';
import { ANDROID_MODE } from './lib/config';
import './styles.css';

async function start() {
  // The web entry never evaluates Capacitor or registers native plugins.
  const RootApp = ANDROID_MODE ? (await import('./AndroidApp')).default : WebApp;
  createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <RootApp />
    </React.StrictMode>,
  );
}
void start();

// Vite removes this entire branch and chunk from Android and development builds.
if (__WEB_PWA__) {
  void import('./pwa/register')
    .then(({ registerOfflineApp }) => registerOfflineApp())
    .catch((error) =>
      console.warn('Offline app shell could not load. Online use can continue.', error),
    );
}
