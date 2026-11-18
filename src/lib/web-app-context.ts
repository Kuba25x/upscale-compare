// A fixed launch hint, never an installation/authentication or storage credential.
export const PWA_LAUNCH_QUERY = '?pwa=fullscreen';
export const pwaStartUrl = (base: string) => `${base}${PWA_LAUNCH_QUERY}`;

export function isManifestFullscreenLaunch({
  enabled,
  search,
  fullscreen,
  browser,
  apiFullscreen,
}: {
  enabled: boolean;
  search: string;
  fullscreen: boolean;
  browser: boolean;
  apiFullscreen: boolean;
}): boolean {
  return (
    enabled &&
    new URLSearchParams(search).get('pwa') === 'fullscreen' &&
    fullscreen &&
    !browser &&
    !apiFullscreen
  );
}
