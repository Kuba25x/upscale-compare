# Upscale Compare 1.0.0 for Android

The first stable Android release lets you compare two to four PNG, JPEG or static WebP screenshots offline. Select an A/B pair, drag the Split Screen divider or inspect both images Side-by-Side. Pan and pinch together, switch between Fit and physical-pixel zoom presets, and adjust alignment for differently framed screenshots. Manage Images lets you label, replace and remove images. The app preserves the original file bytes and restores the saved comparison from private storage after restart.

## Installation and updates

Install `upscale-compare-1.0.0.apk` on Android 7.0 (API 24) or newer with an up-to-date Android System WebView. Open the APK from your browser or Files and allow that app to install unknown apps when prompted.

Coming from a debug Preview? Save your original screenshots outside the app and note labels and adjustments first. Uninstall the Preview, install the stable APK and reimport your originals. Android requires this one-time transition because the production signing certificate differs. Uninstalling deletes the app's private copies and saved session. Future in-place updates require the same production key and a higher version code.

## Compatibility and limits

Package `io.github.kuba25x.upscalecompare`, version name `1.0.0`, version code `5`, target API 36. Imports support up to 36 million pixels and 16,384 pixels per side. The 256 MiB per-file ceiling is provisional. Available memory and WebView affect large-image decoding, particularly with 4K/8K originals. Cloud-backed files must be downloaded before offline import. Public Share Comparison is unavailable.

## Verify and obtain source

Compare the APK's SHA-256 with `SHA256SUMS` and its signer with the public certificate fingerprint below. The release includes the exact source commit, signed release manifest, corresponding-source archive with build scripts and upstream runtime sources, AGPL-3.0 license, dependency inventory and third-party notices. Download the corresponding-source asset for this binary.
