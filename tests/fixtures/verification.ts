import { Response, type V4FetchHandler } from 'miniflare';

export const LOCAL_VERIFICATION_SECRET = 'local-only-server-verification-secret';
export type VerificationMode =
  | 'valid'
  | 'wrong-host'
  | 'wrong-action'
  | 'not-boolean'
  | 'http-error'
  | 'malformed'
  | 'network-error'
  | 'timeout';
// Test-only outbound transport. It replaces Siteverify, never forwards requests
// and never supplies a production Worker bypass or real provider credential.
export class VerificationService {
  mode: VerificationMode = 'valid';
  requests: { token: string; correctSecret: boolean }[] = [];
  private consumed = new Set<string>();
  constructor(private hostname: string) {}
  reset() {
    this.mode = 'valid';
    this.requests = [];
    this.consumed.clear();
  }
  fetch: V4FetchHandler = async (request) => {
    if (
      request.url !== 'https://challenges.cloudflare.com/turnstile/v0/siteverify' ||
      request.method !== 'POST'
    )
      throw new Error('Unexpected outbound request in local sharing test.');
    const form = await request.formData(),
      token = String(form.get('response'));
    const correctSecret = form.get('secret') === LOCAL_VERIFICATION_SECRET;
    this.requests.push({ token, correctSecret });
    const success = correctSecret && token.startsWith('valid-') && !this.consumed.has(token);
    this.consumed.add(token);
    if (this.mode === 'network-error') throw new Error('Local verification transport failed.');
    if (this.mode === 'timeout')
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, 11000);
        request.signal.addEventListener(
          'abort',
          () => {
            clearTimeout(timer);
            resolve();
          },
          { once: true },
        );
      });
    if (this.mode === 'malformed') return new Response('not JSON');
    return new Response(
      JSON.stringify({
        success: this.mode === 'not-boolean' ? 'true' : success,
        hostname: this.mode === 'wrong-host' ? 'other.example' : this.hostname,
        action: this.mode === 'wrong-action' ? 'other' : 'publish',
      }),
      {
        status: this.mode === 'http-error' ? 503 : 200,
        headers: { 'Content-Type': 'application/json' },
      },
    );
  };
}
