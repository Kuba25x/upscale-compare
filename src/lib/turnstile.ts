export interface Turnstile {
  render: (element: HTMLElement, options: Record<string, unknown>) => string;
  remove: (id: string) => void;
  reset: (id: string) => void;
}
declare global {
  interface Window {
    turnstile?: Turnstile;
  }
}
let pending: Promise<Turnstile> | undefined;
const available = () =>
  window.turnstile &&
  ['render', 'remove', 'reset'].every(
    (method) => typeof window.turnstile![method as keyof Turnstile] === 'function',
  );

export async function loadTurnstile(): Promise<Turnstile> {
  if (available()) return Promise.resolve(window.turnstile!);
  if (pending) return pending;
  // A failed/stalled script must not strand every later dialog on a load event
  // that already happened. All callers share the current bounded attempt.
  document.querySelector('script[data-turnstile]')?.remove();
  const script = document.createElement('script');
  script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
  script.async = true;
  script.dataset.turnstile = 'true';
  const current = new Promise<Turnstile>((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timer);
      script.removeEventListener('load', loaded);
      script.removeEventListener('error', failed);
    };
    const failed = () => {
      cleanup();
      script.remove();
      reject(new Error('Verification could not load. Check your connection and try again.'));
    };
    const loaded = () => {
      if (!available()) return failed();
      cleanup();
      resolve(window.turnstile!);
    };
    const timer = setTimeout(failed, 15000);
    script.addEventListener('load', loaded, { once: true });
    script.addEventListener('error', failed, { once: true });
    document.head.append(script);
  });
  pending = current;
  const clearPending = () => {
    if (pending === current) pending = undefined;
  };
  void current.then(clearPending, clearPending);
  return current;
}
