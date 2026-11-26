# Uploadcare Free for Share Comparison

Reviewed November 19, 2026. **Public Share Comparison stays disabled.**
Uploadcare documents the API primitives for direct uploads and original delivery.
Its Free controls leave gaps in trusted image validation, upload retention
enforcement, and removal semantics. The public terms also leave the eligibility
of this anonymous community service unresolved. The isolated experiment exercises
the browser architecture with generated fixtures and a loopback provider.
[Run the experiment](../research/uploadcare-sharing/README.md)

## Eligibility and zero-charge behavior

Uploadcare describes Free as suitable for small personal projects and lists
“Personal use only” under team members. Its platform documentation describes
user-generated content, and section 3 of its terms allows some customer-facing
use through an integrated application. Those statements do not explicitly
resolve whether a public, accountless uploader for a small, noncommercial
open-source community qualifies for Free. The account operator remains
responsible for user content, unauthorized use, and compliance. Obtain written
confirmation for this specific use before considering public access.
[Pricing](https://uploadcare.com/pricing/) ·
[Terms, sections 2–4](https://uploadcare.com/about/terms/)

| Meter                 |                        Documented Free limit |
| --------------------- | -------------------------------------------: |
| Operations            |                              1,000 per month |
| CDN traffic           |                               5 GB per month |
| Storage               |                                         1 GB |
| Maximum file size     |                                       500 MB |
| Direct upload request | 100 MB total, including all multipart fields |

Storage accumulates across billing cycles. Billing measures average storage
during the period and counts stored originals. Traffic includes bytes from
the CDN to viewers and from Uploadcare to the CDN. The pricing page and August
2026 release notes give the current 500 MB file ceiling. The 100 MB request
ceiling applies independently of the plan. The app's current limits are 20 MiB
per image, 40 MiB per comparison, and four images.
[Pricing](https://uploadcare.com/pricing/) ·
[Billing](https://uploadcare.com/docs/billing/) ·
[Direct uploads](https://uploadcare.com/docs/api/upload/upload/base-upload/) ·
[Release notes](https://uploadcare.com/docs/changelog/) ·
[App limits](RESOURCE_LIMITS.md)

The Free-specific pricing FAQ describes suspension on reaching usage limits
and billing documentation lists Free overage as unavailable. The general
pricing FAQ describes automatic overage, and the terms allow some Free
customers to opt into usage fees to unblock service. Billing documentation
also says that adding a payment card during the 14-day trial can transition the
account to Pro. Future testing requires a project already on Free, with no
payment method and no overage opt-in. Confirm the applicable account terms and
the behavior of each meter when it fills. The current documentation describes
card-free image upload and card verification for other file types.
[Pricing](https://uploadcare.com/pricing/#faq) ·
[Billing](https://uploadcare.com/docs/billing/) ·
[Terms, sections 4–5](https://uploadcare.com/about/terms/) ·
[Uploading files](https://uploadcare.com/docs/uploading-files/)

A small community can still exhaust Free. For a comparison with two 5 MB images,
the allowances imply these ceilings.

- Two individual successful direct uploads cost six billing operations under
  the documented rule of one request, one rounded 100 MB upload unit, and one
  rounded malware scan unit per file. This allows at most 166 such comparisons
  per month before other operations.
- At 10 MB per full load, 5 GB pays for at most 500 loads before publisher
  verification reads and CDN origin traffic. At 10 MB per stored comparison,
  1 GB holds roughly 100 such comparisons.
- Original delivery is described as traffic-only. Uncached transformations
  and management requests can spend operations. Leave room for verification,
  failed or repeated attempts, deletion, CDN fills, and abuse. A forwarded
  link can exhaust the traffic allowance and interrupt other existing links,
  even if issuance is paused. A project boundary does not establish a separate
  account quota.

These upper bounds use decimal units. Real consumption still needs verification
in a Free project dashboard.
[Billing](https://uploadcare.com/docs/billing/) ·
[CDN quota behavior](https://help.uploadcare.com/article/325-my-images-disappeared) ·
[Project settings](https://uploadcare.com/docs/start/settings/)

## Direct uploads, fidelity, and security

The intended browser request is `POST /base/` with the original `File` in
`FormData`, the project's public identifier, and a bearer JWT. Success returns
a mapping from form field names to file UUIDs. A project with signed uploads
enabled requires a valid credential. The public key identifies the project
and cannot authorize public uploads on its own. The legacy HMAC signature has
no endpoint or operation bounds and is unsuitable for this issuer.
[Direct uploads](https://uploadcare.com/docs/api/upload/upload/base-upload/) ·
[Signed uploads](https://uploadcare.com/docs/security/secure-uploads/)

A future issuer would use server-side secrets, exact allowed frontend origin,
verified abuse challenges, short expiry, a unique JWT ID, scope
`["/base/"]`, and a token operation allowance equal to the requested file
count (2–4). The Uploadcare JWT uses HS256 with the raw SHA-256 digest of the
secret's text as the signing key. Use an isolated project and rotation, keep
secrets, bearer credentials, and signed URLs out of application logs, and
disable automatic credential refresh. Apply shared issuance and per-client
limits before signing, account for attempts conservatively, and provide a
stop switch. Origin and browser checks help enforce site policy. They cannot
authenticate a client independently of the challenge and quotas.
[Upload authentication](https://uploadcare.com/docs/api/upload/authentication/) ·
[Signed uploads](https://uploadcare.com/docs/security/secure-uploads/)

The JWT limit is one operation per direct-upload file. It is distinct from
billing operations and cannot bind the request to a byte hash, a MIME
allowlist, static images, dimensions, or a temporary-storage flag. Uploadcare
documents a project size limit and paid MIME filtering. Its image-only policy
for card-free accounts and its malware scanning do not provide the existing
structural validation of PNG, JPEG, and static WebP. A browser validator
protects the normal UI and reader. An untrusted uploader can use an issued
credential without those browser checks. This is the primary technical blocker
for accepting anonymous direct uploads under the current requirements.
[Token claims](https://uploadcare.com/docs/api/upload/authentication/) ·
[Validation and moderation](https://uploadcare.com/docs/moderation/) ·
[Existing sharing safeguards](../SECURITY.md)

Uploadcare documents a distinct original and transformed variants. Use
`https://<project>.ucarecd.net/<uuid>/` or the corresponding configured signed
host. Disable automatic format conversion and adaptive quality in Delivery,
which are documented as enabled by default. Avoid transformation directives
and adaptive rendering components. An image rendering successfully through
`<img>` establishes codec support. JavaScript must also receive a CORS-readable
response to verify original bytes. An opaque response, ETag, match in displayed
dimensions, or visual inspection cannot establish SHA-256 equality. Read a
bounded body with credentials omitted, require the expected raster MIME and
byte count, verify SHA-256, and decode the bytes as a blob URL for the existing
viewer. The hash detects delivery changes relative to the claimed upload. It
does not authenticate who authored a self-contained link.
[CDN delivery](https://uploadcare.com/docs/delivery/) ·
[Optimization](https://uploadcare.com/docs/optimization/) ·
[Image processing behavior](https://uploadcare.com/docs/api/url/image-processing-limitations/) ·
[Browser CORS](https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/CORS)

An authorized test must start from the actual GitHub Pages origin and cover
the bearer-header upload preflight, original and signed original CDN GETs,
PNG/JPEG/static WebP across browser `Accept` variations, inline rendering,
and fixture SHA-256 comparison. It must check account-specific size limits,
the usage dashboard, temporary expiry, and deletion/invalidation at the
time of testing. Browser policy, quota exhaustion, and SVG/animated format
rejection must be checked separately. The mock supplies controlled CORS and
exact original bytes. Provider-specific behavior remains unverified.

## Publication, privacy, and cleanup

Ordinary Uploadcare delivery makes UUIDs usable on its CDN immediately after
upload. This makes a public-CDN design simple, but the app withholding a
comparison link after failure does not revoke individual uploaded files.
Uploadcare's June 2026 changelog and secure delivery guide say that Free
supports signed URLs on a dedicated secure CDN host. The pricing summary
still lists signed URLs under Pro. Verify the plan entitlement in the actual
account before relying on it. Close the ordinary subdomain and, for applicable
legacy projects, legacy CDN access before treating any staging file as private.
A signed URL restricted to `/<uuid>/` grants access to the original path
without granting access to transformation paths.
[Delivery](https://uploadcare.com/docs/delivery/) ·
[June 2026 release notes](https://uploadcare.com/docs/changelog/#signed-urls-self-service-setup) ·
[Signed delivery](https://uploadcare.com/docs/security/secure-delivery/) ·
[Pricing](https://uploadcare.com/pricing/)

Temporary uploads (`UPLOADCARE_STORE=0`) expire after 24 hours. The API also
allows explicit permanent storage (`1`) or project-default behavior
(`auto`). Turning off auto-store governs the default and cannot enforce
temporary-only writes for holders of an upload token. Permanent files can
be stored or deleted using authorized REST calls. Custom expiration for
stored files needs an operator-scheduled cleanup or equivalent policy. Uploadcare
documents CDN invalidation on deletion, and its terms qualify when cached copies
become unavailable. Future tests must verify elapsed time, browser caching,
and behavior after expiry for the exact CDN configuration.
[Storage](https://uploadcare.com/docs/uploads/storage/) ·
[File management](https://uploadcare.com/docs/managing-files/) ·
[CDN cache settings](https://uploadcare.com/docs/delivery/cdn/) ·
[Terms, section 3](https://uploadcare.com/about/terms/)

A versioned fragment can hold the selected images' UUIDs, byte counts, MIME
types and SHA-256 hashes alongside app configuration and metadata. It needs no
database or server-side manifest. It is absent from the HTTP request for the
app shell, and the reader uses a fixed CDN origin. The entire fragment is
visible to recipients and can be shared or retained by their browsers.
Original EXIF and ancillary metadata remain present. Browsers, social
applications, and CDNs impose different limits and behavior. The experiment
caps the entire URL at 2,048 characters and refuses oversized descriptions,
so large existing metadata may need a different representation if the
architecture progresses. A share link can be created only after all published
originals verify in the browser.
[App privacy policy](PRIVACY.md) ·
[URI fragments](https://developer.mozilla.org/en-US/docs/Web/URI/Reference/Fragment)

For public operation, a secure CDN could keep staging private until a trusted
finalization step validates the actual files and authorizes exact original
paths. An issuer cannot safely sign arbitrary UUIDs asserted by an untrusted
fragment. A signed manifest receipt, a read authorization policy, and
durable state for quotas, ownership, revocation, and cleanup would be needed
to keep the existing safeguards. Short-lived CDN URLs can be replayed until
expiry or provider invalidation. The current private-storage API can stop
new application reads upon deletion. The direct CDN design cannot guarantee
that same timing. Enforcing PNG/JPEG/static WebP and structural bounds
before storage would separately need a trusted upload gate or suitable
provider-side controls. Adding trusted validation after staging would still
allow unvalidated bytes to consume quota. The experiment deliberately
does not introduce a production endpoint, service, or database.
[Signed delivery](https://uploadcare.com/docs/security/secure-delivery/) ·
[Existing privacy and removal guarantees](PRIVACY.md)

## Experiment boundary

The harness binds both origins to loopback, accepts exact bytes of
checked-in synthetic fixtures, and holds mock data in process memory.
It imports the existing viewer and validation code for the experiment
without altering any application build targets. Its permits are opaque mock
values, and it rejects the permanent storage flag. Those mock restrictions
must not be attributed to Uploadcare. Live uploads, live CORS and hashes,
provider terms confirmation, and production activation are outside this
branch.
[Experiment instructions](../research/uploadcare-sharing/README.md)
