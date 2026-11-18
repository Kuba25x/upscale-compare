# PWA release QA and owner handoff

## Current acceptance boundary

This PR prepares the source and manual Pages workflow. **No deployment was run.**
The existing public URL has not been used to claim acceptance of this new build.
No physical Android device is connected to the Codex environment.

The 2026-11-17 [dependency risk review](DEPENDENCY_AUDIT.md) accepts only
GHSA-fc5q-39xc-vjpf and its derived high rows in the pinned development toolchain,
temporarily until **2026-12-01 00:00 UTC**. No patched picomatch release is available.
The raw audit still reports 11 high and 2 moderate rows; the production audit is
clean. CI and manual Pages publication use the same tested, fail-closed policy:
all critical, production high/critical and other unaccepted high causes still
block release. A new upstream release, changed lock/configuration or expiry
requires review. This is a bounded risk acceptance, not a vulnerability fix.

| Evidence                 | Automated coverage                                                                                                                                            | Remaining manual check                                                                |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Manifest / scope / icons | Root and `/upscale-compare/` builds, identity/name, standalone declaration, sizes and maskable safe area                                                      | Name and icon as installed by Android Chrome                                          |
| Installability           | Chromium diagnostics in normal persistent profiles, including mobile viewport                                                                                 | Chrome Android menu, installation confirmation and launcher icon                      |
| Installed window         | Real Linux Chromium CDP installation and app-window preference; standalone media and existing UI, then full profile restart offline                           | Android launch from icon, system bars, app switcher and OS lifecycle                  |
| Offline / privacy        | Complete-cache readiness, incomplete/missing-resource status, cold reopen, PNG/JPEG/WebP bytes, empty new session, cache contents and retained unrelated data | Airplane mode and locally available file providers on the phone                       |
| Viewer                   | Existing shared pixel/gesture/fullscreen suites; offline mobile minimalist mode and both orientations                                                         | Real pinch/pan, cutouts, keyboard and both rotations                                  |
| Updates / rollback       | A→B and compatible B→A, one/multiple clients, failed/missing/corrupt resources, no reload or comparison loss                                                  | Open installed window plus Chrome tab, sleep/resume and next-release activation       |
| Android APK              | Existing browser bridge, JVM, lint, APK, emulator and release/signing CI                                                                                      | Existing native device qualification remains separate                                 |
| Public Pages             | Local server and artifact paths under the repository base; explicit pre-publish PWA gate                                                                      | HTTPS hosted assets, scope, installation and offline smoke after an approved dispatch |

CI results and the exact source commit are linked from PR F. Headless mobile
viewports do not constitute Android Chrome testing. Linux installation through CDP
does not verify Android's menu or WebAPK packaging. WebKit does not certify Safari.
**Physical Android and post-deployment hosted checks are pending owner execution.**

## Deploy only after owner approval

1. Review PR F and its green CI; merge only after the owner's decision.
2. Confirm Pages source is **GitHub Actions** in repository **Settings → Pages**.
3. In **Actions → Deploy frontend to GitHub Pages → Run workflow**, select `main`,
   `deployment_mode: demo` and `confirmation: DEPLOY`.
4. Approve the `github-pages` environment if GitHub requires it. The workflow first
   audits dependencies and verifies artifacts, offline/update behavior, a real installed Chromium window
   and the demo bundle, then publishes only `dist/`.
5. Record the workflow URL, exact commit and Help version, then run the phone
   checklist below at `https://kuba25x.github.io/upscale-compare/`.

Pushes, merges and pull requests do not deploy. Never choose `production` for this
release. Keep the production readiness lock, Cloudflare configuration and public
sharing disabled. No backend credentials or resource activation are needed.

## Android Chrome checklist

For installed landscape/full-controls behavior, also run the
[Chrome and Firefox physical-device checklist](INSTALLED_LANDSCAPE.md#automated-and-physical-verification).
Automated engine/inset tests do not establish Android status-bar or cutout coverage.

Record date, phone model, Android version, Chrome version, deployed commit and Help
version. Use non-private test patterns; include one PNG, JPEG and static WebP.

- [ ] Open the exact HTTPS Pages URL in normal Chrome; confirm no asset errors,
      correct title and disabled **Share Comparison**.
- [ ] Import PNG/JPEG/WebP from local device storage, select each A/B pair and inspect
      Split Screen / Side-by-Side, Fit, 100% and 200%, pan, pinch and divider movement.
- [ ] Open **Keyboard shortcuts (?) → Installation and offline**. Confirm the expected
      version and wait for **App resources are ready offline**. Do not equate an install
      offer with completed caching.
- [ ] Install from Chrome's menu. Record its exact wording and confirm the installed
      name **Upscale Compare**, correct icon and scope `/upscale-compare/`.
- [ ] Close the tab and launch from the icon. Confirm the existing UI, standalone
      window, no ordinary browser address bar and no custom install popup/banner.
- [ ] Check portrait and landscape, safe areas, image controls, metadata keyboard,
      fullscreen/minimalist entry/exit and the Android system Back action.
- [ ] Close all app windows/tabs, enable airplane mode, reopen from the icon and
      select local PNG/JPEG/WebP files. Repeat both modes, zoom and real gestures.
      Confirm the previous screenshots, labels and metadata were not restored.
- [ ] Reconnect. With remote DevTools if available, inspect Cache Storage: only app
      resources, no screenshot bytes/names, labels, metadata, API or verification data.
- [ ] For the next controlled release, keep a comparison open in the installed app
      and a Chrome tab. Confirm neither reloads nor loses images/labels/zoom. Close
      one; the other remains usable. Close all, reopen and verify the new Help version.
- [ ] Check browser eviction/recovery with disposable test data, following only the
      [scoped repair instructions](DEPLOYMENT.md#repair-only-this-pwas-cache).
- [ ] Independently smoke the existing APK: native Photo Picker / Files, replacement,
      Back, rotation and restored private session remain intact.

If a check fails, record the visible behavior, device/browser/version and Help
version. Do not enable sharing or bypass the production lock to troubleshoot.
Use a [compatible rollback](DEPLOYMENT.md#compatible-pwa-rollback) if needed.

## Repeatable local checks

```bash
npm ci
npm run test:pwa:build
npm run test:pwa
xvfb-run -a npm run test:pwa:install  # Linux headed Chromium; Xvfb is a test display
npm run test:demo
npm run test:android:web
```

Use `RUN_FIREFOX=true RUN_WEBKIT=true` with installed Playwright engines to include
those regression projects. A local desktop can run the installed-window test with
its normal display instead of Xvfb. CI retains reports and real installed-window
screenshots as artifacts. No command above publishes a site or a release.
