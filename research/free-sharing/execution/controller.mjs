import { createHash, randomBytes, randomUUID } from 'node:crypto';
export const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
export class LocalJobs {
  jobs = new Map();
  constructor({ attemptCap = Infinity } = {}) {
    this.attemptCap = attemptCap;
    this.attempts = 0;
  }
  begin(files, { valid = true } = {}) {
    if (this.attempts >= this.attemptCap)
      throw new Error('Injected local attempt quota exhausted.');
    const total = files.reduce((n, f) => n + f.bytes.length, 0);
    if (
      files.length < 2 ||
      files.length > 4 ||
      files.some((f) => f.bytes.length < 1 || f.bytes.length > 20971520) ||
      total > 41943040
    )
      throw new Error('Publication size/count exceeded.');
    this.attempts++;
    const specs = files.map((f, index) => ({
      index,
      size: f.bytes.length,
      sha256: hash(f.bytes),
      type: f.type,
      width: f.width,
      height: f.height,
    }));
    const manifest = {
      config: {
        mode: 'side',
        selected: [files.length - 1, 0],
        divider: 0.37000000000000005,
        view: { zoom: 2, center: { x: 12.125, y: 8.375 } },
      },
      images: specs.map((s) => ({ label: `Original ${s.index}`, file: s })),
    };
    const job = {
      id: randomUUID(),
      token: randomBytes(32).toString('hex'),
      manifest,
      manifestHash: hash(JSON.stringify(manifest)),
      specs,
      files,
      state: 'pending',
      valid,
    };
    this.jobs.set(job.id, job);
    return job;
  }
  finish(job, receipts) {
    const ok =
      job.state === 'pending' &&
      receipts.length === job.specs.length &&
      receipts.every(
        (r, i) =>
          r.state === 'validated' &&
          r.jobId === job.id &&
          r.manifestHash === job.manifestHash &&
          r.index === i &&
          r.sha256 === job.specs[i].sha256 &&
          r.size === job.specs[i].size &&
          r.type === job.specs[i].type &&
          r.width === job.specs[i].width &&
          r.height === job.specs[i].height &&
          r.originalUnchanged === true,
      );
    job.state = ok ? 'validated' : 'failed';
    return { state: job.state, manifestHash: job.manifestHash, files: receipts };
  }
  fail(job) {
    job.state = 'failed';
  }
  forget(job) {
    this.jobs.delete(job.id);
  }
}
