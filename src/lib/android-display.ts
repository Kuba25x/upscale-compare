import { registerPlugin, type PluginListenerHandle } from '@capacitor/core';
import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import {
  phoneOrientation,
  presentationStyle,
  type ComparisonPresentation,
} from './comparison-presentation';

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
  panelSafeBottom: number;
  mandatoryGestureBottom: number;
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
  const [presentation, setPresentation] = useState<ComparisonPresentation>({
    edgeToEdge: true,
    ready: false,
    compact: false,
    minimalist: false,
  });
  const revision = useRef(-1);
  const apply = useCallback((state: AndroidDisplayState) => {
    if (state.revision < revision.current) return;
    revision.current = state.revision;
    // Native coordinates are physical pixels. Match the viewer's actual WebView DPR.
    const dpr = window.devicePixelRatio || 1;
    const next: ComparisonPresentation = {
      edgeToEdge: true,
      ready: state.width > 0,
      compact: state.landscape,
      minimalist: state.minimalist,
      phone: phoneOrientation(screen, state.landscape),
      viewportKey: [
        state.landscape,
        state.layoutTop,
        state.layoutBottom,
        state.width,
        state.height,
      ].join(':'),
      insets: {
        layoutTop: state.layoutTop / dpr,
        layoutBottom: state.layoutBottom / dpr,
        safeTop: state.safeTop / dpr,
        safeRight: state.safeRight / dpr,
        safeBottom: state.safeBottom / dpr,
        safeLeft: state.safeLeft / dpr,
        panelSafeBottom: (state.panelSafeBottom ?? 0) / dpr,
        mandatoryGestureBottom: (state.mandatoryGestureBottom ?? 0) / dpr,
      },
    };
    // Publish the measured CSS variables before notifying React, as in the native layout path.
    for (const [name, value] of Object.entries(presentationStyle(next)))
      document.documentElement.style.setProperty(name, String(value));
    setPresentation(next);
  }, []);
  // Start the display adapter before the child App's passive session/lifecycle effects.
  useLayoutEffect(() => {
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
  return { presentation, setMinimalist };
}
