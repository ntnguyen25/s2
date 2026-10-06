export type Token = {
  text: string
  start_ms?: number
  end_ms?: number
  confidence?: number
  is_final: boolean
  speaker?: string
  language?: string
  translation_status?: string // 'translation' cho token dịch
}

export type Cue = {
  id: string
  text: string
  startMs: number
  endMs: number
  isFinal: boolean
  speaker?: string
  lang?: string
}

export const LANGS = [
  { code: 'vi', label: 'Tiếng Việt' },
  { code: 'en', label: 'English' },
  { code: 'ja', label: '日本語' },
  { code: 'ko', label: '한국어' },
  { code: 'zh', label: '中文' },
  { code: 'fr', label: 'Français' },
  { code: 'de', label: 'Deutsch' },
  { code: 'es', label: 'Español' },
  { code: 'th', label: 'ไทย' },
  { code: 'id', label: 'Indonesia' },
  { code: 'ms', label: 'Melayu' },
  { code: 'hi', label: 'हिन्दी' },
  { code: 'ar', label: 'العربية' },
  { code: 'ru', label: 'Русский' },
  { code: 'pt', label: 'Português' },
  { code: 'it', label: 'Italiano' },
] as const

export function getLangLabel(code?: string | null): string {
  if (!code) return ''
  const found = LANGS.find((l) => l.code.toLowerCase() === code.toLowerCase())
  return found ? found.label : code.toUpperCase()
}

export type AppSettings = {
  apiKeyInput: string
  useServerKey: boolean
  autoDetectSourceLang: boolean // Tự động xác định ngôn ngữ nguồn (mặc định: true)
  srcLangHints: string[] // gợi ý ngôn ngữ nguồn cho Soniox khi tắt tự động
  targetLang: string // ngôn ngữ đích cho translation one_way
  enableTranslation: boolean
  fontScale: number // 0.85..1.5
  subtitleDurationSec: number // Thời gian hiển thị phụ đề (giây, 4..15s, mặc định 8s)
  subtitleMode: 'overlay' | 'below'
  showOriginal: boolean
  showTranslation: boolean
  useMediaProxy: boolean // đi qua /api/media/proxy để né CORS
}