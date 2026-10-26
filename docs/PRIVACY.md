# Privacy and public sharing

This repository is software, not a hosted upload service. Each deployment operator is responsible for publishing their own legal identity, contact details, applicable legal basis, provider policies, and retention information before enabling public uploads.

## Frontend-only demo

The demo build does not connect to the sharing API, load Turnstile, or upload images or comparison metadata. Local file inspection remains available, but publication and remote comparison viewing are disabled with a visible explanation. Refreshing or closing the page clears local images, labels, and metadata. GitHub Pages still receives ordinary requests for public application files and may process hosting access logs; this is separate from screenshot handling.

## Local comparisons

Screenshots selected on your device are read into browser memory and displayed using object URLs. The application does not upload them during selection, comparison, renaming, metadata editing, zooming, or panning. There is no advertising, analytics SDK, tracking cookie, remote font, or automatic image sync. Reloading or closing the page loses unpublished images.

## Explicit publication

The Share Comparison dialog explains public visibility and requires an acknowledgment before uploading. A production publish may load Cloudflare Turnstile, which processes verification and network information according to Cloudflare's policies. Successful publishing uploads unmodified screenshot files and the comparison manifest to the configured Worker, D1, and private R2 storage.

Anyone with the public link can access or download published screenshots without registering. Links are not authentication and can be forwarded, indexed indirectly, or cached by social platforms. Published files retain embedded metadata such as EXIF; remove private information before sharing.

## Stored data

- Original image files and file-derived dimensions, media types and byte sizes.
- User-provided labels, optional metadata and view configuration.
- Generated comparison ID, publication timestamp and a hash of the private deletion key.
- Temporary hashed network identifiers and counters for rate limiting. Identifiers are pseudonymous, not anonymous. Expired rate-limit rows are cleaned hourly; normal retention is approximately two hours or less.
- Hosting providers may independently retain access/security logs. This code does not log screenshot contents or deletion credentials.

The deletion key is saved locally in browser storage under a key scoped to the API and comparison ID. No other local preference or screenshot persistence is enabled. A backup key file is available after publication; keep it private.

## Retention and removal

Active comparisons do not expire automatically. The original publisher can remove a comparison using their private deletion key. An operator can remove content through a separately authenticated moderation endpoint. Deletion removes the database record and R2 files and prevents future API reads. Interrupted deletions are retried by scheduled maintenance. Copies downloaded by others, social previews, and provider backups cannot be recalled through this application.

A deployment operator must provide a monitored abuse contact and explain their handling of removal requests. Include the public comparison URL when reporting abuse. Do not send private deletion keys in a public report. A lost key cannot be recovered by the application; contact the operator instead.
