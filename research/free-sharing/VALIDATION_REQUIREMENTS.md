# Required publication validation profile

This is a research requirement, not a claim that the prototype meets every item.
Validation must establish both bounded content processing and a complete,
supported still image before activation, while keeping original source bytes.
It is not malware detection or a promise that every client decoder is bug-free.

## Shared invariants

1. Preserve every existing signature/MIME, file/total byte, pixel/dimension,
   segment/chunk, metadata/manifest, animation, orientation, PNG CRC/raster,
   capability, retry, quota and stop-generation check. Full decoding is additive.
2. Server-side validation must cover the exact immutable bytes returned by public
   reads. Pin their complete SHA-256, length, MIME, dimensions and image order to
   the normalized comparison manifest. Never trust a client digest or validation
   receipt on its own. Never activate a partial, missing or unverified original.
3. Reject incomplete entropy/pixel data, illegal tables/references, truncated
   sections, forbidden trailing content, inconsistent lengths/dimensions and
   unsupported coding modes. Success on headers or a partial preview is not
   successful validation. Codec error concealment/recovery/warnings are failures.
4. Check resource bounds before allocation and during work. Account for original,
   hashing, codec history/coefficients/transforms, WASM linear memory, output,
   copies, async queues, runtime and concurrency. No unbounded output buffer,
   cancellation-free decompression or runtime-termination-as-validation design.
5. Bound metadata parsing and any nested compressed metadata that will be trusted
   or interpreted. Existing EXIF orientation checks do not validate every ICC,
   XMP, EXIF or text field, and preserving original bytes preserves private metadata.
   Do not silently strip it or render it as HTML. Unsupported metadata policies
   need explicit design/acceptance rather than bypassing validation.
6. Fail closed on decoder/resource/storage uncertainty; keep quarantine private
   and permit bounded recovery/cleanup. No paid fallback, skip-validation mode or
   image re-encoding. Decoder output is disposable validation state only.

## JPEG

Support only the currently admitted 8-bit still coding profile unless separately
approved: valid baseline/extended-sequential/progressive structures, permitted
component counts and orientation-normalized EXIF. Validate applicable SOF/SOS,
quantization and Huffman tables, coding parameters, restart/stuffing rules and
complete scan/coefficient data through terminal EOI. Progressive input must finish
all required scans; a partially decoded preview or synthesized missing blocks
is insufficient. Unknown or unsupported modes are rejected explicitly.

Tests must include missing tables/blocks, oversubscribed tables, truncated entropy
with an otherwise valid EOI, missing EOI, marker/segment floods, invalid dimensions,
rotated/mirrored EXIF, valid progressive/baseline files and valid files after a
decoder rejection. Component counts, table variants and metadata need a larger
differential/fuzz corpus beyond this PR's fixtures.

## WebP

Keep static-only RIFF/VP8/VP8L/VP8X checks, chunk bounds/counts, correct canvas/raster
dimensions and EXIF restrictions. Additionally require complete VP8/VP8L entropy,
transform, alpha and pixel reconstruction for the declared image; an incremental
decoder's "need more data"/partial output is a failure at EOF. Validate feature
flags, padding, duplicate/conflicting chunks and compressed references under the
chosen supported profile. Animation remains rejected even if a codec could decode
its first frame.

Tests must include headers with no raster, truncated VP8 and VP8L with corrected
outer lengths, truncated RIFF, corrupt payload/flags, alpha/lossless/lossy and
metadata cases. Full decode alone may be tolerant of container anomalies; retain
independent container checks and add conformance/fuzz tests before any adoption.

## PNG

The unchanged complete deflate expansion, raster count/filter, CRC, dimension,
chunk ordering/ceiling, still-image, interlace and metadata checks remain
mandatory. PNG is not made safe by accepting IHDR/IDAT headers alone. Expanded
bytes and bit depth matter independently of compressed file size. A replacement
validator must preserve all current rejection cases and establish its handling
of palette/ancillary semantics and compressed metadata. No full RGBA output is
required merely to retain original PNG bytes.

## Candidate acceptance and evidence

The finite research corpus demonstrates stronger JPEG/WebP rejection using the
existing validator followed by full WASM decoding with warning rejection. It
does not prove this entire profile. Check decoder versions/build provenance,
security advisories and license requirements; test differential and malformed
corpora, allocator limits and cold/warm/concurrent failure behavior. Define
format-specific supported limits from resource evidence. If a candidate cannot
validate an original within approved limits, reject the candidate/profile or
leave publishing disabled; do not weaken checks or modify the original.
