# Sharing API

The API serves public immutable comparisons and original image files. No accounts or cookies are used. Error responses contain `{ "error": "English explanation" }` with an appropriate HTTP status. All responses use `no-store` and `nosniff`. Exact allowlisted origins receive CORS headers.

## GET /api/health

Returns service readiness information:

```json
{ "status": "ok", "uploadsEnabled": true, "verificationRequired": false }
```

This endpoint does not prove storage health or deployment readiness.

## POST /api/comparisons

Requires an allowlisted `Origin` and `multipart/form-data`:

- `manifest`: JSON, at most 16,000 characters.
- `images`: two to four files in the same order as the manifest entries.
- `challenge`: a fresh production Turnstile token, with action `publish`.

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
  "id": "0123456789abcdef",
  "shareUrl": "https://api.example/s/0123456789abcdef",
  "deleteToken": "a-private-64-character-hex-token"
}
```

The deletion token is returned once. The API cannot recover it. Public comparisons do not expire automatically.

## GET /api/comparisons/:id

Returns `id`, `createdAt`, `metadata`, `config`, and `images`. Each image includes the custom `label`, metadata, width, height, size, media type, and a generated safe filename. No deletion digest, capability, or storage key is exposed. Missing/deleted/invalid comparisons return 404.

## GET or HEAD /api/comparisons/:id/images/:index

Returns the exact original bytes for indices 0–3 if the comparison is active and the image exists. Headers include the verified MIME, original size, safe inline filename, R2 ETag, and `no-store`. No resize or image-transformation parameters are supported. HEAD omits the response body.

## GET or HEAD /s/:id

Returns social preview HTML with Open Graph title/description/image and a browser redirect to the frontend hash route. User strings are HTML-escaped. Deleted IDs return 404 rather than a stale preview page. Third-party preview caches cannot be controlled by this application.

## DELETE /api/comparisons/:id

Use `Authorization: Bearer <private-deletion-key>`. The operator's separate admin secret is also accepted. No public-link knowledge alone allows deletion. Returns 204 after deletion. Invalid keys return 403; unknown IDs return 404. An interrupted deletion becomes inaccessible immediately and is retried by maintenance.

## Important status codes

| Code | Meaning                                                         |
| ---- | --------------------------------------------------------------- |
| 400  | Invalid metadata, selection, file count or multipart data       |
| 403  | Disallowed origin, verification failure or invalid deletion key |
| 404  | Invalid, missing or deleted comparison/image                    |
| 405  | Unsupported method                                              |
| 413  | Request/file/total size limit exceeded                          |
| 415  | Unsupported media type or invalid image content                 |
| 429  | Per-IP rate limit exceeded (`Retry-After` included)             |
| 503  | Disabled/unconfigured publishing or temporary backend failure   |
| 507  | Global storage or comparison quota reached                      |
