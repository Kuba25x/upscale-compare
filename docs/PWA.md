# Web app and PWA

Use [Upscale Compare](https://kuba25x.github.io/upscale-compare/) in a modern browser
to compare two to four PNG, JPEG or static WebP screenshots locally. An installed
PWA opens this same interface in an app window. Public **Share Comparison** remains
disabled; no account, Cloudflare service, synchronization or saved comparison is needed.

Availability depends on the deployed version; source changes do not publish the site. See the
[release acceptance record and checklist](PWA_RELEASE_QA.md).

## Android Chrome installation

1. Open the link in a normal Chrome tab while online. Use the exact HTTPS address
   ending in `/upscale-compare/`; avoid an in-app or private browser.
2. Open **Help & About** on the phone landing screen, then find
   **Installation and offline**. Wait for **App resources are ready offline**.
3. Open Chrome's menu and choose **Install app** or **Add to Home screen**. Confirm
   **Install** if Chrome offers it. Wording depends on Chrome/Android versions.
4. Launch **Upscale Compare** from its icon. It should open the existing comparison
   interface as an app window, without the ordinary browser address bar.
5. After the resources are ready, close the app and its browser tabs, enable airplane
   mode and reopen from the icon. Select available local files to compare offline.

Installation and offline readiness are separate: a browser may offer installation
before caching finishes. If only a browser shortcut is offered, do not assume it
is a standalone installation. Check for an existing installation and record the
browser/version in the manual acceptance checklist. No automatic install dialog,
custom banner or separate PWA interface is added by the app.

## Phone controls

The phone layout uses the shorter screen dimension below 600 CSS pixels and, on
the web, a primary touch pointer. In portrait, **Split Screen**, **Side-by-Side**,
and **Manage Images** share a row. If safe-area insets or larger text leave too
little room, **Manage Images** wraps to a second row with its full label and
touch target. Physical rotation controls the layout while the onscreen keyboard
is open.

Rename any screenshot from **Manage Images** in portrait. Landscape retains the
inline A/B editors. **Help & About** opens the existing guide, with installation,
offline status and version information. Closing the guide returns to
**Manage Images** when opened from there. The keyboard shortcuts button remains
on computer and tablet layouts, and external keyboard shortcuts work on phones.

## Offline and privacy

- Only the HTML, JavaScript, CSS, manifest, icons and license notices are cached.
  Help verifies the complete resource list for the displayed version before
  reporting offline readiness. Reopening Help or returning focus checks it again.
- Screenshots, filenames, labels and comparison metadata remain in memory. Refresh,
  closing or restarting begins an empty session. Original files on disk are untouched.
- Browser storage may be cleared or evicted, including after installation. Reconnect
  and open the app online if offline startup fails. If readiness remains unavailable,
  use the [scoped repair procedure](DEPLOYMENT.md#repair-only-this-pwas-cache).
- A regular tab can work offline after caching; installation is optional. Download
  cloud-only files to the device first. The app cannot make a remote file available
  while the file provider is offline.
- Offline does not enable public sharing or cache API responses, publications,
  verification requests or third-party content.

## Installed fullscreen display

New installations request fullscreen launch in portrait and landscape, retaining
the complete interface. The toolbar's **Minimalist mode** hides controls; **Show
controls** returns to the full interface. Browser support and cutout information
vary, and desktop installs can also honor this preference or fall back to a window.
Older/fallback standalone installs keep **Fullscreen options → Fullscreen with
controls**. Ordinary tabs and the native APK keep their existing behavior.

An existing installation may need reinstalling before its display mode changes.
A service-worker update alone does not establish that installed metadata changed.
Use the [fresh-install instructions and physical-device checklist](INSTALLED_LANDSCAPE.md#fresh-install-test).

## Updates

The browser checks for the next release during normal app use. A new worker installs
resources in the background and waits while old tabs or app windows remain open.
There is no forced reload or update prompt. Finish the comparison, close all its
tabs/windows and reopen to use the available release; unsaved labels and metadata
will not be restored. A failed download leaves the previous cached version usable.
The version shown in Help is the app version plus a short source commit.

## Limits and the Android APK

The PWA keeps the web limits: **20 MiB per file**, **36 million pixels** and
**16,384 pixels per side**, with two to four images. Memory, decoding, color handling,
file selection, fullscreen and system bars depend on the browser/device. Mobile
minimalist mode also works when browser fullscreen is unavailable. This is not an
HDR or raw-color analysis tool.

The Android APK bundles its app resources, uses the native Photo Picker / Files
path, copies originals into private app storage and restores the session. It has
the existing provisional 256 MiB file ceiling with the same pixel/dimension bounds.
The PWA uses browser file selection and does not restore screenshots or comparison
metadata. Installing one does not change the other. See [Android details](ANDROID.md).

## Other browsers

| Browser                | Installation path and verification boundary                                                                                                                             |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Chrome / Edge desktop  | Browser install icon/menu or app-window option; Linux Chromium installation and standalone reopening are automated. OS launcher checks on other desktops remain manual. |
| Firefox Android        | Use the browser's supported Add to Home screen / install action; system integration varies. Physical-device acceptance is pending.                                      |
| Safari on iPhone/iPad  | Share → Add to Home Screen where supported. Device installation, safe areas and restart require manual acceptance; Playwright WebKit is not iOS Safari certification.   |
| Other desktop browsers | Local web comparison remains available. Installation commands and support depend on browser and OS; do not infer installation support from engine regression tests.     |

Primary release acceptance is Android Chrome. The current automatic/manual results
are kept in [PWA release QA](PWA_RELEASE_QA.md).
