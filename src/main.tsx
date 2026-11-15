import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { ANDROID_MODE } from './lib/config';
import './styles.css';

async function start() {
  // The web entry never evaluates Capacitor or registers native plugins.
  const RootApp = ANDROID_MODE ? (await import('./AndroidApp')).default : App;
  createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <RootApp />
    </React.StrictMode>,
  );
}
void start();
