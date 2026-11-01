import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { decoderCorpus } from '../corpus.mjs';
import { components, describe as fileDescription } from '../execution/fixtures.mjs';
import { createLab } from '../execution/lab.mjs';
import { LocalJobs } from '../execution/controller.mjs';
import { browserBudget } from '../execution/budget.mjs';
let lab, browser, small, corpus;
beforeAll(async () => {
  const c = await components();
  small = await fileDescription(c.rasterPng(32, 24), 'small', 'image/png', c.validateImage);
  corpus = await decoderCorpus();
  for (const item of corpus)
    item.file = await fileDescription(
      item.bytes,
      item.name,
      item.format === 'jpeg' ? 'image/jpeg' : 'image/webp',
      c.validateImage,
    );
  lab = await createLab();
  browser = await lab.openBrowser();
});
afterAll(async () => {
  await lab?.close();
});
describe.each(['browser', 'workerd'])(
  '%s research validation and fail-closed receipts',
  (runtime) => {
    for (const name of [
      'jpeg-baseline',
      'jpeg-progressive',
      'webp-lossy',
      'webp-lossless-alpha',
      'jpeg-missing-tables-blocks',
      'webp-missing-coded-raster',
      'jpeg-truncated-entropy-valid-eoi',
      'jpeg-oversubscribed-huffman-table',
      'jpeg-missing-eoi',
      'webp-truncated-vp8-correct-container',
      'webp-truncated-vp8l-correct-container',
      'webp-truncated-container',
      'jpeg-rotated-exif',
      'jpeg-valid-after-rejections',
      'webp-valid-after-rejections',
    ]) {
      it(name, async () => {
        const item = corpus.find((x) => x.name === name),
          job = lab.jobs.begin([small, item.file]);
        try {
          const result =
            runtime === 'browser'
              ? await lab.browserJob(job, { browser })
              : await lab.workerJob(job);
          expect(result.state, JSON.stringify(result)).toBe(item.valid ? 'validated' : 'failed');
          if (item.valid) {
            expect(result.files.every((f) => f.originalUnchanged)).toBe(true);
            expect(JSON.stringify(result).length).toBeLessThan(8000);
          } else {
            expect(result.files[0].state).toBe('validated');
            expect(job.state).toBe('failed');
          }
        } finally {
          lab.jobs.forget(job);
        }
      });
    }
    it('rejects corrupt PNG CRC without replacing existing security checks', async () => {
      const bytes = Buffer.from(small.bytes);
      bytes[29] ^= 1;
      const job = lab.jobs.begin([small, { ...small, bytes }]);
      const result =
        runtime === 'browser' ? await lab.browserJob(job, { browser }) : await lab.workerJob(job);
      expect(result.state).toBe('failed');
      expect(result.files.at(-1).reason).toContain('checksum');
      lab.jobs.forget(job);
    });
  },
);
it('keeps fixture downloads private and withdraws them when a job fails', async () => {
  const job = lab.jobs.begin([small, small]),
    url = `${lab.origin}/jobs/${job.id}/files/0`;
  try {
    expect((await fetch(url)).status).toBe(403);
    expect((await fetch(url, { headers: { Authorization: `Bearer ${job.token}` } })).status).toBe(
      200,
    );
    lab.jobs.fail(job);
    expect((await fetch(url, { headers: { Authorization: `Bearer ${job.token}` } })).status).toBe(
      403,
    );
  } finally {
    lab.jobs.forget(job);
  }
});
it('refuses external fetches from the local browser', async () => {
  const job = lab.jobs.begin([small, small]),
    context = await browser.newContext();
  try {
    await context.route('**/*', (route) =>
      new URL(route.request().url()).origin === lab.origin ? route.continue() : route.abort(),
    );
    const page = await context.newPage();
    await page.goto(lab.origin + '/runner.html');
    expect(
      await page.evaluate(async () => {
        try {
          await fetch('https://example.com/never-send');
          return false;
        } catch {
          return true;
        }
      }),
    ).toBe(true);
  } finally {
    await context.close();
    lab.jobs.forget(job);
  }
});
it('times out a hung task, releases its context and refuses late successful receipts', async () => {
  const job = lab.jobs.begin([small, small]),
    result = await lab.browserJob(job, { browser, simulate: 'hang-last', deadlineMs: 1000 });
  expect(result.state).toBe('failed');
  expect(result.reason).toContain('deadline');
  expect(browser.contexts()).toHaveLength(0);
  expect(result.files).toHaveLength(1);
  expect(lab.jobs.finish(job, []).state).toBe('failed');
  lab.jobs.forget(job);
});
it('cancels explicitly without leaving a live context or accepting a partial job', async () => {
  const controller = new AbortController(),
    job = lab.jobs.begin([small, small]);
  const timeout = setTimeout(() => controller.abort(), 700);
  try {
    const result = await lab.browserJob(job, {
      browser,
      simulate: 'hang-last',
      signal: controller.signal,
    });
    expect(result.state).toBe('failed');
    expect(result.reason).toContain('cancelled');
    expect(browser.contexts()).toHaveLength(0);
  } finally {
    clearTimeout(timeout);
    lab.jobs.forget(job);
  }
});
it('fails closed when the local browser disappears and closes the owned session', async () => {
  const job = lab.jobs.begin([small, small]),
    before = lab.browsers.size;
  const result = await lab.browserJob(job, { simulate: 'crash' });
  expect(result.state).toBe('failed');
  expect(result.browserSessionClosed).toBe(true);
  expect(lab.browsers.size).toBe(before);
  lab.jobs.forget(job);
});
it('refuses completion when context-close acknowledgment is uncertain', async () => {
  const wrapped = {
    newContext: async (options) => {
      const context = await browser.newContext(options),
        close = context.close.bind(context);
      context.close = async () => {
        await close();
        throw new Error('Injected lost cleanup acknowledgment.');
      };
      return context;
    },
    version: () => browser.version(),
    isConnected: () => browser.isConnected(),
  };
  const job = lab.jobs.begin([small, small]);
  try {
    const result = await lab.browserJob(job, { browser: wrapped });
    expect(result.files).toHaveLength(2);
    expect(result.state).toBe('failed');
    expect(job.state).toBe('failed');
    expect(result.reason).toContain('Uncertain local cleanup');
  } finally {
    lab.jobs.forget(job);
  }
});
it('rejects mismatched hashes, manifest/job identities and file order in completion receipts', () => {
  for (const mutation of [
    (r) => (r[0].sha256 = '0'.repeat(64)),
    (r) => (r[0].manifestHash = 'wrong'),
    (r) => (r[0].jobId = 'wrong'),
    (r) => (r[0].index = 1),
  ]) {
    const jobs = new LocalJobs(),
      job = jobs.begin([small, small]),
      receipts = job.specs.map((spec) => ({
        ...spec,
        state: 'validated',
        jobId: job.id,
        manifestHash: job.manifestHash,
        originalUnchanged: true,
      }));
    mutation(receipts);
    expect(jobs.finish(job, receipts).state).toBe('failed');
  }
});
it('models quota refusal before creating a second job without pretending to test a provider limit', () => {
  const jobs = new LocalJobs({ attemptCap: 1 });
  jobs.begin([small, small]);
  expect(() => jobs.begin([small, small])).toThrow('quota');
  expect(jobs.jobs.size).toBe(1);
});
it('counts failures and unclosed-session idle time rather than using decoder time as a daily budget', () => {
  const model = browserBudget(60, { publicationsPerDay: 5 });
  expect(model.modeledSeconds).toBe(390);
  expect(model.belowWorkingBudget).toBe(false);
  expect(model.belowPublishedAllowance).toBe(true);
  expect(browserBudget(200, { publicationsPerDay: 3 }).belowPublishedAllowance).toBe(false);
  expect(model.cloudflareFreeCertified).toBe(false);
});
it('enforces original count and file/aggregate sizes before executing either validator', () => {
  const jobs = new LocalJobs();
  expect(() => jobs.begin([small])).toThrow('size/count');
  expect(() => jobs.begin(Array(5).fill(small))).toThrow('size/count');
  const bytes = Buffer.alloc(20971521);
  expect(() => jobs.begin([{ ...small, bytes }, small])).toThrow('size/count');
  const max = { ...small, bytes: bytes.subarray(0, 20971520) };
  expect(() => jobs.begin([max, max, max])).toThrow('size/count');
});
