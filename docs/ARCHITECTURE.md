# Architecture

## Source layout

| Path                                | Responsibility                                                                                |
| ----------------------------------- | --------------------------------------------------------------------------------------------- |
| `src/App.tsx`                       | Landing/viewer state, local file lifecycle, hash navigation, header and A/B controls          |
| `src/components/Viewer.tsx`         | Rendering, shared navigation, divider, pointer/touch/keyboard interactions                    |
| `src/components/ShareDialog.tsx`    | Explicit publish consent, Turnstile, copy link, deletion capabilities                         |
| `src/components/MetadataEditor.tsx` | Optional metadata and read-only published details                                             |
| `src/lib/geometry.ts`               | Pure coordinate, fit, physical pixel scale, anchor and pan calculations                       |
| `shared/model.ts`                   | Shared TypeScript models, Zod schemas and default limits                                      |
| `worker/src/index.ts`               | Worker routing, validation pipeline, quota/rate control, persistence, deletion and share HTML |
| `worker/src/image-validation.ts`    | Bounded image-content validation without file re-encoding                                     |
| `worker/migrations`                 | D1 schema migrations                                                                          |
| `tests`                             | Geometry/schema, image-content, real local Worker integration, browser/pixel/touch coverage   |

## View coordinates

Every screenshot uses source coordinates measured from its top-left pixel. The view stores a shared source center and physical magnification. For explicit zoom:

```text
CSS scale = magnification / devicePixelRatio
CSS image position = panel center - source center × CSS scale
```

At 100%, a source pixel occupies one physical display pixel. At integer magnifications the image origin is rounded to a physical pixel. At Fit, both selected images share a scale computed from their union dimensions and the available panel rectangle. No resolution normalization is performed. Side-by-Side uses equal panel sizes; split mode uses two fully overlapping panels clipped at the same divider position. The divider never changes the image transform.

The position is applied using a translation, with image dimensions set separately. This avoids Chromium rounding fractional CSS layout positions before physical-pixel rasterization, particularly in Side-by-Side mode on HiDPI displays. Both panels snap against the global physical screen grid, including fractional display densities such as 125%.

Wheel zoom preserves the source coordinate under the cursor, including any rounding used for the rendered origin. Pan deltas are divided by the current CSS scale. Both panels use the same view. Switching modes preserves the source center and explicit magnification; Fit recalculates the scale for the new panel geometry.

Touch pointers are tracked through pointer capture. One pointer pans; two pointers change magnification around their midpoint. The divider has its own pointer capture and keyboard slider semantics. Native HTML selects and dialogs provide image selection and focus trapping without a third-party UI framework.

## File lifecycle

Selected files become browser object URLs and are decoded locally. Failed batches revoke every object URL already created. Replacing files revokes previous local URLs. No file is uploaded on selection, editing, zooming, or panning. Unpublished state is intentionally not persisted to IndexedDB; refresh loses it.

The publish dialog snapshots labels, metadata, mode, selection, divider, source center and zoom. Original file data is sent as multipart form data. The Worker ignores original filenames and serves generated safe filenames. It does not transcode image data.

## Persistence and failure behavior

1. Require uploads enabled, allowed origin, request rate limit, bounded multipart, valid manifest, production verification, and valid file content.
2. Atomically reserve byte/count capacity in D1.
3. Create a pending comparison with a deletion-key digest.
4. Upload originals sequentially to private R2 keys.
5. Mark the comparison active only after all objects are stored.
6. Return a short public share URL and the separate deletion capability.

Readers only see active records. On a failed upload, rollback removes all possible object keys and releases the reservation. If cleanup also fails, the pending record remains available to the hourly janitor. A failure before initial record creation can conservatively leak a quota reservation; reconciliation is an operator procedure described in deployment docs. Cross-service writes are not presented as an atomic R2/D1 transaction.

Deletion first makes a record inaccessible, then deletes its objects, then releases quota and removes the record in one D1 batch. The quota decrement uses the current database row so concurrent/retried deletion cannot double-release capacity. If object deletion fails, the deleting record is retried by the janitor.

## URLs and privacy

The canonical public link is `https://api-host/s/<16-hex-id>`. Its server-generated HTML includes escaped Open Graph metadata and redirects to `FRONTEND_URL#c/<id>`. GitHub Pages serves the same static entry point for every hash route, including repository subpaths. Social services receive an original selected image, not a generated composite; provider caching and preview support vary.

Published manifests are immutable. Visitors may change navigation or selection in memory but cannot change stored files, labels, or metadata. Uploading from a shared page creates a fresh local comparison. Deletion capabilities are stored in browser localStorage under API origin + comparison ID and can be downloaded privately. They are never part of public manifests, URLs, or logs.
