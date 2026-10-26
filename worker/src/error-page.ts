const escapeHtml = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!,
  );

export function comparisonErrorPage(
  status: number,
  message: string,
  frontendUrl: string,
): Response {
  const title = status === 404 ? 'Comparison not found' : 'Comparison unavailable';
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${title} — Upscale Compare</title><style>body{margin:0;background:#101114;color:#e8e9ed;font:14px/1.7 system-ui,sans-serif;min-height:100vh;display:grid;place-items:center}main{max-width:440px;padding:28px;text-align:center}h1{font-size:25px;letter-spacing:-.6px}p{color:#9ba2af}a{display:inline-block;margin-top:18px;padding:10px 20px;border-radius:7px;background:#b2e38e;color:#15220e;text-decoration:none;font-weight:600}a:focus-visible{outline:2px solid white;outline-offset:5px}</style></head><body><main role="alert"><h1>${title}</h1><p>${escapeHtml(message)}</p><a href="${escapeHtml(frontendUrl)}">Open Upscale Compare</a></main></body></html>`;
  return new Response(html, { status, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}
