import type { Token } from './types'

export type SonioxConfig = {
  apiKey: string
  model?: string // stt-rt-v5
  languageHints?: string[]
  languageHintsStrict?: boolean
  enableSpeakerDiarization?: boolean
  enableLanguageIdentification?: boolean
  translation?: { type: 'one_way'; target_language: string } | null
  sampleRate?: number
  numChannels?: number
}

export type SonioxEvents = {
  onTokens: (tokens: Token[]) => void
  onEndpoint?: (payload: unknown) => void
  onError: (msg: string) => void
  onOpen?: () => void
  onClose?: (code: number, reason: string) => void
}

export class SonioxSession {
  private ws: WebSocket | null = null
  private cfg: SonioxConfig
  private ev: SonioxEvents
  private closedByClient = false
  private _rejected = false

  /** true nếu server trả về lỗi cấu hình/key (không nên reconnect). */
  get rejected() {
    return this._rejected
  }

  constructor(cfg: SonioxConfig, ev: SonioxEvents) {
    this.cfg = cfg
    this.ev = ev
  }

  connect() {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) return
    this.closedByClient = false
    this._rejected = false
    const ws = new WebSocket('wss://stt-rt.soniox.com/transcribe-websocket')
    this.ws = ws
    ws.binaryType = 'arraybuffer'

    ws.onopen = () => {
      const payload: Record<string, unknown> = {
        api_key: this.cfg.apiKey,
        model: this.cfg.model || 'stt-rt-v5',
        audio_format: 'pcm_s16le',
        sample_rate: this.cfg.sampleRate || 16000,
        num_channels: this.cfg.numChannels || 1,
      }
      if (this.cfg.languageHints?.length) payload.language_hints = this.cfg.languageHints
      if (this.cfg.languageHintsStrict) payload.language_hints_strict = true
      if (this.cfg.enableSpeakerDiarization) payload.enable_speaker_diarization = true
      if (this.cfg.enableLanguageIdentification) payload.enable_language_identification = true
      if (this.cfg.translation) payload.translation = this.cfg.translation
      // endpoint detection sensible defaults
      payload.enable_endpoint_detection = true

      ws.send(JSON.stringify(payload))
      this.ev.onOpen?.()
    }

    ws.onmessage = (e) => {
      // Soniox trả JSON text; binary close xin bỏ qua
      if (typeof e.data !== 'string') return
      let msg: Record<string, unknown>
      try {
        msg = JSON.parse(e.data)
      } catch {
        return
      }
      if (msg.error) {
        this._rejected = true
        this.ev.onError(String((msg as { error: unknown }).error ?? msg))
        return
      }
      // tokens
      const tokens = (msg.tokens as Token[] | undefined) || null
      if (tokens && tokens.length) this.ev.onTokens(tokens)
      if (msg.endpoint) this.ev.onEndpoint?.(msg)
    }

    ws.onerror = () => {
      this.ev.onError('WebSocket lỗi kết nối tới Soniox.')
    }
    ws.onclose = (e) => {
      this.ev.onClose?.(e.code, e.reason)
      if (!this.closedByClient && e.code !== 1000 && e.code !== 1005) {
        // để caller quyết định reconnect
      }
    }
  }

  sendPcm(chunk: ArrayBuffer | Int16Array | Uint8Array) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return
    if (chunk instanceof Int16Array) {
      this.ws.send(chunk.buffer.slice(chunk.byteOffset, chunk.byteOffset + chunk.byteLength))
      return
    }
    if (chunk instanceof Uint8Array) {
      // Uint8 view của PCM s16le raw
      this.ws.send(chunk.buffer.slice(chunk.byteOffset, chunk.byteOffset + chunk.byteLength))
      return
    }
    this.ws.send(chunk)
  }

  /** Gửi khung rỗng để server flush và đóng phiên — theo doc Soniox. */
  async finishGracefully(timeoutMs = 2500): Promise<void> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return
    try {
      this.ws.send(new ArrayBuffer(0))
    } catch {
      // ignore
    }
    await new Promise<void>((resolve) => {
      let done = false
      const t = setTimeout(() => {
        if (!done) {
          done = true
          resolve()
        }
      }, timeoutMs)
      const onClose = () => {
        if (done) return
        done = true
        clearTimeout(t)
        resolve()
      }
      this.ws?.addEventListener('close', onClose, { once: true })
      this.ws?.addEventListener('message', (e) => {
        if (typeof e.data === 'string') {
          try {
            const j = JSON.parse(e.data)
            if (j.finished) {
              if (!done) {
                done = true
                clearTimeout(t)
                resolve()
              }
            }
          } catch {
            // ignore
          }
        }
      })
    })
  }

  close() {
    this.closedByClient = true
    try {
      this.ws?.close(1000, 'client close')
    } catch {
      // ignore
    }
    this.ws = null
  }

  get ready() {
    return this.ws?.readyState === WebSocket.OPEN
  }
}

export async function fetchTemporaryKey(clientRef?: string): Promise<string | null> {
  const q = new URLSearchParams()
  q.set('expires_in_seconds', '120')
  if (clientRef) q.set('client_reference_id', clientRef)
  const r = await fetch(`/api/soniox/temporary-key?${q.toString()}`)
  if (!r.ok) return null
  const j = (await r.json()) as Record<string, unknown>
  // Soniox trả { api_key, ... } — fallback các key khác
  const k =
    (j.api_key as string) ||
    (j.temporary_api_key as string) ||
    (j.key as string) ||
    (j.token as string) ||
    ''
  return k || null
}