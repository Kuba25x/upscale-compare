# Privacy and public sharing

This repository is software, not a hosted upload service. Each deployment operator is responsible for publishing their own legal identity, contact details, applicable legal basis, provider policies, and retention information before enabling public uploads.

## Frontend-only demo

The demo build does not connect to the sharing API, load Turnstile, or upload images or comparison metadata. Local file inspection remains available, but publication and remote comparison viewing are disabled with a visible explanation. Refreshing or closing the page clears local images, labels, and metadata. GitHub Pages still receives ordinary requests for public application files and may process hosting access logs; this is separate from screenshot handling.

## Local comparisons

Screenshots selected on your device are read into browser memory and displayed using object URLs. The application does not upload them during selection, comparison, renaming, metadata editing, zooming, or panning. There is no advertising, analytics SDK, tracking cookie, remote font, or automatic image sync. Reloading or closing the page loses unpublished images.

## Explicit publication

The Share Comparison dialog explains public visibility and requires an acknowledgment before uploading. Opening an available, configured production publish dialog may load Cloudflare Turnstile before that acknowledgment; the provider processes verification and network information according to its policies. The application does not send screenshots to Turnstile. Disabled/unconfigured publishing does not load the widget. Successful publishing uploads unmodified screenshot files and the comparison manifest to the configured Worker, D1, and private R2 storage.

Anyone with the public link can access or download published screenshots without registering. Links are not authentication and can be forwarded, indexed indirectly, or cached by social platforms. Published files retain embedded metadata such as EXIF; remove private information before sharing.

## Stored data

- Original image files and file-derived dimensions, media types and byte sizes.
- User-provided labels, optional metadata and view configuration.
- Generated comparison ID, publication timestamp and a hash of the private deletion key.
- Temporary private retry records: comparison ID, hashes of the publication identifier and deletion key, a request fingerprint and expiry. These survive comparison removal until expiry cleanup to prevent accidental recreation. They contain no image or plaintext manifest copy.
- Temporary hashed network identifiers and counters for rate limiting. Identifiers are pseudonymous, not anonymous. Expired rate-limit rows are cleaned by the configured maintenance schedule in batches of at most 100; the intended window is approximately two hours, but backlog/outages or disabled production cron can extend physical retention. Production cron is currently generated disabled pending resource/retention approval.
- Hosting providers may independently retain access/security logs. This code does not log screenshot contents or deletion credentials.
- Aggregate daily cost-control counts/byte reservations and the operator policy generation/update time. The aggregate rows contain UTC dates and totals, with no IPs, filenames, credentials or image metadata. Rows older than 35 days are purged in batches of at most 100 per hourly run; backlog/outages can extend retention. These counters survive image deletion until their independent retention cleanup.

Before upload, the browser saves an API-scoped private recovery record with publication/deletion credentials, creation time and a request fingerprint. It contains no images, filenames or plaintext metadata. **Recover publication** can check an interrupted attempt for 24 hours, including after refresh, without sending images again. Once the result is known, the deletion key is saved under the API/comparison ID before removing the recovery record. Unresolved recovery records are retained locally until explicitly removed; expiry does not automatically erase private keys. Private key backups can be downloaded. No screenshot persistence is enabled. See [recoverable retries](PUBLICATION_RETRIES.md).

Server retry metadata expires 24 hours after the identifier timestamp and is removed in batches of up to 100 per hourly run; provider outages or backlog can extend retention. Temporary comparison columns used to create the marker are cleared in the same transaction. Normal active-comparison deletion still removes the images and manifest immediately when storage succeeds, while its small private retry tombstone remains until expiry cleanup. Hosting logs/backups follow operator/provider policies.

## Retention and removal

The periods above describe expiry and the configured maintenance behavior, not
an automatic guarantee of physical removal. Stage-7 production configuration
leaves cron disabled until the owner approves its Free-resource/retention plan.
An actual upload service must have a functioning, monitored maintenance schedule
and disclose its selected active-image and backup retention before opening.

Active comparisons do not expire automatically. The original publisher can remove a comparison using their private deletion key. An operator can remove content through a separately authenticated moderation endpoint. Deletion first prevents new API reads. Normal active-comparison deletion removes the R2 files and database record immediately when storage succeeds. Interrupted cleanup retains a private maintenance record and its storage reservation for retries. An abandoned or still-pending upload also retains a grace marker, and possible late objects are swept again before final removal. Hourly scheduling, backoff, backlog and provider outages can delay physical deletion; no fixed completion time is guaranteed. See [publication recovery](PUBLICATION_RECOVERY.md). Copies downloaded by others, social previews, and provider backups cannot be recalled through this application.

A deployment operator must provide a monitored abuse contact and explain their handling of removal requests. Include the public comparison URL when reporting abuse. Do not send private publication/deletion keys in a public report. A lost response can be recovered using saved credentials within the recovery window; clearing/losing all key copies cannot be undone by the API. Contact the operator if you lose control of a public comparison.
