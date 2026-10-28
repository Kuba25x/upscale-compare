import { describe, expect, it, vi } from 'vitest';
import {
  MAX_UPLOAD_BYTES,
  MULTIPART_OVERHEAD_BYTES,
  readUpload,
  UploadGate,
} from '../../worker/src/upload';

const limits = { maxFileBytes: 1024, maxTotalBytes: 2048 };
const boundary = 'test-boundary';
const encoder = new TextEncoder();
const part = (name: string, value: string | Uint8Array, filename?: string) => {
  const headers =
    '--' +
    boundary +
    '\r\nContent-Disposition: form-data; name="' +
    name +
    '"' +
    (filename === undefined ? '' : '; filename="' + filename + '"\r\nContent-Type: image/png') +
    '\r\n\r\n';
  return Buffer.concat([
    Buffer.from(headers),
    typeof value === 'string' ? Buffer.from(value) : value,
    Buffer.from('\r\n'),
  ]);
};
function body(parts = [part('manifest', '{}'), part('images', 'abc', 'one.png')]) {
  return Buffer.concat([...parts, Buffer.from('--' + boundary + '--\r\n')]);
}
function request(bytes: Uint8Array, headers: Record<string, string> = {}, fragment = bytes.length) {
  let offset = 0;
  return new Request('http://localhost/api/comparisons', {
    method: 'POST',
    headers: { 'Content-Type': 'multipart/form-data; boundary=' + boundary, ...headers },
    body: new ReadableStream({
      pull(controller) {
        if (offset === bytes.length) return controller.close();
        controller.enqueue(bytes.subarray(offset, offset + fragment));
        offset = Math.min(bytes.length, offset + fragment);
      },
    }),
    duplex: 'half',
  } as RequestInit);
}

describe('bounded multipart uploads', () => {
  it('preserves binary originals and UTF-8 text across one-byte network fragments', async () => {
    const binary = Uint8Array.from({ length: 256 }, (_, i) => i);
    const result = await readUpload(
      request(
        body([
          part('manifest', '{"label":"Scene 🎮"}'),
          part('images', binary, 'ignored.png'),
          part('challenge', 'verification-token'),
        ]),
        {},
        1,
      ),
      limits,
    );
    expect(result.manifest).toBe('{"label":"Scene 🎮"}');
    expect(result.challenge).toBe('verification-token');
    expect(Buffer.from(result.images[0].bytes)).toEqual(Buffer.from(binary));
    expect(result.images[0].type).toBe('image/png');
  });
  it('accepts browser FormData with a quoted boundary and four images', async () => {
    const form = new FormData();
    form.set('manifest', '{}');
    form.set('challenge', '');
    for (let i = 0; i < 4; i++)
      form.append('images', new File([Uint8Array.of(i)], 'a";🎮.png', { type: 'image/png' }));
    const native = new Request('http://localhost', { method: 'POST', body: form });
    const type = native.headers.get('content-type')!;
    const data = new Uint8Array(await native.arrayBuffer());
    const result = await readUpload(
      request(data, {
        'Content-Type': type.replace(/boundary=(.*)/, 'boundary="$1"'),
        'Content-Length': String(data.length),
      }),
      limits,
    );
    expect(result.images.map((image) => image.bytes[0])).toEqual([0, 1, 2, 3]);
  });
  it('keeps near-boundaries inside an original file', async () => {
    const binary = encoder.encode(
      '\r\n--test-boundaryX\r\n--test-boundar\r\n--test-boundary--X\r\n--test-boundary-',
    );
    const result = await readUpload(
      request(body([part('manifest', '{}'), part('images', binary, 'a.png')])),
      limits,
    );
    expect(result.images[0].bytes).toEqual(binary);
  });
  it('accepts exact per-file and aggregate limits', async () => {
    const binary = new Uint8Array(1024);
    const result = await readUpload(
      request(
        body([part('manifest', '{}'), part('images', binary, 'a'), part('images', binary, 'b')]),
      ),
      limits,
    );
    expect(result.images.reduce((sum, image) => sum + image.bytes.length, 0)).toBe(2048);
  });
  it('rejects per-file and aggregate overflow separately', async () => {
    await expect(
      readUpload(
        request(body([part('manifest', '{}'), part('images', new Uint8Array(1025), 'a')])),
        limits,
      ),
    ).rejects.toMatchObject({ status: 413, message: 'An image exceeds the file size limit.' });
    await expect(
      readUpload(
        request(
          body([
            part('manifest', '{}'),
            ...Array(3).fill(part('images', new Uint8Array(1024), 'a')),
          ]),
        ),
        limits,
      ),
    ).rejects.toMatchObject({ status: 413 });
  });
  it('rejects streamed body overflow and cancels its source', async () => {
    let cancelled = false;
    const req = new Request('http://localhost', {
      method: 'POST',
      headers: { 'Content-Type': 'multipart/form-data; boundary=x' },
      body: new ReadableStream({
        pull(controller) {
          controller.enqueue(new Uint8Array(1024));
        },
        cancel() {
          cancelled = true;
        },
      }),
      duplex: 'half',
    } as RequestInit);
    await expect(readUpload(req, limits)).rejects.toMatchObject({ status: 413 });
    expect(cancelled).toBe(true);
  });
  it.each(['-1', 'NaN', '1.5', '9007199254740992'])(
    'rejects invalid Content-Length %s',
    async (length) => {
      await expect(
        readUpload(request(body(), { 'Content-Length': length }), limits),
      ).rejects.toMatchObject({ status: 400 });
    },
  );
  it('checks declared length before consuming a body and enforces the hard resource ceiling', async () => {
    const req = request(body(), {
      'Content-Length': String(MAX_UPLOAD_BYTES + MULTIPART_OVERHEAD_BYTES + 1),
    });
    const reader = vi.spyOn(req.body!, 'getReader');
    await expect(readUpload(req, { maxFileBytes: 1e9, maxTotalBytes: 1e9 })).rejects.toMatchObject({
      status: 413,
    });
    expect(reader).not.toHaveBeenCalled();
  });
  it.each([-1, 1])('rejects a body differing from Content-Length by %i byte', async (delta) => {
    const data = body();
    await expect(
      readUpload(request(data, { 'Content-Length': String(data.length + delta) }), limits),
    ).rejects.toMatchObject({ status: 400 });
  });
  it.each([
    [part('manifest', '{}'), part('manifest', '{}')],
    [part('manifest', '{}'), part('challenge', 'a'), part('challenge', 'b')],
    [part('manifest', '{}'), part('unknown', '')],
    [part('manifest', '{}'), part('images', 'not a file')],
    [part('manifest', '{}', 'not-text')],
    [part('images', 'abc', 'a')],
    [part('manifest', '{}'), ...Array(5).fill(part('images', 'a', 'a'))],
    [part('manifest', '{}'), part('challenge', 'x'.repeat(2049))],
    [part('manifest', 'x'.repeat(16001))],
    [part('manifest', Uint8Array.of(255))],
  ])('rejects duplicate, excessive, unknown or mistyped fields (%#)', async (...parts) => {
    await expect(readUpload(request(body(parts)), limits)).rejects.toMatchObject({ status: 400 });
  });
  it('rejects unbounded part headers', async () => {
    await expect(
      readUpload(
        request(body([part('manifest', '{}'), part('images', 'a', 'x'.repeat(5000))])),
        limits,
      ),
    ).rejects.toMatchObject({ status: 400 });
  });
  it.each([
    'Content-Disposition: form-data; name="manifest"\r\nContent-Disposition: form-data; name="images"',
    'Content-Disposition: form-data; name="manifest"; name="challenge"',
    'Content-Disposition: form-data; name="manifest"\r\nContent-Type: text/plain\r\nContent-Type: image/png',
    'Content-Disposition: form-data; name="manifest"\r\nContent-Transfer-Encoding: base64',
    'Content-Disposition: form-data; name="manifest"\nInjected: value',
  ])('rejects ambiguous or unsupported part headers (%#)', async (headers) => {
    const data = Buffer.from(
      '--' + boundary + '\r\n' + headers + '\r\n\r\n{}\r\n--' + boundary + '--\r\n',
    );
    await expect(readUpload(request(data), limits)).rejects.toMatchObject({ status: 400 });
  });
  it.each([
    'multipart/form-data',
    'multipart/form-data; boundary=' + 'x'.repeat(71),
    'multipart/form-data; boundary="unterminated',
    'application/json',
  ])('rejects an invalid multipart Content-Type (%#)', async (type) => {
    await expect(
      readUpload(request(body(), { 'Content-Type': type }), limits),
    ).rejects.toMatchObject({ status: 415 });
  });
  it('rejects a truncated closing delimiter and trailing data', async () => {
    const data = body();
    await expect(
      readUpload(request(data.subarray(0, data.length - 5)), limits),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      readUpload(request(Buffer.concat([data, Buffer.from('extra')])), limits),
    ).rejects.toMatchObject({ status: 400 });
  });
  it('cancels a stalled upload after the receive deadline', async () => {
    vi.useFakeTimers();
    let cancelled = false;
    try {
      const req = new Request('http://localhost', {
        method: 'POST',
        headers: { 'Content-Type': 'multipart/form-data; boundary=x' },
        body: new ReadableStream({
          cancel() {
            cancelled = true;
          },
        }),
        duplex: 'half',
      } as RequestInit);
      const checked = expect(readUpload(req, limits)).rejects.toMatchObject({ status: 408 });
      await vi.advanceTimersByTimeAsync(120000);
      await checked;
      expect(cancelled).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
  it('cancels a pending body read when its request is aborted', async () => {
    const controller = new AbortController();
    let cancelled = false;
    const req = new Request('http://localhost', {
      method: 'POST',
      headers: { 'Content-Type': 'multipart/form-data; boundary=x' },
      signal: controller.signal,
      body: new ReadableStream({
        cancel() {
          cancelled = true;
        },
      }),
      duplex: 'half',
    } as RequestInit);
    const checked = expect(readUpload(req, limits)).rejects.toMatchObject({ status: 408 });
    controller.abort();
    await checked;
    expect(cancelled).toBe(true);
  });
});

describe('per-isolate publication admission', () => {
  it('serializes three publications and rejects a fourth without starting it', async () => {
    const gate = new UploadGate();
    const events: number[] = [];
    let finish!: () => void;
    const first = gate.run(async () => {
      events.push(1);
      await new Promise<void>((resolve) => {
        finish = resolve;
      });
    });
    const second = gate.run(async () => {
      events.push(2);
    });
    const third = gate.run(async () => {
      events.push(3);
    });
    const excess = vi.fn(async () => undefined);
    await expect(gate.run(excess)).rejects.toMatchObject({ status: 503 });
    expect(excess).not.toHaveBeenCalled();
    expect(events).toEqual([1]);
    finish();
    await Promise.all([first, second, third]);
    expect(events).toEqual([1, 2, 3]);
    await gate.run(async () => events.push(4));
    expect(events).toEqual([1, 2, 3, 4]);
  });
  it('releases the slot after a validation or persistence failure', async () => {
    const gate = new UploadGate();
    await expect(
      gate.run(async () => {
        throw new Error('failure');
      }),
    ).rejects.toThrow('failure');
    await expect(gate.run(async () => 'next upload')).resolves.toBe('next upload');
  });
  it('removes cancelled waiters so they cannot retain admission', async () => {
    const gate = new UploadGate();
    let finish!: () => void;
    const first = gate.run(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const controller = new AbortController();
    const cancelled = vi.fn(async () => undefined);
    const checked = expect(gate.run(cancelled, controller.signal)).rejects.toMatchObject({
      status: 408,
    });
    controller.abort();
    await checked;
    const next = gate.run(async () => 'next');
    finish();
    await first;
    await expect(next).resolves.toBe('next');
    expect(cancelled).not.toHaveBeenCalled();
    await expect(gate.run(async () => 'available')).resolves.toBe('available');
  });
});
