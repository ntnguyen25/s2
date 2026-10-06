import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const ROOT = path.resolve(__dirname, '..')
const DIST = path.join(ROOT, 'dist')

const app = express()
const PORT = Number(process.env.PORT || 8787)

const allowed = (process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)

app.use(cors())
app.options('*', cors())
app.use(express.json({ limit: '1mb' }))

// --- health
app.get('/api/health', (_req, res) => res.json({ ok: true }))

// --- temporary api key (khuyến nghị cho browser)
// POST https://api.soniox.com/v1/auth/temporary-api-key  {usage_type, expires_in_seconds}
app.get('/api/soniox/temporary-key', async (req, res) => {
  const key = process.env.SONIOX_API_KEY
  if (!key) {
    return res.status(400).json({
      error: 'Thiếu SONIOX_API_KEY ở server. Đặt key trong .env hoặc nhập key trực tiếp ở giao diện.',
    })
  }
  const usp = new URLSearchParams(req.url.split('?')[1] || '')
  const expires = Math.min(
    Math.max(Number(usp.get('expires_in_seconds') || 120), 30),
    600,
  )
  const clientRef = String(usp.get('client_reference_id') || '').slice(0, 128)

  try {
    const body = {
      usage_type: 'transcribe_websocket',
      expires_in_seconds: expires,
      ...(clientRef ? { client_reference_id: clientRef } : {}),
    }
    const r = await fetch('https://api.soniox.com/v1/auth/temporary-api-key', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    })
    const data = await r.json().catch(() => ({}))
    if (!r.ok) {
      return res.status(r.status).json({ error: data?.error || data || 'Soniox temporary-key failed' })
    }
    // Soniox trả về { api_key, expires_at, ... }
    return res.json(data)
  } catch (e) {
    return res.status(500).json({ error: String(e) })
  }
})

// --- media proxy (né CORS cho URL video)
const MEDIA_PROXY_ALLOWLIST = (process.env.MEDIA_PROXY_ALLOWLIST || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)

app.get('/api/media/proxy', async (req, res) => {
  const target = String(req.query.url || '')
  if (!/^https?:\/\//i.test(target)) {
    return res.status(400).json({ error: 'URL không hợp lệ' })
  }
  if (MEDIA_PROXY_ALLOWLIST.length) {
    const host = new URL(target).host
    if (!MEDIA_PROXY_ALLOWLIST.some((h) => host === h || host.endsWith(`.${h}`))) {
      return res.status(403).json({ error: 'Host không nằm trong allowlist' })
    }
  }
  try {
    const r = await fetch(target, {
      headers: {
        Range: String(req.headers.range || ''),
        'User-Agent': 'LiveSubs/1.0',
      },
    })
    const headers = new Headers()
    const pass = ['content-type', 'content-length', 'content-range', 'accept-ranges', 'etag', 'last-modified']
    for (const k of pass) {
      const v = r.headers.get(k)
      if (v) headers.set(k, v)
    }
    headers.set('Access-Control-Allow-Origin', '*')
    headers.set('Cache-Control', 'public, max-age=300')
    const body = r.ok || r.status === 206 ? Buffer.from(await r.arrayBuffer()) : null
    res.status(r.status)
    for (const [k, v] of headers.entries()) res.setHeader(k, v)
    if (body) res.send(body)
    else res.end()
  } catch (e) {
    res.status(502).json({ error: String(e) })
  }
})

// --- static (production)
app.use(express.static(DIST, { maxAge: '1h', index: false }))
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/')) return next()
  const index = path.join(DIST, 'index.html')
  res.sendFile(index, (err) => {
    if (err) next()
  })
})

app.listen(PORT, () => {
  console.log(`[server] http://localhost:${PORT}`)
  if (!process.env.SONIOX_API_KEY) {
    console.log('[server] Chưa có SONIOX_API_KEY — client vẫn có thể nhập key trực tiếp ở UI.')
  }
})