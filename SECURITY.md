# Security policy

## Reporting a vulnerability

Do not include secrets, deletion keys, private screenshots, or active exploit URLs in a public issue. Use the repository's private security reporting feature if enabled. Otherwise open a minimal issue requesting a private reporting channel without exploit details. A deployment operator should publish a monitored private security and abuse contact before accepting public uploads.

## Implemented controls

- Anonymous publishing is an explicit action, preceded by a public-visibility acknowledgment.
- Strict allowed-origin checks on publishing; exact-origin CORS without credentials; no authentication cookies.
- Production Turnstile verification with expected frontend hostname and `publish` action; development bypass is confined to the local configuration.
- A bounded single-buffer multipart reader, header/part limits, a receive deadline, per-isolate publication admission, 2–4 file constraints, hard byte/dimension/pixel ceilings, bounded metadata, and strict schema validation.
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

Image structure is limited to 4,096 PNG/WebP chunks or JPEG outer marker segments. PNG compressed input is pulled in pieces of at most 8 KiB. Unusually fragmented valid files may be rejected. One buffered publication runs per isolate, with at most two waiting requests; this is a memory guard, not a global rate or billing limit. See [resource limits and verification boundaries](docs/RESOURCE_LIMITS.md).

Original EXIF and other ancillary metadata are retained. Users must remove private data before publishing. Public link IDs are discovery-resistant, not authentication; links must not be treated as confidential storage.

The [original-fidelity checks](docs/ORIGINAL_FIDELITY.md) compare SHA-256 and bytes
through local R2/HTTP, including embedded metadata and 16-bit/alpha inputs. They
do not certify browser codec completeness, cross-display color accuracy or
production-provider behavior. No metadata stripping or silent orientation
normalization is performed.

Rate limiting trusts Cloudflare's `CF-Connecting-IP` at the public edge. Local development uses a shared fallback identity. Fixed windows allow bursts around boundaries, and per-IP controls do not stop a distributed attack. Turnstile, operator budgets, Cloudflare edge rules, resource quotas, and monitored abuse contact complement these controls. IP hashes are unsalted and must still be treated as pseudonymous personal data.

New-code quota reservation and pending-row insertion share one D1 statement and trigger. Cleanup uses conditional claims, bounded fair batches and retry backoff; interrupted operations retain private markers and reservations. Abandoned uploads have an extra one-hour cleanup grace, so public inaccessibility can precede final physical deletion. D1/R2 are still separate services: arbitrary late commits, existing legacy quota drift and real provider failure semantics require operational verification. See [publication recovery](docs/PUBLICATION_RECOVERY.md). Storage reservations fail closed; these controls do not cap billing.

Publication/deletion credentials are independently generated with 256 bits of randomness in the client and durably saved before upload. Only hashes are stored server-side. A transactional unique marker binds an operation to its deletion digest and normalized manifest/original-byte fingerprint. Matching retries cannot start another writer; deleted/failed operations retain expiring tombstones. Private result checks require both headers, the exact allowed origin and a separate rate limit; they need no new challenge and work with uploads disabled. The 24-hour recovery window does not expire active public images. Clearing/evicting all local key copies is still unrecoverable, and independent operation identifiers can create duplicates. See [recoverable retries](docs/PUBLICATION_RETRIES.md). Protect the frontend origin from script injection and do not log `Authorization` or `Idempotency-Key` headers.

No production endpoint has been deployed or penetration-tested as part of local development. Enabling public uploads requires operator review, real Turnstile verification, restricted secrets, a deletion/moderation smoke test, provider quota/budget review, and explicit deployment authorization.

The local production sharing suite uses built frontend bundles and the real
production Worker branch with emulator bindings. Verification doubles live only
in tests; there is no new production bypass or alternate verification URL.
Siteverify requires HTTP success plus literal boolean success and the existing
hostname/action checks. SDK load failure/timeout and widget exceptions leave an
explicit retry with no automatic image upload. See [local validation](docs/LOCAL_SHARING_VALIDATION.md)
for the tested contract and remaining real-provider verification requirements.

Stage-4 shared D1 daily budgets gate upload bodies, new publication reservations
and public read/R2 work across isolates. Defaults are paused with zero limits;
missing state or failed checks refuse work. Charges are conservative and are not
refunded after failures/deletion. The operator-only emergency stop changes a
persisted generation; INSERT/activation triggers prevent older writers from
activating even after restart. In-flight network work may still finish. Private
recovery, deletion, health, controls and maintenance remain outside public-read
budgets, so rejected/exempt requests and database checks can still incur costs.
See [cost controls](docs/COST_CONTROLS.md) for precise semantics, provider/edge
fallbacks, zero-budget bootstrap and remaining denial-of-wallet risks. No
application control is a hard account-wide dollar cap. Production-generated
workers.dev/preview URLs and Worker observability are disabled; alternate
hostnames must not bypass an approved edge policy. An optional paid CPU cap is
configuration only and never authorizes a plan upgrade.

## Frontend-only demo

The demo build does not expose an upload endpoint and never invokes the sharing API or Turnstile. Public route loading and API helpers fail locally with an explanation. Existing Cloudflare security controls remain part of the full deployment. The manual Pages workflow defaults to demo mode and still requires explicit `DEPLOY` confirmation; no Cloudflare resources are created or changed by demo deployment.
