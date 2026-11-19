export const APP_PORT = 4193;
export const PROVIDER_PORT = 4194;
export const LOOPBACK = '127.0.0.1';
export const APP_BASE = '/upscale-compare/';
export const APP_ORIGIN = `http://${LOOPBACK}:${APP_PORT}`;
export const APP_URL = `${APP_ORIGIN}${APP_BASE}`;
export const PROVIDER_ORIGIN = `http://${LOOPBACK}:${PROVIDER_PORT}`;
export const MOCK_PUBLIC_KEY = 'loopback-fixtures';
export const FIXTURE_NAMES = [
  'rgba-metadata.png',
  'baseline.jpg',
  'lossless-alpha.webp',
  'rgb16.png',
] as const;
export const MIME_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const;
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
export const LINK_LIMIT = 2048;
export const MAX_COMPARISON_BYTES = 40 * 1024 * 1024;
