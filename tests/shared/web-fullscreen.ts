import type { Page } from '@playwright/test';

export type FullscreenOutcome =
  'success' | 'missing' | 'reject' | 'throw' | 'delayed' | 'request-only';

/** Model API lifecycle separately from CSS presentation; real browser fullscreen has its own test. */
export async function installFullscreen(page: Page, outcome: FullscreenOutcome) {
  await page.addInitScript((outcome) => {
    const win = window as any;
    let element: Element | null = null;
    const pending: Array<() => void> = [];
    win.fullscreenCalls = [];
    const change = (next: Element | null) => {
      element = next;
      document.dispatchEvent(new Event('fullscreenchange'));
    };
    win.completeFullscreen = (index: number) => pending[index]();
    win.systemFullscreenExit = () => change(null);
    win.externalFullscreen = () => change(document.documentElement);
    Object.defineProperty(document, 'fullscreenElement', { get: () => element });
    Object.defineProperty(HTMLElement.prototype, 'requestFullscreen', {
      configurable: true,
      value:
        outcome === 'missing'
          ? undefined
          : function (options?: FullscreenOptions) {
              win.fullscreenCalls.push({
                method: 'request',
                active: navigator.userActivation?.isActive ?? null,
                ...(options ? { options } : {}),
              });
              if (outcome === 'throw') throw new Error('Fullscreen unavailable');
              if (outcome === 'reject') return Promise.reject(new Error('Fullscreen denied'));
              if (outcome === 'delayed')
                return new Promise<void>((resolve) =>
                  pending.push(() => {
                    change(document.documentElement);
                    resolve();
                  }),
                );
              change(document.documentElement);
              return Promise.resolve();
            },
    });
    Object.defineProperty(document, 'exitFullscreen', {
      configurable: true,
      value:
        outcome === 'request-only'
          ? undefined
          : async () => {
              win.fullscreenCalls.push({ method: 'exit' });
              if (win.rejectFullscreenExit) throw new Error('System exit required');
              if (win.deferFullscreenExit)
                return new Promise<void>((resolve) => {
                  win.completeFullscreenExit = () => {
                    change(null);
                    resolve();
                  };
                });
              change(null);
            },
    });
  }, outcome);
}
