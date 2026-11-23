# Measuring the phone portrait panel

Capture the installed PWA and the APK on the same Android phone, in portrait, with a comparison open and the keyboard and dialogs closed. Any two images can be used. Note the app build, Android and browser versions, and whether system navigation uses gestures or three buttons.

Connect the phone over USB and open `chrome://inspect/#devices` in desktop Chrome. Select **Inspect** for the installed app window, run the script below in its Console, and copy the returned JSON. Repeat with the APK WebView if it appears in DevTools. Use a local debug build for the APK if its release WebView is unavailable there. Capture the normal state in both apps and a second sample just after revealing navigation wherever the system hides it. Label each sample with the app and navigation state.

The script reads only viewport, safe-area, display-state, and control geometry. It sends no network requests and uses no storage or persistent controls.

```js
(async () => {
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
      const { left, right, top, bottom, width, height } = element.getBoundingClientRect();
      return { left, right, top, bottom, width, height };
    };
    const native = await window.Capacitor?.Plugins?.DisplayLayout?.getState?.().catch(() => null);
    const viewport = window.visualViewport;
    const visualBottom = viewport ? viewport.height + viewport.offsetTop : innerHeight;
    const appStyle = getComputedStyle(app);
    const panelStyle = getComputedStyle(panel);
    const dynamicHeight = height('dvh');
    const largeHeight = height('lvh');
    const web = app.classList.contains('web-app');
    const buttons = Array.from(panel.querySelectorAll('.phone-image-trigger, .swap-button'), rect);
    const buttonBottom = Math.max(...buttons.map(({ bottom }) => bottom));

    return JSON.stringify(
      {
        web,
        installedFullscreen: app.classList.contains('installed-fullscreen'),
        apiFullscreen: Boolean(document.fullscreenElement),
        displayMode: ['browser', 'standalone', 'fullscreen'].find(
          (mode) => matchMedia(`(display-mode: ${mode})`).matches,
        ),
        pixelRatio: devicePixelRatio,
        screenHeight: screen.height,
        innerHeight,
        visualViewport: viewport
          ? { height: viewport.height, offsetTop: viewport.offsetTop, scale: viewport.scale }
          : null,
        dynamicHeight,
        largeHeight,
        safeAreaBottom: inset('safe-area-inset-bottom'),
        maxSafeAreaBottom: inset('safe-area-max-inset-bottom'),
        layoutBottom: appStyle.getPropertyValue('--comparison-layout-bottom').trim(),
        appliedSafeBottom: appStyle.getPropertyValue('--comparison-safe-bottom').trim(),
        appPaddingBottom: appStyle.paddingBottom,
        panelPaddingBottom: panelStyle.paddingBottom,
        native: native
          ? {
              navigationVisible: native.navigationVisible,
              windowHeight: native.height,
              bottomInsets: native.bottomInsets,
              layoutBottom: native.layoutBottom,
              safeBottom: native.safeBottom,
              panelSafeBottom: native.panelSafeBottom,
              mandatoryGestureBottom: native.mandatoryGestureBottom,
              panelGuardBottom: native.panelGuardBottom,
              panelClearanceBottom: native.panelClearanceBottom,
            }
          : null,
        root: rect(document.documentElement),
        app: rect(app),
        comparison: rect(panel.parentElement),
        panel: rect(panel),
        buttons,
        gapToAppBottom: app.getBoundingClientRect().bottom - buttonBottom,
        gapToVisualBottom: visualBottom - buttonBottom,
      },
      null,
      2,
    );
  } finally {
    probe.remove();
  }
})();
```

Native values are in physical pixels. Divide by `pixelRatio` before comparing them with the CSS geometry. In CSS pixels the rendered button setback is `max(layoutBottom, panelGuardBottom, panelClearanceBottom + 12)`. The guard covers current and stable navigation insets and mandatory gestures. The 12 CSS pixels apply above the IME, the reported display edge, and the area reserved for system taps. When the control insets are unavailable the full navigation inset still determines the visual gap. The app already reserves `layoutBottom`, so only the remainder becomes panel padding.

If the APK still sits higher on a physical phone, compare `bottomInsets.navigation`, `stableNavigation`, `tappable`, `stableTappable`, `mandatoryGestures`, `systemGestures`, `ime`, `cutout`, and `roundedCorners` with the two panel bounds and `gapToAppBottom`. A PR #52 build also reports its effective root and panel padding. The newer debug build adds the raw per-type insets. In each app, measure the distance from the physical screen bottom to the lowest button in a system screenshot using synthetic images. If the gesture handle is visible, also measure the distance to its upper edge. The distances in physical pixels are enough to share.

The fullscreen PWA uses the greatest obstruction it can infer from the current and maximum safe-area insets and the visual viewport. Its 24 CSS pixel guard is a general lower bound for the large viewport. Reductions in the dynamic viewport and any inset reserved by the layout count toward that guard. If the browser reports no obstruction, these measurements cannot distinguish an unreported Android overlay or rounded corner from a fully usable screen. Compare both navigation modes on the physical device. [Chromium’s safe-area inset flow](https://chromium.googlesource.com/chromium/src/+/main/docs/ui/android/display_cutout.md#safe-area-inset-flow)
