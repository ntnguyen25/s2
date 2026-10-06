import { useEffect, useRef, useState } from 'react'
import { useAppStore } from '../store/app.store'
import { LANGS, getLangLabel } from '../lib/types'

type Props = {
  onStart: () => void
  onStop: () => void
  onToggleFullscreen?: () => void
  isFullscreen?: boolean
}

export function Controls({ onStart, onStop, onToggleFullscreen, isFullscreen = false }: Props) {
  const status = useAppStore((s) => s.status)
  const statusMsg = useAppStore((s) => s.statusMsg)
  const error = useAppStore((s) => s.error)
  const settings = useAppStore((s) => s.settings)
  const detectedSourceLang = useAppStore((s) => s.detectedSourceLang)
  const patchSettings = useAppStore((s) => s.patchSettings)
  const clearTranscript = useAppStore((s) => s.clearTranscript)
  const [showSettings, setShowSettings] = useState(false)
  const [apiKeyLocal, setApiKeyLocal] = useState(settings.apiKeyInput)
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    setApiKeyLocal(settings.apiKeyInput)
  }, [settings.apiKeyInput])

  const live = status === 'live'
  const connecting = status === 'connecting'

  const toggleLang = (code: string) => {
    const cur = settings.srcLangHints
    if (cur.includes(code)) {
      const next = cur.filter((c) => c !== code)
      // Nếu bỏ chọn hết thì quay về chế độ tự động nhận diện
      if (next.length === 0) {
        patchSettings({ autoDetectSourceLang: true, srcLangHints: [] })
      } else {
        patchSettings({ srcLangHints: next })
      }
    } else {
      patchSettings({ autoDetectSourceLang: false, srcLangHints: [...cur, code].slice(0, 4) })
    }
  }

  return (
    <div className="controls">
      <div className="controls-row">
        <button
          className={`btn btn-primary ${live ? 'is-live' : ''}`}
          onClick={() => {
            const vs = useAppStore.getState().videoSource
            if (vs.kind === 'none') {
              useAppStore.getState().setError('Chưa chọn video. Hãy dán URL hoặc chọn file video trước.')
              return
            }
            if (live) {
              onStop()
            } else {
              onStart()
            }
          }}
          disabled={connecting}
        >
          {live ? '⏹ Dừng' : connecting ? 'Đang kết nối…' : '● Bắt đầu'}
        </button>
        <button className="btn" onClick={clearTranscript} disabled={live}>
          Xoá phụ đề
        </button>
        {onToggleFullscreen && (
          <button
            className="btn btn-fs-action"
            onClick={onToggleFullscreen}
            title={isFullscreen ? 'Thu nhỏ (F hoặc Esc)' : 'Toàn màn hình (F)'}
          >
            {isFullscreen ? '🗗 Thu nhỏ' : '⛶ Toàn màn hình'}
          </button>
        )}
        <button className="btn" onClick={() => setShowSettings((v) => !v)}>
          {showSettings ? 'Đóng' : 'Cài đặt'}
        </button>
      </div>

      <div className="controls-row controls-row-secondary">
        <button className="btn btn-ghost" onClick={() => fileRef.current?.click()}>
          Chọn file video
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="video/*,audio/*,.mkv,.avi,.mov,.webm,.mp4,.m3u8"
          style={{ display: 'none' }}
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) {
              useAppStore.getState().setError(null)
              useAppStore.getState().setVideoFile(f)
              setTimeout(() => {
                onStart()
              }, 150)
            }
            e.target.value = ''
          }}
        />

        {/* Bộ chọn nhanh ngôn ngữ nguồn - Tự động nhận diện làm mặc định */}
        <div className="quick-trans-wrap">
          <label className="quick-trans-label">Nguồn:</label>
          <select
            className="quick-trans-select"
            value={settings.autoDetectSourceLang ? 'auto' : (settings.srcLangHints[0] || 'auto')}
            onChange={(e) => {
              const val = e.target.value
              if (val === 'auto') {
                patchSettings({ autoDetectSourceLang: true })
              } else {
                patchSettings({ autoDetectSourceLang: false, srcLangHints: [val] })
              }
            }}
            disabled={live}
            title="Ngôn ngữ nguồn nói trong video (Mặc định: Tự động nhận diện)"
          >
            <option value="auto">
              ✨ Tự động {detectedSourceLang ? `(${getLangLabel(detectedSourceLang)})` : '(Mặc định)'}
            </option>
            {LANGS.map((l) => (
              <option key={l.code} value={l.code}>
                {l.label}
              </option>
            ))}
          </select>
        </div>

        <div className="quick-trans-wrap">
          <label className="quick-trans-label">Dịch sang:</label>
          <select
            className="quick-trans-select"
            value={settings.targetLang}
            onChange={(e) => patchSettings({ targetLang: e.target.value, enableTranslation: true })}
            disabled={live}
          >
            {LANGS.map((l) => (
              <option key={l.code} value={l.code}>
                {l.label}
              </option>
            ))}
          </select>
        </div>

        {detectedSourceLang && settings.autoDetectSourceLang && (
          <span className="status-pill status-detected" title={`Đã tự động xác định ngôn ngữ: ${getLangLabel(detectedSourceLang)}`}>
            🌐 {getLangLabel(detectedSourceLang)}
          </span>
        )}

        <span className={`status-pill status-${status}`}>
          {status === 'live' ? '● LIVE' : status === 'connecting' ? '…' : status === 'error' ? '⚠' : '○'}
        </span>
        <span className="status-msg">{statusMsg}</span>
      </div>

      {error && <div className="error-banner">{error}</div>}

      {showSettings && (
        <div className="settings-panel">
          <div className="settings-grid">
            <div className="field">
              <label>Soniox API Key</label>
              <div className="row">
                <input
                  type="password"
                  placeholder="Nhập key (hoặc dùng key tạm từ server)"
                  value={apiKeyLocal}
                  onChange={(e) => setApiKeyLocal(e.target.value)}
                  onBlur={() => patchSettings({ apiKeyInput: apiKeyLocal.trim() })}
                />
              </div>
              <label className="check">
                <input
                  type="checkbox"
                  checked={settings.useServerKey}
                  onChange={(e) => patchSettings({ useServerKey: e.target.checked })}
                />
                Dùng temporary key từ server (khuyến nghị)
              </label>
            </div>

            <div className="field">
              <div className="field-header-row">
                <label>Ngôn ngữ nguồn</label>
                <span className="badge-hint">
                  {settings.autoDetectSourceLang ? '✨ Tự động nhận diện (Mặc định)' : 'Gợi ý tùy chọn (tối đa 4)'}
                </span>
              </div>

              <div className="auto-lang-banner">
                <button
                  type="button"
                  className={`chip chip-auto ${settings.autoDetectSourceLang ? 'chip-on' : ''}`}
                  onClick={() => patchSettings({ autoDetectSourceLang: true })}
                >
                  ✨ Tự động xác định ngôn ngữ (Mặc định)
                </button>
                <div className="auto-lang-desc">
                  {settings.autoDetectSourceLang
                    ? (detectedSourceLang
                        ? `Đang tự động nhận diện. Ngôn ngữ hiện tại đã phát hiện: ${getLangLabel(detectedSourceLang)}`
                        : 'Soniox tự động phân tích và xác định bất kỳ ngôn ngữ nào trong hơn 60 ngôn ngữ mà không cần chọn trước.')
                    : 'Đang dùng gợi ý ngôn ngữ cụ thể. Bấm nút "Tự động xác định ngôn ngữ" ở trên để quay về mặc định.'}
                </div>
              </div>

              <div className="lang-chips">
                {LANGS.map((l) => {
                  const isSelected = !settings.autoDetectSourceLang && settings.srcLangHints.includes(l.code)
                  return (
                    <button
                      key={l.code}
                      type="button"
                      className={`chip ${isSelected ? 'chip-on' : ''}`}
                      onClick={() => {
                        if (settings.autoDetectSourceLang) {
                          patchSettings({ autoDetectSourceLang: false, srcLangHints: [l.code] })
                        } else {
                          toggleLang(l.code)
                        }
                      }}
                      title={isSelected ? `Bỏ chọn ${l.label}` : `Chọn gợi ý ${l.label}`}
                    >
                      {l.label}
                    </button>
                  )
                })}
              </div>
            </div>

            <div className="field">
              <label>Dịch sang</label>
              <div className="row">
                <select
                  value={settings.targetLang}
                  onChange={(e) => patchSettings({ targetLang: e.target.value })}
                >
                  {LANGS.map((l) => (
                    <option key={l.code} value={l.code}>
                      {l.label}
                    </option>
                  ))}
                </select>
                <label className="check">
                  <input
                    type="checkbox"
                    checked={settings.enableTranslation}
                    onChange={(e) => patchSettings({ enableTranslation: e.target.checked })}
                  />
                  Bật dịch
                </label>
              </div>
            </div>

            <div className="field">
              <label>Hiển thị</label>
              <div className="row">
                <label className="check">
                  <input
                    type="checkbox"
                    checked={settings.showOriginal}
                    onChange={(e) => patchSettings({ showOriginal: e.target.checked })}
                  />
                  Phụ đề gốc
                </label>
                <label className="check">
                  <input
                    type="checkbox"
                    checked={settings.showTranslation}
                    onChange={(e) => patchSettings({ showTranslation: e.target.checked })}
                  />
                  Phụ đề dịch
                </label>
              </div>
            </div>

            <div className="field">
              <label>Cỡ chữ: {settings.fontScale.toFixed(2)}×</label>
              <input
                type="range"
                min={0.85}
                max={1.5}
                step={0.05}
                value={settings.fontScale}
                onChange={(e) => patchSettings({ fontScale: Number(e.target.value) })}
              />
            </div>

            <div className="field">
              <label>Thời gian lưu phụ đề: {settings.subtitleDurationSec || 8} giây</label>
              <input
                type="range"
                min={4}
                max={15}
                step={1}
                value={settings.subtitleDurationSec || 8}
                onChange={(e) => patchSettings({ subtitleDurationSec: Number(e.target.value) })}
              />
              <div style={{ fontSize: '11px', color: 'var(--ink-3)', marginTop: '2px' }}>
                Giữ phụ đề hiển thị lâu hơn trên màn hình (mặc định: 8s, tối đa: 15s)
              </div>
            </div>

            <div className="field">
              <label>Chế độ phụ đề</label>
              <div className="row">
                <select
                  value={settings.subtitleMode}
                  onChange={(e) =>
                    patchSettings({ subtitleMode: e.target.value as 'overlay' | 'below' })
                  }
                >
                  <option value="overlay">Chồng lên video</option>
                  <option value="below">Dưới video</option>
                </select>
              </div>
            </div>

            <div className="field">
              <label>Mạng</label>
              <label className="check">
                <input
                  type="checkbox"
                  checked={settings.useMediaProxy}
                  onChange={(e) => patchSettings({ useMediaProxy: e.target.checked })}
                />
                Proxy media qua server (né CORS cho URL video)
              </label>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}