import { registerPlugin, type PluginListenerHandle } from '@capacitor/core';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ANDROID_MODE } from './config';

export interface AndroidDisplayState {
  revision: number;
  minimalist: boolean;
  landscape: boolean;
  width: number;
  height: number;
  statusVisible: boolean;
  navigationVisible: boolean;
  layoutTop: number;
  layoutBottom: number;
  safeTop: number;
  safeRight: number;
  safeBottom: number;
  safeLeft: number;
  cutouts: Array<{ left: number; top: number; right: number; bottom: number }>;
}
const DisplayLayout = registerPlugin<{
  getState(): Promise<AndroidDisplayState>;
  setMode(options: { minimalist: boolean }): Promise<AndroidDisplayState>;
  addListener(
    event: 'layoutChange',
    listener: (state: AndroidDisplayState) => void,
  ): Promise<PluginListenerHandle>;
}>('DisplayLayout');

export function useAndroidDisplay(onError: (message: string) => void) {
  const [display, setDisplay] = useState<AndroidDisplayState>();
  const revision = useRef(-1);
  const apply = useCallback((state: AndroidDisplayState) => {
    if (state.revision < revision.current) return;
    revision.current = state.revision;
    // Native coordinates are physical pixels. Match the viewer's actual WebView DPR.
    const dpr = window.devicePixelRatio || 1;
    for (const key of [
      'layoutTop',
      'layoutBottom',
      'safeTop',
      'safeRight',
      'safeBottom',
      'safeLeft',
    ] as const) {
      const name = key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
      document.documentElement.style.setProperty(`--android-${name}`, `${state[key] / dpr}px`);
    }
    setDisplay(state);
  }, []);
  useEffect(() => {
    if (!ANDROID_MODE) return;
    let active = true;
    const accept = (state: AndroidDisplayState) => {
      if (active) apply(state);
    };
    const listener = DisplayLayout.addListener('layoutChange', accept);
    void DisplayLayout.getState()
      .then(accept)
      .catch(() => {
        if (active) onError('Could not configure Android display layout. Restart the app.');
      });
    return () => {
      active = false;
      void listener.then((handle) => handle.remove());
    };
  }, [apply, onError]);
  const setMinimalist = useCallback(
    async (minimalist: boolean) => {
      try {
        apply(await DisplayLayout.setMode({ minimalist }));
      } catch {
        onError('Could not change Android display mode.');
      }
    },
    [apply, onError],
  );
  return { display, setMinimalist };
}
