/**
 * Cloudflare Worker entry — phục vụ API routes + SPA fallback cho static assets.
 * Dùng khi deploy bằng `npx wrangler deploy` (Workers Static Assets).
 *
 * API routes:
 *   GET /api/health
 *   GET /api/soniox/temporary-key   -> temporary key từ SONIOX_API_KEY
 *   GET /api/media/proxy?url=...    -> proxy media (né CORS)
 */

type Env = {
  SONIOX_API_KEY?: string
  MEDIA_PROXY_ALLOWLIST?: string
  ASSETS: { fetch: (req: Request) => Promise<Response> }
}

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, OPTIONS',
  'access-control-allow-headers': 'Range, Content-Type',
  'access-control-max-age': '86400',
}

function json(body: unknown, status = 200, extra: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...CORS, ...extra },
  })
}

async function temporaryKey(request: Request, env: Env) {
  const key = env.SONIOX_API_KEY
  if (!key) {
    return json(
      {
        error:
          'Thiếu SONIOX_API_KEY. Thêm biến môi trường này trong Cloudflare Dashboard > Settings > Variables and Secrets (đánh dấu Encrypt), hoặc nhập key trực tiếp trong UI.',
      },
      400,
    )
  }
  const url = new URL(request.url)
  const expires = Math.min(Math.max(Number(url.searchParams.get('expires_in_seconds') || 120), 30), 600)
  const clientRef = (url.searchParams.get('client_reference_id') || '').slice(0, 128)

  const r = await fetch('https://api.soniox.com/v1/auth/temporary-api-key', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      usage_type: 'transcribe_websocket',
      expires_in_seconds: expires,
      ...(clientRef ? { client_reference_id: clientRef } : {}),
    }),
  })
  const data = await r.json().catch(() => ({}))
  if (!r.ok) {
    const err = (data as { error?: unknown })?.error
    return json({ error: err || data || 'Soniox temporary-key request failed' }, r.status)
  }
  return json(data)
}

async function mediaProxy(request: Request, env: Env) {
  const url = new URL(request.url)
  const target = url.searchParams.get('url') || ''
  if (!/^https?:\/\//i.test(target)) return json({ error: 'URL không hợp lệ' }, 400)

  const allowRaw = (env.MEDIA_PROXY_ALLOWLIST || '').trim()
  if (allowRaw) {
    const allow = allowRaw
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
    let host: string
    try {
      host = new URL(target).host
    } catch {
      return json({ error: 'URL không hợp lệ' }, 400)
    }
    if (!allow.some((h) => host === h || host.endsWith(`.${h}`))) {
      return json({ error: 'Host không nằm trong allowlist' }, 403)
    }
  }

  const range = request.headers.get('range') || ''
  let upstream: Response
  try {
    upstream = await fetch(target, {
      headers: {
        ...(range ? { Range: range } : {}),
        'User-Agent': 'LiveSubs/1.0',
        Accept: request.headers.get('accept') || '*/*',
      },
    })
  } catch (e) {
    return json({ error: `Không fetch được nguồn: ${String(e)}` }, 502)
  }

  const headers = new Headers()
  for (const k of ['content-type', 'content-length', 'content-range', 'accept-ranges', 'etag', 'last-modified']) {
    const v = upstream.headers.get(k)
    if (v) headers.set(k, v)
  }
  headers.set('access-control-allow-origin', '*')
  headers.set('cache-control', 'public, max-age=300')
  if (!headers.has('content-type')) headers.set('content-type', 'application/octet-stream')

  return new Response(upstream.body, { status: upstream.status, headers })
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const { pathname } = new URL(request.url)

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS })
    }

    if (pathname === '/api/health') return json({ ok: true })
    if (pathname === '/api/soniox/temporary-key') return temporaryKey(request, env)
    if (pathname === '/api/media/proxy') return mediaProxy(request, env)

    if (pathname.startsWith('/api/')) return json({ error: 'Not found' }, 404)

    // Static assets (index.html, JS/CSS). Assets binding tự 404 với SPA fallback
    // nên ta chỉ cần trả về kết quả của binding.
    return env.ASSETS.fetch(request)
  },
}