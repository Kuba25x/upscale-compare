import { writeFile } from 'node:fs/promises';
const { D1_ID, BUCKET, FRONTEND_URL } = process.env;
if (
  !D1_ID ||
  !/^[a-f0-9-]{36}$/i.test(D1_ID) ||
  !BUCKET ||
  !/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(BUCKET)
) {
  throw new Error(
    'Configure a valid CLOUDFLARE_D1_ID and CLOUDFLARE_R2_BUCKET first. This script does not create resources.',
  );
}
const frontend = new URL(FRONTEND_URL || '');
if (
  frontend.protocol !== 'https:' ||
  frontend.hash ||
  frontend.search ||
  frontend.username ||
  frontend.password
)
  throw new Error('FRONTEND_URL must be an HTTPS URL without credentials, query, or hash.');
if (!frontend.pathname.endsWith('/')) frontend.pathname += '/';
const config = {
  name: 'upscale-compare-api',
  main: 'src/index.ts',
  compatibility_date: '2026-07-01',
  workers_dev: false,
  preview_urls: false,
  observability: { enabled: false },
  vars: {
    ENVIRONMENT: 'production',
    UPLOADS_ENABLED: 'false',
    ALLOWED_ORIGINS: frontend.origin,
    FRONTEND_URL: frontend.href,
    MAX_FILE_BYTES: '20971520',
    MAX_TOTAL_BYTES: '41943040',
    MAX_DIMENSION: '16384',
    MAX_PIXELS: '36000000',
    MAX_STORAGE_BYTES: '5368709120',
    MAX_COMPARISONS: '1000',
    PUBLISHES_PER_HOUR: '5',
    READS_PER_MINUTE: '240',
  },
  d1_databases: [
    {
      binding: 'DB',
      database_name: 'upscale-compare',
      database_id: D1_ID,
      migrations_dir: 'migrations',
    },
  ],
  r2_buckets: [{ binding: 'IMAGES', bucket_name: BUCKET }],
  triggers: { crons: ['17 * * * *'] },
};
// An explicit cap for an already approved Paid account; this does not choose,
// activate or upgrade a Cloudflare plan. Free has its own fixed CPU limit.
const cpuLimit = process.env.APPROVED_PAID_CPU_MS;
if (cpuLimit) {
  if (
    !/^[1-9]\d*$/.test(cpuLimit) ||
    !Number.isSafeInteger(Number(cpuLimit)) ||
    Number(cpuLimit) > 1000
  )
    throw new Error(
      'APPROVED_PAID_CPU_MS must be an explicit integer from 1 to 1000 milliseconds.',
    );
  config.limits = { cpu_ms: Number(cpuLimit) };
}
await writeFile('worker/wrangler.production.json', `${JSON.stringify(config, null, 2)}\n`);
console.log(
  'Prepared production configuration. Uploads, workers.dev, preview URLs and Worker observability are disabled. No resources were created or plans selected.',
);
