import { useLayoutEffect, useState } from 'react';
import {
  phoneOrientation,
  WEB_PRESENTATION,
  type ComparisonPresentation,
} from './comparison-presentation';
import { isManifestFullscreenLaunch } from './web-app-context';

export function isLandscapeScreen(
  type: string | undefined,
  angle: number | undefined,
  screen: {
    width: number;
    height: number;
  },
): boolean {
  if (type?.startsWith('landscape')) return true;
  if (type?.startsWith('portrait')) return false;
  if (typeof angle === 'number') return Math.abs(angle % 180) === 90;
  // Screen dimensions do not shrink when a portrait keyboard reduces the visual viewport.
  return screen.width > screen.height;
}

export function compactWebLayout(
  coarseWithoutHover: boolean,
  landscape: boolean,
  width: number,
  height: number,
): boolean {
  return coarseWithoutHover && landscape && width <= 1120 && height <= 620;
}

export function mobileWebControls(coarseWithoutHover: boolean, width: number): boolean {
  return coarseWithoutHover && width <= 1120;
}

export function useWebViewport() {
  const [viewportState, setViewportState] = useState({
    presentation: WEB_PRESENTATION,
    mobile: false,
    desktop: false,
    installedLandscape: false,
    installedFullscreen: false,
  });
  useLayoutEffect(() => {
    const root = document.documentElement;
    const probe = document.createElement('div');
    probe.style.cssText =
      'position:fixed;top:0;left:0;visibility:hidden;pointer-events:none;width:0;height:0;box-sizing:content-box;padding:env(safe-area-inset-top,0px) env(safe-area-inset-right,0px) env(safe-area-inset-bottom,0px) env(safe-area-inset-left,0px)';
    probe.setAttribute('aria-hidden', 'true');
    document.body.append(probe);
    const input = matchMedia('(pointer: coarse) and (hover: none)');
    const desktopInput = matchMedia('(pointer: fine) and (hover: hover)');
    const standalone = matchMedia('(display-mode: standalone)');
    const fullscreen = matchMedia('(display-mode: fullscreen)');
    const browser = matchMedia('(display-mode: browser)');
    // Only classify a manifest-fullscreen launch at document startup. A tab may
    // later enter API fullscreen or F11, which must never promote its context.
    const manifestLaunch = isManifestFullscreenLaunch({
      enabled: __WEB_PWA__,
      search: location.search,
      fullscreen: fullscreen.matches,
      browser: browser.matches,
      apiFullscreen: Boolean(document.fullscreenElement),
    });
    let installed = standalone.matches;
    const orientation = screen.orientation;
    const viewport = window.visualViewport;
    let resolution: MediaQueryList;
    let frame = 0;
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(measure);
    };
    const measure = () => {
      const width = root.clientWidth;
      const height = window.innerHeight;
      const dpr = window.devicePixelRatio || 1;
      const landscape = isLandscapeScreen(orientation?.type, window.orientation, screen);
      // Fullscreen temporarily replaces the display-mode media query. Remember the
      // app-window context, without treating fullscreen browser tabs as installed.
      const installedFullscreen = manifestLaunch && fullscreen.matches && !browser.matches;
      if (!document.fullscreenElement) installed = standalone.matches || installedFullscreen;
      const compact = compactWebLayout(input.matches, landscape, width, height);
      const style = getComputedStyle(probe);
      const insets = {
        layoutTop: 0,
        layoutBottom: 0,
        safeTop: parseFloat(style.paddingTop) || 0,
        safeRight: parseFloat(style.paddingRight) || 0,
        safeBottom: parseFloat(style.paddingBottom) || 0,
        safeLeft: parseFloat(style.paddingLeft) || 0,
      };
      const next: ComparisonPresentation = {
        edgeToEdge: compact,
        ready: true,
        compact,
        minimalist: false,
        phone: input.matches ? phoneOrientation(screen, landscape) : undefined,
        viewportKey: [
          orientation?.type ?? landscape,
          dpr,
          document.fullscreenElement === root,
          installedFullscreen,
          ...Object.values(insets),
        ].join(':'),
        insets,
      };
      const visual = {
        height: viewport?.height ?? height,
        width: viewport?.width ?? width,
        top: viewport?.offsetTop ?? 0,
        left: viewport?.offsetLeft ?? 0,
      };
      for (const [name, value] of Object.entries({
        '--web-visual-height': visual.height,
        '--web-visual-width': visual.width,
        '--web-visual-top': visual.top,
        '--web-visual-left': visual.left,
        '--web-visual-bottom': Math.max(0, height - visual.height - visual.top),
      }))
        root.style.setProperty(name, `${value}px`);
      const nextState = {
        presentation: next,
        mobile: mobileWebControls(input.matches, width),
        desktop: desktopInput.matches && !input.matches,
        installedLandscape: installed && input.matches && landscape,
        installedFullscreen,
      };
      setViewportState((previous) =>
        JSON.stringify(previous) === JSON.stringify(nextState) ? previous : nextState,
      );
      if (!resolution || !resolution.matches) {
        resolution?.removeEventListener('change', schedule);
        resolution = matchMedia(`(resolution: ${dpr}dppx)`);
        resolution.addEventListener('change', schedule);
      }
    };
    const observer = new ResizeObserver(schedule);
    observer.observe(root);
    observer.observe(probe, { box: 'border-box' });
    window.addEventListener('resize', schedule);
    window.addEventListener('orientationchange', schedule);
    orientation?.addEventListener('change', schedule);
    input.addEventListener('change', schedule);
    desktopInput.addEventListener('change', schedule);
    standalone.addEventListener('change', schedule);
    fullscreen.addEventListener('change', schedule);
    browser.addEventListener('change', schedule);
    document.addEventListener('fullscreenchange', schedule);
    viewport?.addEventListener('resize', schedule);
    viewport?.addEventListener('scroll', schedule);
    measure();
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener('resize', schedule);
      window.removeEventListener('orientationchange', schedule);
      orientation?.removeEventListener('change', schedule);
      input.removeEventListener('change', schedule);
      desktopInput.removeEventListener('change', schedule);
      standalone.removeEventListener('change', schedule);
      fullscreen.removeEventListener('change', schedule);
      browser.removeEventListener('change', schedule);
      document.removeEventListener('fullscreenchange', schedule);
      resolution?.removeEventListener('change', schedule);
      viewport?.removeEventListener('resize', schedule);
      viewport?.removeEventListener('scroll', schedule);
      probe.remove();
      for (const name of ['height', 'width', 'top', 'left', 'bottom'])
        root.style.removeProperty(`--web-visual-${name}`);
    };
  }, []);
  return viewportState;
}
