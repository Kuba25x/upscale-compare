import { createServer } from 'node:http';
import { readFile, access } from 'node:fs/promises';
import { resolve } from 'node:path';
import { build } from 'esbuild';
import { chromium } from '@playwright/test';
import { Miniflare, convertV4MiniflareOptions, Log, LogLevel } from 'miniflare';
import { LocalJobs } from './controller.mjs';
import { root, output } from './fixtures.mjs';
export async function createLab(options = {}) {
  const dir = resolve(root, 'research/free-sharing'),
    jobs = new LocalJobs(options);
  const bundle = await build({
    entryPoints: [resolve(dir, 'execution/browser-entry.mjs')],
    bundle: true,
    write: false,
    platform: 'browser',
    format: 'esm',
  });
  // Packaging is outside BOTH execution timers. Cold workerd still includes
  // emulator/runtime startup, but not local esbuild compilation.
  const workerBundle = await build({
    entryPoints: [resolve(dir, 'execution/worker-entry.mjs')],
    bundle: true,
    write: false,
    platform: 'browser',
    format: 'esm',
    external: ['./codec-jpeg.wasm', './codec-webp.wasm'],
  });
  const wasm = {
    jpeg: await readFile(resolve(dir, 'node_modules/@jsquash/jpeg/codec/dec/mozjpeg_dec.wasm')),
    webp: await readFile(resolve(dir, 'node_modules/@jsquash/webp/codec/dec/webp_dec.wasm')),
  };
  const assets = new Map([
    ['/runner.js', { type: 'text/javascript', data: bundle.outputFiles[0].text }],
    [
      '/runner.html',
      {
        type: 'text/html',
        data: '<!doctype html><meta charset="utf-8"><script type="module" src="/runner.js"></script>',
      },
    ],
    ...Object.entries(wasm).map(([format, data]) => [
      `/codec-${format}.wasm`,
      { type: 'application/wasm', data },
    ]),
  ]);
  const stats = { privateReads: 0, deniedReads: 0, blockedBrowserRequests: 0 },
    browsers = new Set();
  let origin;
  const server = createServer((req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'",
    );
    if (req.method !== 'GET' || req.headers.host !== new URL(origin).host) {
      res.writeHead(403).end();
      return;
    }
    const asset = assets.get(req.url);
    if (asset) {
      res.setHeader('Content-Type', asset.type);
      res.end(asset.data);
      return;
    }
    const match = req.url.match(/^\/jobs\/([a-f0-9-]{36})\/files\/([0-3])$/),
      job = match && jobs.jobs.get(match[1]);
    if (!job) {
      res.writeHead(404).end();
      return;
    }
    if (req.headers.authorization !== `Bearer ${job.token}` || job.state !== 'pending') {
      stats.deniedReads++;
      res.writeHead(403).end();
      return;
    }
    const file = job.files[Number(match[2])];
    if (!file) {
      res.writeHead(404).end();
      return;
    }
    stats.privateReads++;
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Length', String(file.bytes.length));
    res.end(file.bytes);
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  origin = `http://127.0.0.1:${server.address().port}`;
  let mf;
  async function workerRuntime() {
    if (mf) return mf;
    mf = new Miniflare(
      convertV4MiniflareOptions({
        modulesRoot: output,
        modules: [
          {
            type: 'ESModule',
            path: resolve(output, 'execution-worker.mjs'),
            contents: workerBundle.outputFiles[0].text,
          },
          ...Object.entries(wasm).map(([format, contents]) => ({
            type: 'CompiledWasm',
            path: resolve(output, `codec-${format}.wasm`),
            contents,
          })),
        ],
        compatibilityDate: '2026-07-01',
        bindings: { LOCAL_EXECUTION_RESEARCH: 'yes' },
        outboundService: () => {
          throw new Error('Local research outbound denied.');
        },
        log: new Log(LogLevel.NONE),
        cf: false,
      }),
    );
    return mf;
  }
  async function openBrowser() {
    let executablePath = chromium.executablePath();
    try {
      await access(executablePath);
    } catch {
      executablePath = '/usr/bin/chromium';
    }
    const browser = await chromium.launch({
      executablePath,
      headless: true,
      timeout: 15000,
      args: [
        '--no-sandbox',
        '--disable-background-networking',
        '--disable-component-update',
        '--disable-default-apps',
        '--no-first-run',
        '--proxy-server=http://127.0.0.1:1',
        '--proxy-bypass-list=127.0.0.1;localhost',
      ],
    });
    browsers.add(browser);
    browser.on('disconnected', () => browsers.delete(browser));
    return browser;
  }
  async function browserJob(job, { browser: borrowed, deadlineMs = 30000, simulate, signal } = {}) {
    const start = performance.now(),
      receipts = [];
    const cleanupErrors = [];
    let completed = false;
    let browser,
      context,
      cancelled = false,
      timer,
      reason,
      verdict,
      launchWallMs = 0,
      onAbort;
    const overhead = {
      pageSetupWallMs: 0,
      pageCloseWallMs: 0,
      contextCloseWallMs: 0,
      browserCloseWallMs: 0,
    };
    if (signal?.aborted) {
      jobs.fail(job);
      return {
        state: 'failed',
        files: [],
        reason: 'Job cancelled before launch.',
        wholeLocalJobWallMs: 0,
      };
    }
    const launched = borrowed ? Promise.resolve(borrowed) : openBrowser();
    const work = (async () => {
      browser = await launched;
      launchWallMs = performance.now() - start;
      if (cancelled) throw new Error('Job deadline exceeded.');
      context = await browser.newContext({ serviceWorkers: 'block' });
      await context.route('**/*', (route) => {
        const u = new URL(route.request().url());
        if (u.origin === origin) return route.continue();
        stats.blockedBrowserRequests++;
        return route.abort();
      });
      for (const spec of job.specs) {
        const setupStart = performance.now(),
          page = await context.newPage();
        await page.goto(origin + '/runner.html');
        await page.waitForFunction(() => globalThis.researchReady === true);
        overhead.pageSetupWallMs += performance.now() - setupStart;
        if (simulate === 'crash') {
          await browser.close();
          throw new Error('Injected local browser crash.');
        }
        const cdp = await context.newCDPSession(page);
        await cdp.send('Performance.enable');
        const before = (await cdp.send('Performance.getMetrics')).metrics;
        const result = await page.evaluate((payload) => globalThis.validateResearchFile(payload), {
          spec,
          identity: { jobId: job.id, manifestHash: job.manifestHash },
          token: job.token,
          simulate:
            simulate === 'hang-last' && spec.index === job.specs.length - 1 ? 'hang' : simulate,
        });
        const after = (await cdp.send('Performance.getMetrics')).metrics;
        const get = (list, name) => list.find((m) => m.name === name)?.value;
        result.metrics.rendererMainThreadTaskMs =
          ((get(after, 'TaskDuration') ?? 0) - (get(before, 'TaskDuration') ?? 0)) * 1000;
        result.metrics.rendererJsHeapUsedAfterBytes = get(after, 'JSHeapUsedSize') ?? null;
        receipts.push(result);
        const closeStart = performance.now();
        await page.close();
        overhead.pageCloseWallMs += performance.now() - closeStart;
        if (result.state !== 'validated') break;
      }
      return receipts;
    })();
    try {
      await Promise.race([
        work,
        new Promise((_, reject) => {
          timer = setTimeout(() => {
            cancelled = true;
            reject(new Error('Job deadline exceeded.'));
          }, deadlineMs);
          onAbort = () => {
            cancelled = true;
            reject(new Error('Job cancelled.'));
          };
          signal?.addEventListener('abort', onAbort, { once: true });
        }),
      ]);
      completed = true;
    } catch (error) {
      cancelled = true;
      reason = String(error);
      jobs.fail(job);
      verdict = { state: 'failed', files: receipts };
    } finally {
      clearTimeout(timer);
      if (onAbort) signal?.removeEventListener('abort', onAbort);
      browser = await launched.catch(() => null);
      let closeStart = performance.now();
      await context?.close().catch((error) => cleanupErrors.push(String(error)));
      overhead.contextCloseWallMs = performance.now() - closeStart;
      if (!borrowed) {
        closeStart = performance.now();
        await browser?.close().catch((error) => cleanupErrors.push(String(error)));
        overhead.browserCloseWallMs = performance.now() - closeStart;
      }
      work.catch(() => undefined);
    }
    if (completed && cleanupErrors.length === 0) verdict = jobs.finish(job, receipts);
    else if (cleanupErrors.length) {
      jobs.fail(job);
      verdict = { state: 'failed', files: receipts };
      reason = 'Uncertain local cleanup: ' + cleanupErrors.join('; ');
    }
    return {
      ...verdict,
      reason,
      ...overhead,
      chromiumVersion: browser?.version(),
      launchWallMs: borrowed ? 0 : launchWallMs,
      wholeLocalJobWallMs: performance.now() - start,
      browserSessionClosed: !borrowed && (!browser || !browser.isConnected()),
      cloudflareFreeCertified: false,
    };
  }
  async function workerJob(job) {
    const start = performance.now(),
      receipts = [];
    try {
      const runtime = await workerRuntime();
      for (const spec of job.specs) {
        const requestStart = performance.now(),
          response = await runtime.dispatchFetch('http://local-research.invalid/validate', {
            method: 'POST',
            headers: {
              'X-Research-Descriptor': JSON.stringify({
                spec,
                identity: { jobId: job.id, manifestHash: job.manifestHash },
              }),
            },
            body: job.files[spec.index].bytes,
          });
        const result = await response.json();
        result.metrics ??= {};
        result.metrics.hostDispatchWallMs = performance.now() - requestStart;
        receipts.push(result);
        if (result.state !== 'validated') break;
      }
      return {
        ...jobs.finish(job, receipts),
        wholeLocalJobWallMs: performance.now() - start,
        cloudflareFreeCertified: false,
      };
    } catch (error) {
      jobs.fail(job);
      return {
        state: 'failed',
        reason: String(error),
        files: receipts,
        wholeLocalJobWallMs: performance.now() - start,
        cloudflareFreeCertified: false,
      };
    }
  }
  async function close() {
    for (const browser of [...browsers]) await browser.close().catch(() => undefined);
    await mf?.dispose();
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
  return { jobs, origin, stats, browsers, openBrowser, browserJob, workerJob, close };
}
