# Sharing API

The API serves public immutable comparisons and original image files. No accounts or cookies are used. Error responses contain `{ "error": "English explanation" }` with an appropriate HTTP status. All responses use `no-store` and `nosniff`. Exact allowlisted origins receive CORS headers.

## GET /api/health

Returns service readiness information:

```json
{ "status": "ok", "uploadsEnabled": true, "verificationRequired": false }
```

`uploadsEnabled` also reflects the unpaused D1 policy and remaining current-day
admission/publication budgets, and production requires a nonempty verification
secret. It does not prove storage health, sufficient bytes for a particular
request, validity of verification keys/account settings or deployment readiness.

## POST /api/comparisons

Requires an allowlisted `Origin`, both private publication headers below, and `multipart/form-data`:

- `Idempotency-Key`: `<13-digit-epoch-ms>.<64-lowercase-hex>` with a cryptographically random 256-bit suffix.
- `Authorization`: `Bearer <64-lowercase-hex>` containing an independently generated private deletion key.

Generate and durably save these credentials before sending any images. Keep them out of URLs and logs. Their timestamp allows a 24-hour retry window, with at most five minutes of future clock skew. Missing/malformed credentials return 400; expired identifiers return 410. Old clients must update.

- `manifest`: JSON, at most 16,000 characters.
- `images`: two to four files in the same order as the manifest entries.
- `challenge`: a fresh production Turnstile token, with action `publish`.

Production verification requires an OK Siteverify HTTP response, literal boolean
`success: true`, the allowlisted frontend hostname and exact `publish` action.
Provider HTTP/transport/JSON/timeout failures refuse publication; a success-shaped
body on an error status is never accepted. See [local sharing validation](LOCAL_SHARING_VALIDATION.md)
for tested production paths and the distinction from real-provider verification.

The upload reader accepts at most six parts and 4 KiB of headers per part.
File and aggregate ceilings remain 20 MiB and 40 MiB. Images with more than
4,096 PNG/WebP chunks or JPEG outer marker segments are rejected. Body receiving
has a 120-second deadline after admission; expiry returns 408. Each isolate runs
one publication and queues at most two others without reading their bodies;
further requests receive 503. See [resource limits](RESOURCE_LIMITS.md).

The shared D1 policy additionally charges a daily upload attempt and the complete
body capacity before reading it. A known validated `Content-Length` reserves that
size; an unknown length reserves the configured aggregate ceiling plus 64 KiB.
Invalid/failed/cancelled attempts are not refunded. New pending reservations also
charge daily publication count/original bytes atomically with storage quota and
the retry marker. Limits apply across IPs/isolates; exhausted/paused/missing
policy returns 503. Matching upload replays still consume body admission; use the
private result endpoint for recovery without those charges.

Example manifest:

```json
{
  "metadata": { "game": "Example game", "gpu": "", "settings": "", "description": "" },
  "images": [
    {
      "label": "DLSS Quality",
      "metadata": { "technology": "DLSS", "preset": "Quality", "renderingResolution": "" }
    },
    {
      "label": "Native",
      "metadata": { "technology": "Native", "preset": "", "renderingResolution": "" }
    }
  ],
  "config": {
    "mode": "split",
    "selected": [0, 1],
    "divider": 0.5,
    "view": { "zoom": null, "center": { "x": 1920, "y": 1080 } }
  }
}
```

`zoom: null` means Fit. Numeric zoom is physical source-pixel magnification: `1` = 100%, `2` = 200%. `center` is measured in source-image coordinates. The Worker validates these values with the shared schema.

A successful response has status 201:

```json
{
  "status": "active",
  "id": "0123456789abcdef",
  "shareUrl": "https://api.example/s/0123456789abcdef"
}
```

The API never returns or stores the plaintext deletion key. The client already saved it. Public comparisons do not expire automatically.

Repeating the same identifier, key and normalized manifest/originals returns the same active result (201) or `{ "status": "pending" }` (202, `Retry-After: 3`). Only the first request reserves quota and writes R2. A matching retry does not consume Turnstile again. Changed images/order/media type/labels/settings return 409. Wrong credentials return 404. Failed/deleted/expired-pending operations return 410 and cannot be recreated with that identifier. Publishing still requires enabled uploads and consumes its per-IP allowance, including repeats. Use result recovery for checks.

## POST /api/publications/result

Requires an allowlisted `Origin` and the same two private headers. No request body, image files or challenge is needed. Returns the existing active result (200), 202 pending with `Retry-After: 3`, 404 for an unknown identifier or wrong key, or 410 for a terminal/expired attempt. This endpoint works while uploads are disabled, uses a separate per-IP limit of 20 requests per minute, and never creates a comparison. It does not disclose raw credentials, fingerprints, storage keys or deletion digests. See [recoverable retries](PUBLICATION_RETRIES.md) for retention and failure semantics.

CORS allows `Content-Type`, `Authorization`, and `Idempotency-Key`; `Retry-After` is exposed. Clients must reset a used challenge and obtain a fresh token before a new upload if a result check reports no operation. Avoid automatic polling or blindly resending images.

## GET /api/comparisons/:id

Returns `id`, `createdAt`, `metadata`, `config`, and `images`. Each image includes the custom `label`, metadata, width, height, size, media type, and a generated safe filename. No deletion digest, capability, or storage key is exposed. Missing/deleted/invalid comparisons return 404.

## GET or HEAD /api/comparisons/:id/images/:index

Returns the exact original bytes for indices 0–3 if the comparison is active and the image exists. Headers include the verified MIME, original size, safe inline filename, R2 ETag, and `no-store`. No resize or image-transformation parameters are supported. HEAD omits the response body.

Public GET/HEAD paths also require daily read admission. An image request reserves
one R2 operation before accessing storage; GET additionally reserves the full
original size, while HEAD uses R2 `head()` with zero response-byte reservation.
Failures/cancelled downloads are not refunded. Exhausted budgets return 503
without R2 access. Policy defaults are zero until explicitly configured.

## GET or HEAD /s/:id

Returns social preview HTML with Open Graph title/description/image and a browser redirect to the frontend hash route. User strings are HTML-escaped. Deleted IDs return 404 rather than a stale preview page. Third-party preview caches cannot be controlled by this application.

## DELETE /api/comparisons/:id

Use `Authorization: Bearer <private-deletion-key>`. The operator's separate admin secret is also accepted. No public-link knowledge alone allows deletion. Returns 204 after deletion. Invalid keys return 403; unknown IDs return 404. Once the deleting transition commits, the comparison becomes inaccessible. Interrupted cleanup retains a private marker and reservation for maintenance retries. A still-pending upload also has a grace period before final physical removal; 204 does not promise that abandoned in-flight storage operations have already settled. See [publication recovery](PUBLICATION_RECOVERY.md).

## Operator controls

`POST /api/admin/publishing/stop` requires `Authorization: Bearer <ADMIN_TOKEN>`
and no body. It returns `{ "publishingPaused": true, "generation": 123 }` after
persisting the stop, without redeployment. No origin header is required for an
operator API client; a supplied origin must still be allowlisted. Missing/wrong
authorization returns 403 before D1 access. A failed acknowledgement can return
503 even if the stop committed: check status or repeat the stop.

`GET /api/admin/costs` requires the same operator authorization and returns
`day`, `control`, `usage` (null before a current-day charge) and `quota`, all
private and `no-store`. It exposes no image content, user metadata or credentials.
This operational view is not the Cloudflare invoice.

There is no HTTP resume/reset endpoint. Resume requires an approved D1 policy
change and a generation increment, preserving usage counters. Stops do not
disable active public reads (which retain their budgets), private recovery,
deletion or scheduled cleanup. Already-issued I/O may finish, while older
writers cannot activate. See [the stop/restart runbook](COST_CONTROLS.md).

## Important status codes

| Code | Meaning                                                                            |
| ---- | ---------------------------------------------------------------------------------- |
| 400  | Invalid publication credentials, metadata, selection, file count or multipart data |
| 403  | Disallowed origin, verification failure or invalid deletion key                    |
| 404  | Invalid, missing or deleted comparison/image                                       |
| 405  | Unsupported method                                                                 |
| 408  | Upload body receive deadline exceeded                                              |
| 409  | Publication identifier reused with different images or settings                    |
| 410  | Publication retry is terminal or outside its recovery window                       |
| 413  | Request/file/total size limit exceeded                                             |
| 415  | Unsupported media type or invalid image content                                    |
| 429  | Per-IP rate limit exceeded (`Retry-After` included)                                |
| 503  | Disabled/unconfigured publishing, busy isolate or temporary backend failure        |
| 507  | Global storage or comparison quota reached                                         |
