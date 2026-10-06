/** PCM 16k mono worklet: nhận Float32 mẫu, downmix stereo sang mono, resample về 16kHz, gom thành chunks 50ms (800 mẫu) gửi Int16 về main thread. */
const WORKLET_CODE = `
class PcmCaptureProcessor extends AudioWorkletProcessor {
  constructor(opts) {
    super()
    this.targetRate = (opts && opts.processorOptions && opts.processorOptions.targetRate) || 16000
    this._ratio = sampleRate / this.targetRate
    this._phase = 0
    this._prev = 0
    this._hasPrev = false
    // 50ms at 16kHz = 800 samples = 1600 bytes
    this.chunkSize = 800
    this.buffer = new Int16Array(this.chunkSize)
    this.bufIndex = 0

    this.port.onmessage = (e) => {
      if (e.data && e.data.type === 'flush') {
        if (this.bufIndex > 0) {
          const trimmed = this.buffer.slice(0, this.bufIndex)
          this.port.postMessage({ type: 'pcm', buffer: trimmed.buffer }, [trimmed.buffer])
          this.bufIndex = 0
        }
      }
    }
  }

  process(inputs) {
    const input = inputs[0]
    if (!input || input.length === 0) return true
    const ch0 = input[0]
    if (!ch0 || ch0.length === 0) return true
    const ch1 = input.length > 1 ? input[1] : null

    for (let i = 0; i < ch0.length; i++) {
      // Downmix stereo (kênh trái + phải) sang mono chính xác để không mất lời thoại
      const cur = ch1 ? (ch0[i] + ch1[i]) * 0.5 : ch0[i]
      if (!this._hasPrev) {
        this._prev = cur
        this._hasPrev = true
        continue
      }
      this._phase += 1 / this._ratio
      while (this._phase >= 1) {
        this._phase -= 1
        const t = this._phase
        const sample = this._prev * (1 - t) + cur * t
        let s = Math.max(-1, Math.min(1, sample))
        s = s < 0 ? s * 0x8000 : s * 0x7fff
        this.buffer[this.bufIndex++] = s | 0

        if (this.bufIndex >= this.chunkSize) {
          this.port.postMessage({ type: 'pcm', buffer: this.buffer.buffer }, [this.buffer.buffer])
          this.buffer = new Int16Array(this.chunkSize)
          this.bufIndex = 0
        }
      }
      this._prev = cur
    }
    return true
  }
}
registerProcessor('pcm-capture', PcmCaptureProcessor)
`

export type PcmChunkListener = (pcm16: Int16Array) => void

let sharedAudioContext: AudioContext | null = null
const elementSourceMap = new WeakMap<HTMLMediaElement, MediaElementAudioSourceNode>()
let workletModuleLoaded = false

export function getOrCreateAudioContext(): AudioContext {
  const AudioCtx =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
  if (!sharedAudioContext || sharedAudioContext.state === 'closed') {
    sharedAudioContext = new AudioCtx({ sampleRate: 48000, latencyHint: 'interactive' })
    workletModuleLoaded = false
  }
  return sharedAudioContext
}

export class VideoAudioCapture {
  private ctx: AudioContext | null = null
  private worklet: AudioWorkletNode | null = null
  private onChunk: PcmChunkListener
  private isStreaming = false

  constructor(onChunk: PcmChunkListener) {
    this.onChunk = onChunk
  }

  async attach(video: HTMLVideoElement): Promise<void> {
    const ctx = getOrCreateAudioContext()

    if (!workletModuleLoaded) {
      const blob = new Blob([WORKLET_CODE], { type: 'application/javascript' })
      const url = URL.createObjectURL(blob)
      try {
        await ctx.audioWorklet.addModule(url)
        workletModuleLoaded = true
      } finally {
        URL.revokeObjectURL(url)
      }
    }

    // MediaElementAudioSourceNode chỉ được tạo 1 lần duy nhất cho mỗi phần tử HTMLMediaElement
    let src = elementSourceMap.get(video)
    if (!src) {
      src = ctx.createMediaElementSource(video)
      elementSourceMap.set(video, src)
      // Dẫn tiếng vĩnh viễn ra loa máy tính/điện thoại để xem video bình thường
      src.connect(ctx.destination)
    }

    // Nếu chưa tạo worklet cho phiên này, tạo worklet node mới
    if (!this.worklet) {
      const node = new AudioWorkletNode(ctx, 'pcm-capture', {
        processorOptions: { targetRate: 16000 },
        numberOfInputs: 1,
        numberOfOutputs: 1,
        channelCount: 1,
      })

      node.port.onmessage = (e: MessageEvent) => {
        const d = e.data as { type: string; buffer?: ArrayBuffer }
        if (this.isStreaming && d.type === 'pcm' && d.buffer) {
          this.onChunk(new Int16Array(d.buffer))
        }
      }

      try {
        src.connect(node)
      } catch {
        // already connected
      }

      this.worklet = node
    }

    if (ctx.state === 'suspended') {
      try {
        await ctx.resume()
      } catch (err) {
        console.warn('AudioContext resume deferred:', err)
      }
    }

    this.ctx = ctx
    this.isStreaming = true
  }

  async detach(): Promise<void> {
    this.isStreaming = false
    try {
      this.worklet?.port.postMessage({ type: 'flush' })
    } catch {
      // ignore
    }
  }

  get sampleRate() {
    return this.ctx?.sampleRate ?? 48000
  }

  async resume() {
    if (this.ctx && this.ctx.state === 'suspended') {
      try {
        await this.ctx.resume()
      } catch (err) {
        console.warn('AudioContext resume failed:', err)
      }
    }
  }

  async suspend() {
    if (this.ctx && this.ctx.state === 'running') {
      try {
        await this.ctx.suspend()
      } catch {
        // ignore
      }
    }
  }
}
