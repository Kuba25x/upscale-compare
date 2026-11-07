export const ANDROID_MODE = import.meta.env.MODE === 'android';
export const DEMO_MODE =
  ANDROID_MODE || import.meta.env.MODE === 'demo' || import.meta.env.VITE_DEMO_MODE === 'true';

export const SHARING_UNAVAILABLE_MESSAGE = ANDROID_MODE
  ? 'Public sharing is not available in this offline app. Your images stay on this device.'
  : 'Public sharing is not available in this demo. Your images stay in this browser.';

export function requireSharing(): void {
  if (DEMO_MODE) throw new Error(SHARING_UNAVAILABLE_MESSAGE);
}
