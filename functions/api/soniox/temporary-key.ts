export async function onRequestGet(context: { request: Request; env: Record<string, string> }) {
  const env = context.env as Record<string, string>;
  const key = env.SONIOX_API_KEY;
  if (!key) {
    return new Response(JSON.stringify({ error: 'Thiếu SONIOX_API_KEY. Vào Cloudflare Pages > Settings > Variables and Secrets và thêm SONIOX_API_KEY.' }), {
      status: 400,
      headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*' },
    });
  }
  const url = new URL(context.request.url);
  const expires = Math.min(Math.max(Number(url.searchParams.get('expires_in_seconds') || 120), 30), 600);
  const clientRef = (url.searchParams.get('client_reference_id') || '').slice(0, 128);
  const body: Record<string, unknown> = {
    usage_type: 'transcribe_websocket',
    expires_in_seconds: expires,
    ...(clientRef ? { client_reference_id: clientRef } : {}),
  };
  const r = await fetch('https://api.soniox.com/v1/auth/temporary-api-key', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    return new Response(JSON.stringify({ error: (data as any)?.error || data || 'Soniox temporary-key failed' }), {
      status: r.status,
      headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*' },
    });
  }
  return new Response(JSON.stringify(data), {
    headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*', 'cache-control': 'no-store' },
  });
}

// Cho phép preflight
export async function onRequestOptions() {
  return new Response(null, {
    headers: {
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'GET, OPTIONS',
      'access-control-allow-headers': 'Content-Type, Authorization',
    },
  });
}
