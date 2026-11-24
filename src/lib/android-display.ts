import { registerPlugin, type PluginListenerHandle } from '@capacitor/core';
import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import {
  phoneOrientation,
  presentationStyle,
  type ComparisonPresentation,
} from './comparison-presentation';

interface PanelCorner {
  x: number;
  y: number;
  radius: number;
}

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
  panelGuardBottom: number;
  panelClearanceBottom: number;
  panelObstructionBottom?: number;
  panelRoundedCorners?: { left?: PanelCorner; right?: PanelCorner };
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

function cornerClearance(height: number, corner: PanelCorner, distance: number): number {
  if (distance <= 0) return 0;
  const arc = Math.sqrt(Math.max(0, corner.radius ** 2 - distance ** 2));
  return Math.max(0, height - corner.y - arc);
}

export function useAndroidDisplay(onError: (message: string) => void) {
  const [{ presentation, state }, setDisplay] = useState<{
    presentation: ComparisonPresentation;
    state?: AndroidDisplayState;
  }>({
    presentation: { edgeToEdge: true, ready: false, compact: false, minimalist: false },
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
        panelGuardBottom: (state.panelGuardBottom ?? state.mandatoryGestureBottom ?? 0) / dpr,
        panelClearanceBottom:
          (state.panelClearanceBottom ?? Math.max(state.layoutBottom, state.panelSafeBottom ?? 0)) /
          dpr,
        panelObstructionBottom: (state.panelObstructionBottom ?? 0) / dpr,
        ...(state.height > 0 && { panelViewportHeight: state.height / dpr }),
      },
    };
    // Publish the measured CSS variables before notifying React, as in the native layout path.
    for (const [name, value] of Object.entries(presentationStyle(next)))
      document.documentElement.style.setProperty(name, String(value));
    setDisplay({ presentation: next, state });
  }, []);
  const observePortraitImagePanel = useCallback(
    (panel: HTMLDivElement) => {
      const corners = state?.panelRoundedCorners;
      if (!state || state.height <= 0 || (!corners?.left && !corners?.right)) return;
      const controls = Array.from(panel.querySelectorAll('.phone-image-trigger, .swap-button'));
      if (controls.length !== 3) return;

      const property = '--phone-panel-rounded-bottom';
      const viewport = window.visualViewport;
      const update = () => {
        // Keep the conservative native estimate while the WebView is zoomed or panned.
        if (viewport && (viewport.scale !== 1 || viewport.offsetLeft !== 0)) {
          panel.style.removeProperty(property);
          return;
        }
        const dpr = window.devicePixelRatio || 1;
        const bounds = controls.map((control) => control.getBoundingClientRect());
        const left = Math.min(...bounds.map((box) => box.left)) * dpr;
        const right = Math.max(...bounds.map((box) => box.right)) * dpr;
        if (bounds.some((box) => box.width === 0) || left < 0 || right > state.width) {
          panel.style.removeProperty(property);
          return;
        }
        const clearance = Math.max(
          corners.left ? cornerClearance(state.height, corners.left, corners.left.x - left) : 0,
          corners.right ? cornerClearance(state.height, corners.right, right - corners.right.x) : 0,
        );
        const value = `${clearance / dpr}px`;
        if (panel.style.getPropertyValue(property) !== value)
          panel.style.setProperty(property, value);
      };
      const observer = new ResizeObserver(update);
      observer.observe(panel);
      for (const control of controls) observer.observe(control);
      viewport?.addEventListener('resize', update);
      viewport?.addEventListener('scroll', update);
      update();
      return () => {
        observer.disconnect();
        viewport?.removeEventListener('resize', update);
        viewport?.removeEventListener('scroll', update);
        panel.style.removeProperty(property);
      };
    },
    [state],
  );
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
  return { presentation, setMinimalist, observePortraitImagePanel };
}
