import type { Page } from '@playwright/test';

/** Model physical rotation independently from keyboard-driven layout/visual viewport changes. */
export async function installWebDisplay(
  page: Page,
  source: 'screen' | 'angle' | 'dimensions' = 'screen',
  finePointer = false,
  emulateTouchInput = false,
  mockVisualViewport = true,
) {
  await page.addInitScript(
    ({ source, finePointer, emulateTouchInput, mockVisualViewport }) => {
      const win = window as any;
      const type = () =>
        win.testOrientation ??
        (innerWidth > innerHeight ? 'landscape-primary' : 'portrait-primary');
      const orientation = screen.orientation;
      if (source === 'screen') Object.defineProperty(orientation, 'type', { get: type });
      else Object.defineProperty(screen, 'orientation', { get: () => undefined });
      Object.defineProperty(window, 'orientation', {
        get: () => (source === 'dimensions' ? undefined : type().startsWith('landscape') ? 90 : 0),
      });
      Object.defineProperty(screen, 'width', {
        get: () => (type().startsWith('landscape') ? 900 : 412),
      });
      Object.defineProperty(screen, 'height', {
        get: () => (type().startsWith('landscape') ? 412 : 900),
      });
      addEventListener('resize', () => orientation.dispatchEvent(new Event('change')));
      const match = window.matchMedia.bind(window);
      win.testResolutionQueries = [];
      window.matchMedia = (query: string) => {
        const result = match(query);
        if (query.startsWith('(resolution:')) win.testResolutionQueries.push(result);
        if ((finePointer || emulateTouchInput) && query.includes('pointer: coarse'))
          Object.defineProperty(result, 'matches', { get: () => !finePointer });
        return result;
      };
      if (!mockVisualViewport) return;
      const viewport = visualViewport!;
      for (const [property, fallback] of [
        ['height', () => innerHeight],
        ['width', () => innerWidth],
        ['offsetTop', () => 0],
        ['offsetLeft', () => 0],
      ] as const)
        Object.defineProperty(viewport, property, {
          get: () => win.testVisualViewport?.[property] ?? fallback(),
        });
    },
    { source, finePointer, emulateTouchInput, mockVisualViewport },
  );
}
