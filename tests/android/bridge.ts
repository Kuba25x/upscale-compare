import type { Page } from '@playwright/test';

export async function installAndroidBridge(
  page: Page,
  images: Array<{ name: string; type: string; width: number; height: number; size: number }>,
) {
  await page.addInitScript(
    ({ images }) => {
      const win = window as any;
      const originals = images.map((image, n) => ({
        ...image,
        id: `00000000-0000-4000-8000-00000000000${n + 1}`,
        sha256: 'a'.repeat(64),
      }));
      const paths = Object.fromEntries(
        originals.map((i, n) => [i.id, `${location.origin}/original-${n}.png`]),
      );
      win.androidBridge = {};
      win.systemBarCalls = [];
      win.barsHidden = false;
      win.Capacitor = {
        PluginHeaders: [
          {
            name: 'SystemBars',
            methods: ['hide', 'show'].map((name) => ({ name, rtype: 'promise' })),
          },
          {
            name: 'Originals',
            methods: ['pick', 'restore', 'paths', 'save', 'discard'].map((name) => ({
              name,
              rtype: 'promise',
            })),
          },
          {
            name: 'App',
            methods: ['toggleBackButtonHandler', 'addListener', 'removeListener'].map((name) => ({
              name,
              rtype: name === 'addListener' ? 'callback' : 'promise',
            })),
          },
        ],
        convertFileSrc: (path: string) => path,
        nativeCallback: (_plugin: string, method: string, args: any, callback: any) => {
          if (method === 'addListener') win[`listener-${args.eventName}`] = callback;
          return args.eventName;
        },
        nativePromise: async (plugin: string, method: string, args: any) => {
          if (plugin === 'SystemBars') {
            win.systemBarCalls.push(method);
            win.barsHidden = method === 'hide';
            return {};
          }
          if (plugin === 'App') return {};
          if (method === 'restore')
            return { session: JSON.parse(localStorage.getItem('test-session') || 'null'), paths };
          if (method === 'pick') return { images: win.cancelPick ? [] : originals };
          if (method === 'paths') return { paths };
          if (method === 'save') {
            localStorage.setItem('test-session', JSON.stringify(args.session));
            return {};
          }
          return {};
        },
      };
    },
    { images },
  );
}
