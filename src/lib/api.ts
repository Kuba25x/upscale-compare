import type { LocalImage, Manifest, PublicComparison } from '../../shared/model';

export const API_URL = (import.meta.env.VITE_API_URL || 'http://localhost:8787').replace(/\/$/, '');
export async function apiFetch(path: string, init?: RequestInit): Promise<Response> {
  let response: Response;
  try {
    response = await fetch(`${API_URL}${path}`, init);
  } catch {
    throw new Error(
      'The sharing service is unavailable. Your local images are safe. Please try again later.',
    );
  }
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error || `The sharing service returned an error (${response.status}).`);
  }
  return response;
}
export async function publish(images: LocalImage[], manifest: Manifest, challenge: string) {
  const body = new FormData();
  body.append('manifest', JSON.stringify(manifest));
  body.append('challenge', challenge);
  images.forEach((image) => {
    if (!image.file) throw new Error('Only local comparisons can be published.');
    body.append('images', image.file, image.name);
  });
  const response = await apiFetch('/api/comparisons', { method: 'POST', body });
  return response.json() as Promise<{ id: string; deleteToken: string; shareUrl: string }>;
}
export async function fetchComparison(id: string): Promise<PublicComparison> {
  return (await apiFetch(`/api/comparisons/${encodeURIComponent(id)}`)).json();
}
export const publicImageUrl = (id: string, index: number) =>
  `${API_URL}/api/comparisons/${id}/images/${index}`;
export const shareHashUrl = (id: string) => `${location.origin}${import.meta.env.BASE_URL}#c/${id}`;
