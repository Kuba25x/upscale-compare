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
      win.displayCalls = [];
      win.displayInsets = {};
      let minimalist = false;
      let revision = 0;
      win.emitDisplayState = () => {
        const landscape = innerWidth > innerHeight;
        const i = win.displayInsets;
        const px = (n: number = 0) => n * devicePixelRatio;
        const layoutTop =
          !landscape && !minimalist ? Math.max(i.statusTop || 0, i.cutoutTop || 0) : 0;
        const layoutBottom = landscape ? 0 : i.navigationBottom || 0;
        win.displayState = {
          revision: ++revision,
          minimalist,
          landscape,
          width: px(innerWidth),
          height: px(innerHeight),
          statusVisible: !landscape && !minimalist,
          navigationVisible: !landscape,
          layoutTop: px(layoutTop),
          layoutBottom: px(layoutBottom),
          safeTop: px(Math.max(layoutTop, i.cutoutTop || 0)),
          safeRight: px(i.cutoutRight || i.gestureRight || 0),
          safeBottom: px(Math.max(layoutBottom, i.gestureBottom || 0)),
          safeLeft: px(i.cutoutLeft || i.gestureLeft || 0),
          cutouts: [],
        };
        win.barsHidden = landscape;
        win['listener-layoutChange']?.(win.displayState);
        return win.displayState;
      };
      addEventListener('resize', () => win.emitDisplayState());
      win.Capacitor = {
        PluginHeaders: [
          {
            name: 'DisplayLayout',
            methods: ['getState', 'setMode', 'addListener', 'removeListener'].map((name) => ({
              name,
              rtype: name === 'addListener' ? 'callback' : 'promise',
            })),
          },
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
          if (plugin === 'DisplayLayout') {
            win.displayCalls.push({ method, args });
            if (method === 'setMode') minimalist = args.minimalist;
            return win.emitDisplayState();
          }
          if (plugin === 'SystemBars') {
            win.systemBarCalls.push(method);
            win.barsHidden = method === 'hide';
            return {};
          }
          if (plugin === 'App') return {};
          if (method === 'restore')
            return { session: JSON.parse(localStorage.getItem('test-session') || 'null'), paths };
          if (method === 'pick') {
            win.pickerCalls ??= [];
            win.pickerCalls.push(args);
            if (win.pickerFailure) throw new Error(win.pickerFailure);
            if (win.cancelPick) return { images: [] };
            const selected = (win.pickIndices ?? originals.map((_, i) => i)).map(
              (i: number) => originals[i],
            );
            // Mirror only the native protocol outcome; Android contract/URI checks have native tests.
            if (selected.length < args.minimum || selected.length > args.limit)
              throw new Error(
                `Select ${args.minimum}–${args.limit} images. Your current comparison has not changed.`,
              );
            return { images: selected };
          }
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
