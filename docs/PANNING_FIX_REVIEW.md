# Community panning patch review

## Attribution and baseline

The CSS selection fix and initial regression-test proposal come from the user-supplied community contribution `panning-image-drag-fix.patch`. The patch contains no author name, email, or commit metadata, so no identity or co-author email has been invented. Its stage-level selection declarations are incorporated into the feature branch; its test is expanded and shared between full-stack and demo browser suites.

The patch was reviewed against current `main` at `c5d73b6` and passes `git apply --check` in an isolated checkout. Input SHA-256:

```text
7868b541b731365652f7197f982d3a7cc7d0d2d8637d520112d6dece6e363c65
```

## Reproduced cause

`draggable=false` and `user-select:none` already protected the individual `<img>` elements, but their surrounding stage/layers remained selectable. Pointer capture does not cancel the browser's default selection behavior. Rapid multiple clicks could select a layer fragment, and the next movement started native **selection dragging**, even though the image itself was not draggable.

On unmodified `main`, Chromium emitted uncanceled `selectstart`, then `dragstart` with `text/html` and `text/plain`, followed by `pointercancel` and lost capture. This reproduced in Split Screen and Side-by-Side. The new movement-based regression initially failed: a requested 36-pixel pan moved only 9 pixels before the browser took over. No idle timeout or backend involvement was required.

## Assessment of the submitted patch

- **Correctness:** applying `user-select:none` to the entire stage addresses the reproduced selection path. The original test failed on unmodified `main` because a selection anchor remained inside the stage, and passed after the community CSS change was applied in the isolated checkout. Separate event probes also stopped reproducing native selection dragging with the CSS change alone.
- **Test limitations:** the submitted test starts at the stage center, where the split divider initially sits; it does not assert that either image moved. Two drags in the default mode do not establish sustained panning, synchronized motion, or mode-switch safety. Its anchor-node check also does not distinguish a collapsed selection from an active selected fragment.
- **Security:** the patch touches only CSS and browser tests. It introduces no dependencies, credentials, network calls, storage access, or backend changes. Selection suppression is scoped to the viewer, leaving image-upload and metadata controls available.
- **Compatibility:** the standard selection property applies to Chrome and Firefox; the WebKit prefix provides additional browser coverage. This does not block external file `dragenter`, `dragover`, or `drop` events. Real Firefox verification is included in CI rather than inferred from CSS support alone.

## Adapted implementation

The community CSS change is retained. The viewer additionally prevents the default pointer-down selection action, cancels native `dragstart` inside the stage, and sets `-webkit-user-drag:none` on comparison images. It explicitly focuses the stage so preventing mouse defaults does not strand keyboard focus in a label editor.

Pointer completion releases capture and clears active state. Cancellation, capture loss, a released primary mouse button, window blur, and a hidden document cannot leave a stale pan active. The split divider also suppresses selection and stops responding to an unpressed mouse button. Coordinate transforms, synchronized zoom, original files, touch pinch, image selection and backend code remain unchanged.

## Regression coverage and executed verification

The shared browser suite exercises repeated drags on both image regions, both modes, zoom changes, rapid multi-click selection, existing document selections, actual image displacement, synchronized motion, and released-pointer hover behavior. It checks capture cancellation/loss/blur/button recovery, cancels synthetic native drag starts on both layers, accepts a real File/DataTransfer drop into the viewer, and verifies panning after that upload. Label editing followed by stage panning also verifies keyboard focus recovery.

Local production and demo builds passed, as did 51 unit/API tests, 21 Chromium desktop/HiDPI/mobile E2E tests, and 14 production-demo tests. The original community test was separately executed before/after its CSS change in the isolated checkout. The stronger rapid-drag regression was observed failing before the fix and passing after it.

Firefox's browser download is blocked by this managed environment's network policy (HTTP 403 from the official Playwright download hosts). CI installs Firefox on the GitHub runner and enables the same four panning cases against both builds with `RUN_FIREFOX=true`. [Hosted Validate run #8](https://github.com/Kuba25x/upscale-compare/actions/runs/40410027435) passed all 94 cases, including all eight Firefox scenarios across the two builds. This must not be claimed as local Firefox execution. Safari and physical-device verification remain outside the executed checks.

No merge or deployment is performed by this change.
