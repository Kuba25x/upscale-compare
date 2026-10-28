// These are resource ceilings, independent of lower operator-configured limits.
export const MAX_UPLOAD_BYTES = 40 * 1024 * 1024;
export const MULTIPART_OVERHEAD_BYTES = 65536;
const MAX_HEADER_BYTES = 4096;
const MAX_PARTS = 6; // One manifest, an optional challenge, and up to four images.
const UPLOAD_TIMEOUT_MS = 120000;
const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: false });

export class UploadError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
const invalid = (): never => {
  throw new UploadError(400, 'Malformed multipart upload.');
};
const tooLarge = (): never => {
  throw new UploadError(413, 'The comparison exceeds the total upload size limit.');
};
function decode(bytes: Uint8Array) {
  try {
    return decoder.decode(bytes);
  } catch {
    return invalid();
  }
}

// One buffered publication per isolate; at most two other requests wait without
// reading their bodies. Hold the slot through R2 writes, which retain the buffer.
export class UploadGate {
  private active = false;
  private waiting: (() => void)[] = [];

  async run<T>(operation: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    if (signal?.aborted) throw new UploadError(408, 'The upload was cancelled.');
    if (this.active) {
      if (this.waiting.length === 2)
        throw new UploadError(503, 'Publishing is busy. Please try again shortly.');
      await new Promise<void>((resolve, reject) => {
        const resume = () => {
          signal?.removeEventListener('abort', cancel);
          resolve();
        };
        const cancel = () => {
          const index = this.waiting.indexOf(resume);
          if (index !== -1) this.waiting.splice(index, 1);
          reject(new UploadError(408, 'The upload was cancelled.'));
        };
        this.waiting.push(resume);
        signal?.addEventListener('abort', cancel, { once: true });
      });
    } else this.active = true;
    try {
      if (signal?.aborted) throw new UploadError(408, 'The upload was cancelled.');
      return await operation();
    } finally {
      const next = this.waiting.shift();
      if (next) next();
      else this.active = false;
    }
  }
}

// Linear search, including repeated near-matches inside binary image data.
function find(
  bytes: Uint8Array,
  needle: Uint8Array,
  start: number,
  end = bytes.length,
  delimiter = false,
) {
  const fallback = new Uint16Array(needle.length);
  for (let i = 1, matched = 0; i < needle.length; i++) {
    while (matched && needle[i] !== needle[matched]) matched = fallback[matched - 1];
    if (needle[i] === needle[matched]) matched++;
    fallback[i] = matched;
  }
  for (let i = start, matched = 0; i < end; i++) {
    while (matched && bytes[i] !== needle[matched]) matched = fallback[matched - 1];
    if (bytes[i] === needle[matched]) matched++;
    if (matched === needle.length) {
      if (
        !delimiter ||
        (bytes[i + 1] === 13 && bytes[i + 2] === 10) ||
        (bytes[i + 1] === 45 &&
          bytes[i + 2] === 45 &&
          (i + 3 === bytes.length || (bytes[i + 3] === 13 && bytes[i + 4] === 10)))
      )
        return i + 1 - needle.length;
      matched = fallback[matched - 1];
    }
  }
  return -1;
}

async function readBody(request: Request, maxBytes: number) {
  if (request.signal.aborted) throw new UploadError(408, 'The upload was cancelled.');
  const declared = request.headers.get('content-length');
  if (declared !== null && (!/^\d+$/.test(declared) || !Number.isSafeInteger(Number(declared))))
    invalid();
  const capacity = declared === null ? maxBytes : Number(declared);
  if (capacity > maxBytes) tooLarge();
  if (!request.body) invalid();
  // A single allocation avoids growing buffers, per-network-chunk objects and
  // native FormData/File copies. Unknown lengths reserve the bounded maximum.
  const bytes = new Uint8Array(capacity);
  const reader = request.body!.getReader();
  let received = 0,
    timedOut = false;
  const cancel = () => {
    void reader.cancel().catch(() => undefined);
  };
  request.signal.addEventListener('abort', cancel, { once: true });
  const timer = setTimeout(() => {
    timedOut = true;
    cancel();
  }, UPLOAD_TIMEOUT_MS);
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (timedOut) throw new UploadError(408, 'The upload took too long. Please try again.');
      if (request.signal.aborted) throw new UploadError(408, 'The upload was cancelled.');
      if (done) break;
      if (received + value.byteLength > maxBytes) tooLarge();
      if (received + value.byteLength > capacity) invalid();
      bytes.set(value, received);
      received += value.byteLength;
    }
    if (declared !== null && received !== capacity) invalid();
    return bytes.subarray(0, received);
  } finally {
    clearTimeout(timer);
    request.signal.removeEventListener('abort', cancel);
    void reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

function disposition(value: string) {
  if (!value.startsWith('form-data')) invalid();
  const fields = new Map<string, string>();
  const parameter = /\s*;\s*([a-zA-Z0-9_*.-]+)=(?:"((?:[^"\\]|\\.)*)"|([^;\s]+))/y;
  let offset = 'form-data'.length;
  while (offset < value.length) {
    parameter.lastIndex = offset;
    const match = parameter.exec(value);
    if (!match) invalid();
    const key = match![1].toLowerCase();
    if (fields.has(key)) invalid();
    fields.set(key, (match![2] ?? match![3]).replace(/\\(.)/g, '$1'));
    offset = parameter.lastIndex;
  }
  return fields;
}

export interface UploadImage {
  bytes: Uint8Array<ArrayBuffer>;
  type: string;
}
export interface Upload {
  manifest: string;
  challenge: string;
  images: UploadImage[];
}

export async function readUpload(
  request: Request,
  limits: { maxFileBytes: number; maxTotalBytes: number },
): Promise<Upload> {
  const type = request.headers.get('content-type') || '';
  const boundary = type.match(
    /^multipart\/form-data\s*;\s*boundary=(?:"([0-9A-Za-z'()+_,./:=? -]{1,70})"|([0-9A-Za-z'()+_,./:=?-]{1,70}))\s*$/i,
  );
  if (!boundary) throw new UploadError(415, 'Use a multipart image upload with a valid boundary.');
  const boundaryText = boundary[1] || boundary[2];
  if (boundaryText.endsWith(' ')) invalid();
  const maxTotal = Math.min(limits.maxTotalBytes, MAX_UPLOAD_BYTES);
  const bytes = await readBody(request, maxTotal + MULTIPART_OVERHEAD_BYTES);
  const first = encoder.encode('--' + boundaryText + '\r\n');
  if (first.some((byte, i) => bytes[i] !== byte)) invalid();
  const separator = encoder.encode('\r\n--' + boundaryText);
  const headerEnd = encoder.encode('\r\n\r\n');
  const result: Upload = { manifest: '', challenge: '', images: [] };
  const seen = new Set<string>();
  let offset = first.length,
    parts = 0,
    imageBytes = 0;
  while (offset < bytes.length) {
    if (++parts > MAX_PARTS) invalid();
    const end = find(
      bytes,
      headerEnd,
      offset,
      Math.min(bytes.length, offset + MAX_HEADER_BYTES + 4),
    );
    if (end < 0) invalid();
    const headers = new Map<string, string>();
    for (const line of decode(bytes.subarray(offset, end)).split('\r\n')) {
      const colon = line.indexOf(':');
      if (colon < 1 || !/^[a-zA-Z0-9-]+$/.test(line.slice(0, colon))) invalid();
      const key = line.slice(0, colon).toLowerCase();
      const value = line.slice(colon + 1).trim();
      if (
        !['content-disposition', 'content-type'].includes(key) ||
        headers.has(key) ||
        /[\x00-\x1f\x7f]/.test(value)
      )
        invalid();
      headers.set(key, value);
    }
    const fields = disposition(headers.get('content-disposition') || '');
    const name = fields.get('name');
    if (!name || !['manifest', 'challenge', 'images'].includes(name)) invalid();
    if (name !== 'images' && seen.has(name!)) invalid();
    seen.add(name!);
    const start = end + 4;
    const next = find(bytes, separator, start, bytes.length, true);
    if (next < 0) invalid();
    const length = next - start;
    if (name === 'images') {
      if (!fields.has('filename') || result.images.length === 4) invalid();
      if (length > Math.min(limits.maxFileBytes, 20 * 1024 * 1024))
        throw new UploadError(413, 'An image exceeds the file size limit.');
      imageBytes += length;
      if (imageBytes > maxTotal) tooLarge();
      result.images.push({
        bytes: bytes.subarray(start, next),
        type: (headers.get('content-type') || '').toLowerCase(),
      });
    } else {
      if (fields.has('filename') || fields.has('filename*')) invalid();
      if (length > (name === 'manifest' ? 64000 : 8192)) invalid();
      result[name as 'manifest' | 'challenge'] = decode(bytes.subarray(start, next));
      if (result[name as 'manifest' | 'challenge'].length > (name === 'manifest' ? 16000 : 2048))
        invalid();
    }
    offset = next + separator.length;
    if (bytes[offset] === 45 && bytes[offset + 1] === 45) {
      offset += 2;
      if (bytes[offset] === 13 && bytes[offset + 1] === 10) offset += 2;
      if (offset !== bytes.length || !seen.has('manifest')) invalid();
      return result;
    }
    offset += 2; // The delimiter search already checked CRLF.
  }
  return invalid();
}
