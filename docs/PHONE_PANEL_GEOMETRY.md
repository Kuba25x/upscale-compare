# Measuring the phone portrait panel

Capture the installed PWA and the APK on the same Android phone, in portrait, with a comparison open and the keyboard and dialogs closed. Any two images can be used. Note the app build, Android and browser versions, and whether system navigation uses gestures or three buttons.

Connect the phone over USB and open `chrome://inspect/#devices` in desktop Chrome. Select **Inspect** for the installed app window, run the script below once in its Console, and copy the returned JSON. Repeat with the APK WebView if it appears in DevTools. Use a local debug build for the APK if its release WebView is unavailable there.

The script works on the PR #48 build as well as the follow-up. It reads only viewport, safe-area, and element geometry. It sends no requests and uses no storage or persistent controls.

```js
(() => {
  const app = document.querySelector('.app.comparison-phone-portrait');
  const panel = app?.querySelector('.phone-image-controls');
  if (!app || !panel) return 'Open a normal comparison in phone portrait first.';

  const probe = document.createElement('div');
  probe.setAttribute('aria-hidden', 'true');
  probe.style.cssText =
    'position:fixed;inset:0 auto auto 0;width:0;visibility:hidden;pointer-events:none';
  document.body.append(probe);

  try {
    const height = (unit) => {
      probe.style.height = `100${unit}`;
      return probe.getBoundingClientRect().height;
    };
    const inset = (name) => {
      probe.style.marginBottom = `env(${name}, -1px)`;
      const value = parseFloat(getComputedStyle(probe).marginBottom);
      return value >= 0 ? value : null;
    };
    const rect = (element) => {
      const { top, bottom, height } = element.getBoundingClientRect();
      return { top, bottom, height };
    };
    const viewport = window.visualViewport;
    const visualBottom = viewport ? viewport.height + viewport.offsetTop : innerHeight;
    const appStyle = getComputedStyle(app);
    const panelStyle = getComputedStyle(panel);
    const dynamicHeight = height('dvh');
    const largeHeight = height('lvh');
    const web = app.classList.contains('web-app');
    const appliedSafeBottom = appStyle.getPropertyValue('--comparison-safe-bottom').trim();

    return JSON.stringify(
      {
        web,
        installedFullscreen: app.classList.contains('installed-fullscreen'),
        apiFullscreen: Boolean(document.fullscreenElement),
        displayMode: ['browser', 'standalone', 'fullscreen'].find(
          (mode) => matchMedia(`(display-mode: ${mode})`).matches,
        ),
        pixelRatio: devicePixelRatio,
        innerHeight,
        visualViewport: viewport
          ? { height: viewport.height, offsetTop: viewport.offsetTop, scale: viewport.scale }
          : null,
        dynamicHeight,
        largeHeight,
        safeAreaBottom: inset('safe-area-inset-bottom'),
        maxSafeAreaBottom: inset('safe-area-max-inset-bottom'),
        layoutBottom: appStyle.getPropertyValue('--comparison-layout-bottom').trim(),
        appliedSafeBottom,
        appPaddingBottom: appStyle.paddingBottom,
        panelMarginBottom: panelStyle.marginBottom,
        panelBottomRadius: panelStyle.borderBottomLeftRadius,
        root: rect(document.documentElement),
        app: rect(app),
        comparison: rect(panel.parentElement),
        panel: rect(panel),
        gapToVisualBottom: visualBottom - panel.getBoundingClientRect().bottom,
        pr48WebCorrection: web
          ? Math.max(0, dynamicHeight - visualBottom - (parseFloat(appliedSafeBottom) || 0))
          : null,
      },
      null,
      2,
    );
  } finally {
    probe.remove();
  }
})();
```

If the old web correction is zero, PR #48 added no margin to the existing 8 px. A positive maximum inset can expose space missed by the current inset and visual viewport. If both insets are zero and the app reaches the reported visual bottom, these web measurements cannot distinguish an unreported Android overlay from an unobstructed fullscreen viewport. Note whether the system navigation area is visible when taking the sample. See [Chromium’s safe-area inset flow](https://chromium.googlesource.com/chromium/src/+/main/docs/ui/android/display_cutout.md#safe-area-inset-flow).
