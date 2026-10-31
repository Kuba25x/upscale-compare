// ISOLATED RESEARCH ONLY. No Wrangler configuration, production entrypoint or
// production binding imports. Faults/caps below are explicitly local test models.
import { validateImage } from '../../worker/src/image-validation';
import { manifestSchema } from '../../shared/model';

const PART_BYTES = 1024 * 1024;
const FILE_BYTES = 20 * PART_BYTES;
const TOTAL_BYTES = 40 * PART_BYTES;
const CLEANUP_PARTS = 8;
const LOCAL_HOST = 'local-research.invalid';
const limits = { maxFileBytes: FILE_BYTES, maxDimension: 16384, maxPixels: 36000000 };
const digest = async (bytes: BufferSource) =>
  Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), (b) =>
    b.toString(16).padStart(2, '0'),
  ).join('');
class Refusal extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
function refuse(status: number, message: string): never {
  throw new Refusal(status, message);
}
const json = (value: unknown, status = 200) =>
  Response.json(value, {
    status,
    headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' },
  });
async function bounded(request: Request, maximum: number) {
  const length = request.headers.get('Content-Length');
  if (length !== null && (!/^\d+$/.test(length) || Number(length) > maximum))
    refuse(413, 'Bounded request exceeded.');
  const result = new Uint8Array(maximum),
    reader = request.body?.getReader();
  if (!reader) refuse(400, 'Missing body.');
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader!.read();
      if (done) break;
      if (size + value.length > maximum) refuse(413, 'Bounded request exceeded.');
      result.set(value, size);
      size += value.length;
    }
  } finally {
    await reader!.cancel().catch(() => undefined);
  }
  if (length !== null && size !== Number(length)) refuse(400, 'Wrong body length.');
  return result.subarray(0, size);
}
interface Spec {
  size: number;
  sha256: string;
  type: string;
}
interface Row {
  state: string;
  backend: 'sqlite' | 'kv';
  owner: string;
  identity: string;
  manifest: string;
  specs: string;
  reserved: number;
  generation: number;
  proofs: string | null;
}
interface Part {
  image: number;
  part: number;
  hash: string;
  bytes: number;
  key: string;
  ready: number;
  attempted: number;
  data?: ArrayBuffer;
}
interface Env {
  RESEARCH_LOCAL_ONLY: string;
  RESEARCH_CAPS?: string;
  ORIGINALS: KVNamespace;
  LIBRARY: DurableObjectNamespace;
}

export class ResearchLibrary {
  private sql: SqlStorage;
  private tail: Promise<unknown> = Promise.resolve();
  private caps: Record<string, number>;
  private usage = {
    sqlCalls: 0,
    sqlMutationCalls: 0,
    rowsRead: 0,
    rowsWritten: 0,
    kvRead: 0,
    kvWrite: 0,
    kvDelete: 0,
    requests: 0,
  };
  constructor(
    private ctx: DurableObjectState,
    private env: Env,
  ) {
    this.sql = ctx.storage.sql;
    this.caps = JSON.parse(env.RESEARCH_CAPS || '{}');
    this.q(
      'CREATE TABLE IF NOT EXISTS control (id INTEGER PRIMARY KEY, stopped INTEGER NOT NULL, generation INTEGER NOT NULL)',
    );
    this.q('INSERT OR IGNORE INTO control VALUES (1,0,0)');
    this.q(
      'CREATE TABLE IF NOT EXISTS publication (id INTEGER PRIMARY KEY, state TEXT NOT NULL, backend TEXT NOT NULL, owner TEXT NOT NULL, identity TEXT NOT NULL, manifest TEXT NOT NULL, specs TEXT NOT NULL, reserved INTEGER NOT NULL, generation INTEGER NOT NULL, proofs TEXT)',
    );
    this.q(
      'CREATE TABLE IF NOT EXISTS parts (image INTEGER NOT NULL, part INTEGER NOT NULL, hash TEXT NOT NULL, bytes INTEGER NOT NULL, key TEXT NOT NULL, ready INTEGER NOT NULL, attempted INTEGER NOT NULL, data BLOB, PRIMARY KEY(image,part))',
    );
  }
  private q<T = Record<string, unknown>>(statement: string, ...values: any[]): T[] {
    if (
      /^(INSERT|UPDATE|DELETE)/.test(statement) &&
      ++this.usage.sqlMutationCalls > (this.caps.sqlWriteCalls ?? Number.MAX_SAFE_INTEGER)
    )
      refuse(503, 'Injected SQL write-call budget exhausted (not provider row metering).');
    const cursor = this.sql.exec(statement, ...values);
    const result = cursor.toArray();
    this.usage.sqlCalls++;
    this.usage.rowsRead += cursor.rowsRead;
    this.usage.rowsWritten += cursor.rowsWritten;
    return result as T[];
  }
  private row() {
    return this.q<Row>('SELECT * FROM publication WHERE id=1')[0];
  }
  private control() {
    return this.q<{ stopped: number; generation: number }>('SELECT * FROM control WHERE id=1')[0];
  }
  private assertOpen(generation: number) {
    const c = this.control();
    if (c.stopped || c.generation !== generation) refuse(503, 'Publishing stopped or fenced.');
  }
  private async owner(request: Request, row = this.row()) {
    const token = request.headers.get('Authorization')?.replace(/^Bearer /, '') || '';
    if (!row || token.length < 16 || (await digest(new TextEncoder().encode(token))) !== row.owner)
      refuse(403, 'Private owner capability required.');
    return row;
  }
  private meter(kind: 'kvRead' | 'kvWrite' | 'kvDelete') {
    const next = ++this.usage[kind];
    if (next > (this.caps[kind] ?? Number.MAX_SAFE_INTEGER))
      refuse(503, `Injected provider ${kind} quota exhausted.`);
  }
  private fault(request: Request, phase: string) {
    if (request.headers.get('X-Research-Fault') === phase)
      refuse(503, `Injected ${phase} failure.`);
  }
  private async partBytes(row: Row, part: Part, request?: Request) {
    if (row.backend === 'sqlite')
      return this.q<{ data: ArrayBuffer }>(
        'SELECT data FROM parts WHERE image=? AND part=?',
        part.image,
        part.part,
      )[0]?.data;
    this.meter('kvRead');
    // Negative/stale visibility is an injected consistency model, not Miniflare behavior.
    if (request?.headers.get('X-Research-KV-Visibility') === 'missing') return null;
    return this.env.ORIGINALS.get(part.key, 'arrayBuffer');
  }
  private async begin(request: Request) {
    const c = this.control();
    if (c.stopped) refuse(503, 'Publishing stopped.');
    const payload = JSON.parse(new TextDecoder().decode(await bounded(request, 64000)));
    const manifest = manifestSchema.parse(payload.manifest),
      specs: Spec[] = payload.files;
    const backend = new URL(request.url).searchParams.get('backend');
    if (
      !['sqlite', 'kv'].includes(backend || '') ||
      !Array.isArray(specs) ||
      specs.length !== manifest.images.length ||
      specs.some(
        (s) =>
          !Number.isSafeInteger(s.size) ||
          s.size < 1 ||
          s.size > FILE_BYTES ||
          !/^[0-9a-f]{64}$/.test(s.sha256) ||
          !['image/png', 'image/jpeg', 'image/webp'].includes(s.type),
      )
    )
      refuse(400, 'Invalid immutable file specifications.');
    const total = specs.reduce((n, s) => n + s.size, 0);
    if (total > TOTAL_BYTES || total > (this.caps.storageBytes ?? TOTAL_BYTES))
      refuse(413, 'Original storage reservation exceeded.');
    const token = request.headers.get('Authorization')?.replace(/^Bearer /, '') || '';
    if (token.length < 16 || token.length > 256) refuse(403, 'Private owner capability required.');
    const owner = await digest(new TextEncoder().encode(token));
    const identity = await digest(
      new TextEncoder().encode(JSON.stringify({ manifest, specs, backend })),
    );
    const old = this.row();
    if (old) {
      await this.owner(request, old);
      if (old.state === 'deleted' || old.state === 'deleting') refuse(410, 'Tombstoned identity.');
      if (old.identity !== identity) refuse(409, 'Conflicting retry.');
      return json({ state: old.state, retry: true });
    }
    this.assertOpen(c.generation);
    this.q(
      'INSERT INTO publication VALUES (1,?,?,?,?,?,?,?,?,NULL)',
      'pending',
      backend,
      owner,
      identity,
      JSON.stringify(manifest),
      JSON.stringify(specs),
      total,
      c.generation,
    );
    return json({ state: 'pending' }, 201);
  }
  private async put(request: Request, image: number, ordinal: number) {
    const row = await this.owner(request),
      specs: Spec[] = JSON.parse(row.specs),
      spec = specs[image];
    this.assertOpen(row.generation);
    if (
      row.state !== 'pending' ||
      !spec ||
      !Number.isSafeInteger(ordinal) ||
      ordinal < 0 ||
      ordinal >= Math.ceil(spec.size / PART_BYTES)
    )
      refuse(409, 'Unexpected part or publication state.');
    const bytes = await bounded(request, Math.min(PART_BYTES, spec.size - ordinal * PART_BYTES));
    if (bytes.length !== Math.min(PART_BYTES, spec.size - ordinal * PART_BYTES))
      refuse(400, 'Incorrect part length.');
    const hash = await digest(bytes);
    this.assertOpen(row.generation);
    let old = this.q<Part>('SELECT * FROM parts WHERE image=? AND part=?', image, ordinal)[0];
    if (old && old.hash !== hash) refuse(409, 'Conflicting original bytes.');
    if (old?.ready) return json({ retry: true });
    const key = `quarantine/${this.ctx.id.toString()}/${image}/${ordinal}`;
    if (old && row.backend === 'kv') {
      const existing = await this.partBytes(row, old, request);
      if (existing && (await digest(existing)) === hash) {
        this.q('UPDATE parts SET ready=1 WHERE image=? AND part=?', image, ordinal);
        return json({ recovered: true });
      }
      if (Date.now() - old.attempted < 1100)
        refuse(503, 'Ambiguous KV write; retry after backoff.');
    }
    if (!old)
      this.q(
        'INSERT INTO parts VALUES (?,?,?,?,?,0,?,NULL)',
        image,
        ordinal,
        hash,
        bytes.length,
        key,
        Date.now(),
      );
    else
      this.q('UPDATE parts SET attempted=? WHERE image=? AND part=?', Date.now(), image, ordinal);
    this.fault(request, 'before-write');
    if (row.backend === 'kv') {
      this.meter('kvWrite');
      await this.env.ORIGINALS.put(key, bytes);
      this.fault(request, 'after-write');
      this.assertOpen(row.generation);
      this.q('UPDATE parts SET ready=1 WHERE image=? AND part=?', image, ordinal);
    } else {
      this.ctx.storage.transactionSync(() =>
        this.q('UPDATE parts SET data=?,ready=1 WHERE image=? AND part=?', bytes, image, ordinal),
      );
      this.fault(request, 'after-write');
    }
    return json({ stored: true }, 201);
  }
  private async finalize(request: Request) {
    const row = await this.owner(request);
    if (row.state === 'active')
      return json({ state: 'active', recovered: true, proofs: JSON.parse(row.proofs!) });
    this.assertOpen(row.generation);
    if (row.state !== 'pending') refuse(409, 'Not pending.');
    const specs: Spec[] = JSON.parse(row.specs),
      proofs = [];
    for (let image = 0; image < specs.length; image++) {
      const spec = specs[image],
        bytes = new Uint8Array(spec.size);
      const parts = this.q<Part>(
        'SELECT image,part,hash,bytes,key,ready,attempted FROM parts WHERE image=? ORDER BY part',
        image,
      );
      if (parts.length !== Math.ceil(spec.size / PART_BYTES) || parts.some((p, n) => p.part !== n))
        refuse(409, 'Incomplete original.');
      for (const part of parts) {
        const value = await this.partBytes(row, part, request);
        if (!value) refuse(503, 'Original not visible yet.');
        if (value.byteLength !== part.bytes || (await digest(value)) !== part.hash)
          refuse(415, 'Stored part integrity failed.');
        bytes.set(new Uint8Array(value), part.part * PART_BYTES);
      }
      const sha256 = await digest(bytes);
      if (sha256 !== spec.sha256) refuse(415, 'Whole-original SHA-256 mismatch.');
      // Storage experiment only: retains all CURRENT production checks. JPEG/
      // WebP checks remain structural; full codecs are researched separately.
      let info;
      try {
        info = await validateImage(bytes, limits);
      } catch {
        refuse(415, 'Current image validation failed.');
      }
      if (info!.type !== spec.type) refuse(415, 'MIME mismatch.');
      proofs.push({ ...info!, sha256, size: spec.size });
    }
    if (request.headers.get('X-Research-Fault') === 'stop-before-activate')
      this.q('UPDATE control SET stopped=1,generation=generation+1');
    this.assertOpen(row.generation);
    this.q(
      "UPDATE publication SET state='active',proofs=? WHERE id=1 AND state='pending'",
      JSON.stringify(proofs),
    );
    this.fault(request, 'after-activate');
    return json({ state: 'active', proofs });
  }
  private async read(image: number, request: Request) {
    const row = this.row();
    if (row?.state !== 'active') refuse(404, 'Not public.');
    const specs: Spec[] = JSON.parse(row.specs);
    if (!specs[image]) refuse(404, 'Unknown image.');
    const parts = this.q<Part>(
      'SELECT image,part,hash,bytes,key,ready,attempted FROM parts WHERE image=? ORDER BY part',
      image,
    );
    let ordinal = 0;
    const stream = new ReadableStream(
      {
        pull: async (controller) => {
          if (this.row()?.state !== 'active') {
            controller.error(new Error('Publication withdrawn.'));
            return;
          }
          if (ordinal === parts.length) {
            controller.close();
            return;
          }
          const value = await this.partBytes(row, parts[ordinal++], request);
          if (!value) {
            controller.error(new Error('KV original temporarily missing.'));
            return;
          }
          controller.enqueue(new Uint8Array(value));
        },
      },
      { highWaterMark: 0 },
    );
    return new Response(stream, {
      headers: {
        'Content-Type': specs[image].type,
        'Content-Length': String(specs[image].size),
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
        'Content-Disposition': `inline; filename="screenshot-${image + 1}.${specs[image].type === 'image/jpeg' ? 'jpg' : specs[image].type.split('/')[1]}"`,
      },
    });
  }
  private async erase(request: Request) {
    const row = await this.owner(request);
    this.q("UPDATE publication SET state='deleting' WHERE id=1 AND state!='deleted'");
    const parts = this.q<Part>(
      'SELECT image,part,hash,bytes,key,ready,attempted FROM parts ORDER BY image,part LIMIT ?',
      CLEANUP_PARTS,
    );
    for (const part of parts) {
      this.fault(request, 'before-delete');
      if (row.backend === 'kv') {
        this.meter('kvDelete');
        await this.env.ORIGINALS.delete(part.key);
      }
      this.fault(request, 'after-delete');
      this.q('DELETE FROM parts WHERE image=? AND part=?', part.image, part.part);
    }
    const remaining = this.q<{ n: number }>('SELECT COUNT(*) n FROM parts')[0].n;
    if (!remaining) this.q("UPDATE publication SET state='deleted',reserved=0 WHERE id=1");
    return json({ state: remaining ? 'deleting' : 'deleted', remaining });
  }
  async fetch(request: Request) {
    if (this.env.RESEARCH_LOCAL_ONLY !== 'yes')
      return json({ error: 'Local research disabled.' }, 503);
    this.usage.requests++;
    const action = async () => {
      try {
        const url = new URL(request.url),
          path = url.pathname;
        if (path === '/begin' && request.method === 'POST') return await this.begin(request);
        if (path === '/status') {
          const row = await this.owner(request);
          return json({
            state: row.state,
            reserved: row.reserved,
            proofs: row.proofs ? JSON.parse(row.proofs) : null,
            usage: this.usage,
          });
        }
        if (path === '/sql-limit' && request.method === 'POST') {
          await this.owner(request);
          const bytes = await bounded(request, 3 * PART_BYTES);
          this.q('CREATE TABLE IF NOT EXISTS research_limit_probe (data BLOB)');
          try {
            this.q('INSERT INTO research_limit_probe VALUES (?)', bytes);
            return json({ accepted: true, bytes: bytes.length });
          } catch (error) {
            return json({ accepted: false, bytes: bytes.length, error: String(error) });
          } finally {
            this.q('DELETE FROM research_limit_probe');
          }
        }
        if (path === '/stop' && request.method === 'POST') {
          await this.owner(request);
          this.q('UPDATE control SET stopped=1,generation=generation+1');
          return json({ stopped: true });
        }
        if (path === '/finalize' && request.method === 'POST') return await this.finalize(request);
        if (path === '/delete' && request.method === 'POST') return await this.erase(request);
        const part = path.match(/^\/images\/(\d+)\/parts\/(\d+)$/);
        if (part && request.method === 'PUT')
          return await this.put(request, Number(part[1]), Number(part[2]));
        const read = path.match(/^\/images\/(\d+)$/);
        if (read && request.method === 'GET') return await this.read(Number(read[1]), request);
        if (path === '/manifest' && request.method === 'GET') {
          const row = this.row();
          if (row?.state !== 'active') refuse(404, 'Not public.');
          return json(JSON.parse(row.manifest));
        }
        return json({ error: 'Unknown research operation.' }, 404);
      } catch (error) {
        return json(
          { error: error instanceof Error ? error.message : String(error) },
          error instanceof Refusal ? error.status : 400,
        );
      }
    };
    // Reads/stop can run while a write is waiting. Mutations serialize per object;
    // stop-generation checks fence an upload after awaited byte/hash/storage work.
    const mutation = request.method !== 'GET' && new URL(request.url).pathname !== '/stop';
    if (!mutation) return action();
    const pending = this.tail.then(action);
    this.tail = pending.catch(() => undefined);
    return pending;
  }
}

export default {
  async fetch(request: Request, env: Env) {
    const url = new URL(request.url);
    if (env.RESEARCH_LOCAL_ONLY !== 'yes' || url.hostname !== LOCAL_HOST)
      return json({ error: 'Local research only.' }, 403);
    const match = url.pathname.match(/^\/objects\/([a-z0-9-]{1,64})(\/.*)$/);
    if (!match) return json({ error: 'Unknown local research route.' }, 404);
    url.pathname = match[2];
    return env.LIBRARY.get(env.LIBRARY.idFromName(match[1])).fetch(new Request(url, request));
  },
};
