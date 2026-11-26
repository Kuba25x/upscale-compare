# Uploadcare sharing experiment

This local experiment exercises the browser side of Share Comparison with
checked-in synthetic PNG, JPEG, and static WebP fixtures. See the
[feasibility report](../../docs/UPLOADCARE_FEASIBILITY.md) for current provider
documentation and launch blockers.

Run this from the repository root with Node 24 and the existing npm dependencies.

```sh
node research/uploadcare-sharing/serve.mjs
```

Open [the experiment](http://127.0.0.1:4193/upscale-compare/). Select two to four
fixtures, configure the existing viewer, acknowledge link visibility, and
choose **Publish mock comparison**. Open the verified link in a new tab to
restore the comparison from its fragment. The experiment preflights the
2,048-character URL cap before requesting a permit. Shorten the description
if it exceeds the cap.

The separate loopback origin at port 4194 returns UUIDs and serves unchanged
fixture bytes. The browser verifies SHA-256 after uploading and again when
opening the link. The viewer receives only verified blob URLs. A failed
upload or verification issues no link. Retry explicitly to start a new
attempt. Mock permits expire after two minutes. Stored bytes expire after
24 hours or when the process stops, whichever comes first. No image or
manifest state is persisted to browser storage or disk.

The mock uses exact loopback CORS and checks its synthetic fixture allowlist
against the actual upload bytes. This is a controlled test of the app flow.
Real provider eligibility, CORS, account limits, signed delivery, cleanup
and byte fidelity require separately authorized Free-project verification.

## Local checks

```sh
node_modules/.bin/tsc -p research/uploadcare-sharing/tsconfig.json
node --test research/uploadcare-sharing/tests/mock.test.mjs
node_modules/.bin/playwright test --config research/uploadcare-sharing/playwright.config.ts
```

The browser suite starts its own loopback servers. Stop a manually started
harness before running it. The suite uses the same Chromium selection as the
repository's other browser tests, including the optional `CHROMIUM_PATH`
override.
