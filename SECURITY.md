# Security policy

## Reporting a vulnerability

Do not include secrets, deletion keys, private screenshots, or active exploit URLs in a public issue. Use the repository's private security reporting feature if enabled. Otherwise open a minimal issue requesting a private reporting channel without exploit details. A deployment operator should publish a monitored private security and abuse contact before accepting public uploads.

## Implemented controls

- Anonymous publishing is an explicit action, preceded by a public-visibility acknowledgment.
- Strict allowed-origin checks on publishing; exact-origin CORS without credentials; no authentication cookies.
- Production Turnstile verification with expected frontend hostname and `publish` action; development bypass is confined to the local configuration.
- Size-limited request streaming, 2–4 file constraints, per-file and total-byte limits, dimension and pixel limits, bounded metadata, and strict schema validation.
- Image-content validation independent of filename and claimed MIME. PNG chunk ordering, CRC checks and bounded complete raster decompression; JPEG markers, frame dimensions, scans and termination; static WebP RIFF/chunk consistency and dimensions. Animated images and interlaced PNG publishing are rejected. Images with rotated or mirrored EXIF orientation must be normalized before publishing.
- Originals stored under generated keys in a private R2 bucket. No client R2 credentials, presigned unrestricted uploads, remote URL ingestion, SVG rendering, or HTML upload support.
- Parameterized SQL. React text rendering and escaped HTML metadata. Safe server-generated download filenames and `nosniff` headers.
- Cryptographically random public identifiers (64 bits), separate 256-bit deletion capabilities, hashed deletion keys at rest, and constant-time digest comparison.
- D1-backed per-IP fixed-window write/read/delete limits and an atomic global storage/comparison reservation. Pending and deleting records are inaccessible to readers.
- Database checks and `no-store` on reads so removed objects are no longer served through this API. No third-party caching is configured for originals.
- An operator secret can remove abusive content. Deletion releases storage quota atomically, including concurrent deletion attempts.
- Scheduled cleanup of old rate-limit rows and abandoned upload/deletion records. No automatic expiration of active comparisons.
- Uploads are disabled in generated production configuration. Deployment workflows never create billable infrastructure or automatically enable uploads.

## Boundaries and operations

Image validation is not antivirus scanning or a formal proof that every browser codec will accept a JPEG/WebP. These formats are structurally checked, not fully decoded on the server. PNG decompression is checked without allocating a complete raster. Keep browser/runtime/dependencies updated. R2 never executes uploaded content.

Original EXIF and other ancillary metadata are retained. Users must remove private data before publishing. Public link IDs are discovery-resistant, not authentication; links must not be treated as confidential storage.

Rate limiting trusts Cloudflare's `CF-Connecting-IP` at the public edge. Local development uses a shared fallback identity. Fixed windows allow bursts around boundaries, and per-IP controls do not stop a distributed attack. Turnstile, operator budgets, Cloudflare edge rules, resource quotas, and monitored abuse contact complement these controls. IP hashes are unsalted and must still be treated as pseudonymous personal data.

A D1/R2 operation interrupted between services can leave a pending reservation. The scheduled janitor retries records older than one hour. A failure before the initial pending record is inserted can leave conservative quota over-accounting; see the documented reconciliation procedure. Storage reservations fail closed. HTTP request concurrency and provider billing limits are not replaced by this application's storage quota.

No production endpoint has been deployed or penetration-tested as part of local development. Enabling public uploads requires operator review, real Turnstile verification, restricted secrets, a deletion/moderation smoke test, provider quota/budget review, and explicit deployment authorization.

## Frontend-only demo

The demo build does not expose an upload endpoint and never invokes the sharing API or Turnstile. Public route loading and API helpers fail locally with an explanation. Existing Cloudflare security controls remain part of the full deployment. The manual Pages workflow defaults to demo mode and still requires explicit `DEPLOY` confirmation; no Cloudflare resources are created or changed by demo deployment.
