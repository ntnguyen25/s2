export async function onRequestGet(context: { request: Request; env: Record<string, string> }) {
  const url = new URL(context.request.url);
  const target = url.searchParams.get('url') || '';
  if (!/^https?:\/\//i.test(target)) {
    return new Response(JSON.stringify({ error: 'URL không hợp lệ' }), {
      status: 400,
      headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*' },
    });
  }
  // Allowlist tuỳ chọn: MEDIA_PROXY_ALLOWLIST = "example.com,cdn.example.com"
  const allowRaw = (context.env.MEDIA_PROXY_ALLOWLIST || '').trim();
  if (allowRaw) {
    const allow = allowRaw.split(',').map(s => s.trim()).filter(Boolean);
    const host = new URL(target).host;
    const ok = allow.some(h => host === h || host.endsWith('.' + h));
    if (!ok) return new Response(JSON.stringify({ error: 'Host không nằm trong allowlist' }), {
      status: 403, headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*' },
    });
  }
  const range = context.request.headers.get('range') || '';
  const r = await fetch(target, { headers: { ...(range ? { Range: range } : {}), 'User-Agent': 'LiveSubs/1.0' } });
  const headers = new Headers();
  for (const k of ['content-type','content-length','content-range','accept-ranges','etag','last-modified']) {
    const v = r.headers.get(k);
    if (v) headers.set(k, v);
  }
  headers.set('access-control-allow-origin', '*');
  headers.set('cache-control', 'public, max-age=300');
  const buf = await r.arrayBuffer();
  return new Response(r.ok || r.status === 206 ? buf : null, { status: r.status, headers });
}
export async function onRequestOptions() {
  return new Response(null, {
    headers: {
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'GET, OPTIONS',
      'access-control-allow-headers': 'Range, Content-Type',
    },
  });
}
