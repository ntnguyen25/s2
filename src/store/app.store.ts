import { create } from 'zustand'
import type { AppSettings, Cue, Token } from '../lib/types'

type VideoSource =
  | { kind: 'none' }
  | { kind: 'url'; url: string }
  | { kind: 'file'; file: File; objectUrl: string }

type Status = 'idle' | 'connecting' | 'live' | 'error'

type State = {
  videoSource: VideoSource
  videoUrlForElement: string | null
  status: Status
  statusMsg: string
  detectedSourceLang: string | null // ngôn ngữ nguồn tự động nhận diện từ âm thanh
  // tokens -> cues
  interimOriginal: string
  interimTranslation: string
  cuesOriginal: Cue[]
  cuesTranslation: Cue[]
  // settings persisted
  settings: AppSettings
  // runtime
  isCapturing: boolean
  error: string | null
}

type Actions = {
  setVideoUrl: (url: string) => void
  setVideoFile: (file: File) => void
  clearVideo: () => void
  setStatus: (s: Status, msg?: string) => void
  setError: (msg: string | null) => void
  setCapturing: (v: boolean) => void
  patchSettings: (p: Partial<AppSettings>) => void
  ingestTokens: (tokens: Token[]) => void
  clearTranscript: () => void
  resetInterim: () => void
  syncVideoTime: (ms: number) => void
}

const STORAGE_KEY = 'livesubs:settings:v1'

function loadSettings(): AppSettings {
  const fallback: AppSettings = {
    apiKeyInput: '',
    useServerKey: true,
    autoDetectSourceLang: true,
    srcLangHints: ['en', 'vi'],
    targetLang: 'vi',
    enableTranslation: true,
    fontScale: 1,
    subtitleDurationSec: 8,
    subtitleMode: 'overlay',
    showOriginal: true,
    showTranslation: true,
    useMediaProxy: false,
  }
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return fallback
    const j = JSON.parse(raw) as Partial<AppSettings>
    return {
      ...fallback,
      ...j,
      autoDetectSourceLang: j.autoDetectSourceLang !== undefined ? Boolean(j.autoDetectSourceLang) : true,
      subtitleDurationSec: j.subtitleDurationSec || 8,
      srcLangHints: (j.srcLangHints || fallback.srcLangHints).slice(0, 4),
    }
  } catch {
    return fallback
  }
}

function saveSettings(s: AppSettings) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s))
  } catch {
    // ignore quota
  }
}

let lastKnownStartMs = 0
let lastKnownEndMs = 0

function appendTokenText(prev: string, next: string): string {
  const p = prev.trimEnd()
  const n = next.trimStart()
  if (!p) return n
  if (!n) return p
  if (/^[.,!?:;]/.test(n)) {
    return p + n
  }
  return p + ' ' + n
}

function appendOrAddCue(
  cues: Cue[],
  text: string,
  startMs: number,
  endMs: number,
  speaker?: string,
  lang?: string,
  isTranslation = false,
): Cue[] {
  const clean = text.trim()
  if (!clean) return cues

  const res = [...cues]
  const last = res[res.length - 1]

  // Gom các từ vào cùng một câu phụ đề nếu câu chưa kết thúc bởi dấu câu và nằm trong luồng liên tục
  const shouldAppend =
    last &&
    last.text.length < 65 &&
    !/[.?!]\s*$/.test(last.text) &&
    startMs >= last.startMs &&
    startMs - last.endMs >= -500 &&
    startMs - last.endMs < 1200

  if (shouldAppend) {
    res[res.length - 1] = {
      ...last,
      text: appendTokenText(last.text, clean),
      endMs: Math.max(last.endMs, endMs, last.startMs + (isTranslation ? 8500 : 7500)),
    }
  } else {
    // Kiểm tra xem đã có cue trùng lặp ở cùng mốc thời gian hay chưa (ví dụ tua lại đúng đoạn này)
    const existingIndex = res.findIndex(
      (c) => Math.abs(c.startMs - startMs) < 600,
    )
    if (existingIndex !== -1) {
      res[existingIndex] = {
        ...res[existingIndex],
        text: clean,
        endMs: Math.max(endMs, startMs + (isTranslation ? 8500 : 7500)),
      }
    } else {
      res.push({
        id: `${Date.now()}-${isTranslation ? 'tr-' : ''}${Math.random().toString(36).slice(2, 7)}`,
        text: clean,
        startMs,
        endMs: Math.max(endMs, startMs + (isTranslation ? 8500 : 7500)),
        isFinal: true,
        speaker,
        lang,
      })
    }
  }

  // Luôn đảm bảo danh sách phụ đề được sắp xếp tuần tự theo thời gian video
  res.sort((a, b) => a.startMs - b.startMs)
  return res.slice(-300)
}

export const useAppStore = create<State & Actions>((set, get) => ({
  videoSource: { kind: 'none' },
  videoUrlForElement: null,
  status: 'idle',
  statusMsg: 'Sẵn sàng.',
  detectedSourceLang: null,
  interimOriginal: '',
  interimTranslation: '',
  cuesOriginal: [],
  cuesTranslation: [],
  settings: loadSettings(),
  isCapturing: false,
  error: null,

  setVideoUrl(url) {
    const prev = get().videoUrlForElement
    if (prev?.startsWith('blob:')) URL.revokeObjectURL(prev)
    const trimmed = url.trim()
    if (!trimmed) {
      set({ videoSource: { kind: 'none' }, videoUrlForElement: null })
      return
    }
    set({ videoSource: { kind: 'url', url: trimmed }, videoUrlForElement: trimmed })
  },

  setVideoFile(file) {
    const prev = get().videoUrlForElement
    if (prev?.startsWith('blob:')) URL.revokeObjectURL(prev)
    const objectUrl = URL.createObjectURL(file)
    set({ videoSource: { kind: 'file', file, objectUrl }, videoUrlForElement: objectUrl })
  },

  clearVideo() {
    lastKnownStartMs = 0
    lastKnownEndMs = 0
    const prev = get().videoUrlForElement
    if (prev?.startsWith('blob:')) URL.revokeObjectURL(prev)
    set({
      videoSource: { kind: 'none' },
      videoUrlForElement: null,
      detectedSourceLang: null,
      interimOriginal: '',
      interimTranslation: '',
      cuesOriginal: [],
      cuesTranslation: [],
      status: 'idle',
      statusMsg: 'Sẵn sàng.',
      error: null,
    })
  },

  setStatus(s, msg) {
    set({ status: s, statusMsg: msg ?? '' })
  },
  setError(msg) {
    set({ error: msg, status: msg ? 'error' : get().status, statusMsg: msg || get().statusMsg })
  },
  setCapturing(v) {
    set({ isCapturing: v })
  },

  patchSettings(p) {
    const next = { ...get().settings, ...p }
    // chuẩn hoá
    if (next.srcLangHints.length > 4) next.srcLangHints = next.srcLangHints.slice(0, 4)
    if (next.fontScale < 0.85) next.fontScale = 0.85
    if (next.fontScale > 1.5) next.fontScale = 1.5
    if (!next.subtitleDurationSec || next.subtitleDurationSec < 4) next.subtitleDurationSec = 4
    if (next.subtitleDurationSec > 20) next.subtitleDurationSec = 20
    set({ settings: next })
    saveSettings(next)
  },

  ingestTokens(tokens) {
    const origTokens = tokens.filter((t) => t.translation_status !== 'translation')
    const transTokens = tokens.filter((t) => t.translation_status === 'translation')
    const effOrig = origTokens.length ? origTokens : transTokens.length ? [] : tokens

    // Nhận diện ngôn ngữ từ token gốc trả về từ Soniox
    let newlyDetectedLang: string | null = null
    for (const t of origTokens.length ? origTokens : tokens) {
      if (t.language && t.language !== 'unknown') {
        newlyDetectedLang = t.language.toLowerCase()
        break
      }
    }

    let nextInterimOrig: string | undefined = undefined
    let updatedCuesOrig = get().cuesOriginal

    if (effOrig.length > 0) {
      const finalTokens = effOrig.filter((t) => t.is_final)
      const interimTokens = effOrig.filter((t) => !t.is_final)
      nextInterimOrig = interimTokens.map((t) => t.text).join('')

      if (finalTokens.length > 0) {
        const text = finalTokens.map((t) => t.text).join('').trim()
        if (text) {
          const start = finalTokens[0].start_ms ?? lastKnownStartMs
          const end = finalTokens[finalTokens.length - 1].end_ms ?? (start + 1200)
          lastKnownStartMs = start
          lastKnownEndMs = end
          updatedCuesOrig = appendOrAddCue(
            updatedCuesOrig,
            text,
            start,
            end,
            finalTokens[0].speaker,
            finalTokens[0].language,
            false,
          )
        }
      }
    }

    let nextInterimTrans: string | undefined = undefined
    let updatedCuesTrans = get().cuesTranslation

    if (transTokens.length > 0) {
      const finalTrans = transTokens.filter((t) => t.is_final)
      const interimTrans = transTokens.filter((t) => !t.is_final)
      nextInterimTrans = interimTrans.map((t) => t.text).join('')

      if (finalTrans.length > 0) {
        const text = finalTrans.map((t) => t.text).join('').trim()
        if (text) {
          const refStart = finalTrans[0].start_ms ?? lastKnownStartMs
          const refEnd =
            finalTrans[finalTrans.length - 1].end_ms ?? Math.max(lastKnownEndMs, refStart + 2500)
          updatedCuesTrans = appendOrAddCue(
            updatedCuesTrans,
            text,
            refStart,
            refEnd,
            finalTrans[0].speaker,
            finalTrans[0].language,
            true,
          )
        }
      }
    }

    set((s) => ({
      detectedSourceLang: newlyDetectedLang || s.detectedSourceLang,
      interimOriginal: nextInterimOrig !== undefined ? nextInterimOrig : s.interimOriginal,
      interimTranslation: nextInterimTrans !== undefined ? nextInterimTrans : s.interimTranslation,
      cuesOriginal: updatedCuesOrig,
      cuesTranslation: updatedCuesTrans,
    }))
  },

  clearTranscript() {
    lastKnownStartMs = 0
    lastKnownEndMs = 0
    set({
      cuesOriginal: [],
      cuesTranslation: [],
      interimOriginal: '',
      interimTranslation: '',
      detectedSourceLang: null,
    })
  },
  resetInterim() {
    set({ interimOriginal: '', interimTranslation: '' })
  },
  syncVideoTime(ms: number) {
    lastKnownStartMs = ms
    lastKnownEndMs = ms + 1000
  },
}))