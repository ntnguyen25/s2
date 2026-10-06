import { useEffect, useRef } from 'react'
import type { RefObject } from 'react'
import { useAppStore } from '../store/app.store'
import { getLangLabel } from '../lib/types'

type Props = {
  videoRef: RefObject<HTMLVideoElement>
  isFullscreen?: boolean
}

export function SubtitleOverlay({ videoRef, isFullscreen = false }: Props) {
  const interimOriginal = useAppStore((s) => s.interimOriginal)
  const interimTranslation = useAppStore((s) => s.interimTranslation)
  const cuesOriginal = useAppStore((s) => s.cuesOriginal)
  const cuesTranslation = useAppStore((s) => s.cuesTranslation)
  const settings = useAppStore((s) => s.settings)
  const detectedSourceLang = useAppStore((s) => s.detectedSourceLang)
  const status = useAppStore((s) => s.status)
  const rafRef = useRef<number | null>(null)

  // Vòng lặp rAF để phân chia 2 hàng: hàng trên là âm thanh đã nói, hàng dưới là âm thanh đang phát ra
  useEffect(() => {
    let mounted = true
    const tick = () => {
      if (!mounted) return
      const v = videoRef.current
      if (v) {
        const t = v.currentTime * 1000
        const durationSec = settings.subtitleDurationSec || 8
        const durationMs = durationSec * 1000

        // Tìm cue phù hợp với mốc thời gian hiện tại (lưu hiển thị tối thiểu 8s)
        const pick = (arr: typeof cuesOriginal, isTranslation = false) => {
          let best: (typeof arr)[number] | null = null
          for (let i = arr.length - 1; i >= 0; i--) {
            const c = arr[i]
            // Tăng thời gian lưu hiển thị tối thiểu theo durationMs
            const minDur = isTranslation ? durationMs + 1000 : durationMs
            const maxEnd = Math.max(c.endMs + 3500, c.startMs + minDur)
            if (c.startMs - 400 <= t && t <= maxEnd) {
              best = c
              break
            }
          }
          // Nếu video chạy qua hoặc vừa tua tới nhưng chưa có câu mới, giữ câu gần nhất trước thời điểm t trong durationMs
          if (!best && arr.length > 0) {
            for (let i = arr.length - 1; i >= 0; i--) {
              const c = arr[i]
              if (t >= c.startMs && t - c.startMs <= durationMs) {
                best = c
                break
              }
            }
          }
          return best
        }

        const o = pick(cuesOriginal, false)
        let tr = pick(cuesTranslation, true)
        if (!tr && o && cuesTranslation.length > 0) {
          tr =
            cuesTranslation.find(
              (c) =>
                Math.abs(c.startMs - o.startMs) < 3000 ||
                (c.startMs <= o.endMs && c.endMs >= o.startMs),
            ) || null
        }

        const oEl = document.getElementById('sub-spoken-orig')
        const tEl = document.getElementById('sub-spoken-trans')
        const liveEl = document.getElementById('sub-live-orig')
        const liveTransEl = document.getElementById('sub-live-trans')
        const rowSpoken = document.getElementById('sub-row-spoken')
        const rowLive = document.getElementById('sub-row-live')

        // 1. Hàng trên: Âm thanh đã nói
        const spokenOrig = o?.text || ''
        const spokenTrans = tr?.text || ''

        if (oEl) {
          if (oEl.textContent !== spokenOrig) oEl.textContent = spokenOrig
        }
        if (tEl) {
          if (tEl.textContent !== spokenTrans) tEl.textContent = spokenTrans
        }
        if (rowSpoken) {
          rowSpoken.style.display = spokenOrig || spokenTrans ? 'flex' : 'none'
        }

        // 2. Hàng dưới: Âm thanh đang phát ra thời gian thực
        const liveOrig = interimOriginal ? interimOriginal.trim() : ''
        const liveTrans = interimTranslation ? interimTranslation.trim() : ''

        if (liveEl) {
          if (liveEl.textContent !== liveOrig) liveEl.textContent = liveOrig
        }
        if (liveTransEl) {
          if (liveTransEl.textContent !== liveTrans) liveTransEl.textContent = liveTrans
        }
        if (rowLive) {
          rowLive.style.display = liveOrig || liveTrans ? 'flex' : 'none'
        }
      }
      rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
    return () => {
      mounted = false
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
    }
  }, [videoRef, cuesOriginal, cuesTranslation, interimOriginal, interimTranslation])

  const showOrig = settings.showOriginal
  const showTrans = settings.showTranslation && settings.enableTranslation
  const live = status === 'live'
  const hasCues =
    cuesOriginal.length > 0 ||
    cuesTranslation.length > 0 ||
    !!interimOriginal ||
    !!interimTranslation
  const shouldRender = (live || hasCues) && (showOrig || showTrans)

  return (
    <div
      className={`subtitle-overlay ${isFullscreen ? 'is-fullscreen' : ''}`}
      style={{ fontSize: `${settings.fontScale}em` }}
      aria-live="polite"
    >
      {shouldRender && (
        <div className="subtitle-stack">
          {/* HÀNG TRÊN: ÂM THANH ĐÃ NÓI */}
          <div
            className="subtitle-line subtitle-line-spoken"
            id="sub-row-spoken"
            style={{ display: 'none' }}
          >
            <span className="sub-row-badge badge-spoken">ĐÃ NÓI</span>
            {showOrig && <span id="sub-spoken-orig" className="sub-text" />}
            {showTrans && <span id="sub-spoken-trans" className="sub-text sub-text-trans" />}
          </div>

          {/* HÀNG DƯỚI: ÂM THANH ĐANG PHÁT RA */}
          <div
            className="subtitle-line subtitle-line-live"
            id="sub-row-live"
            style={{ display: 'none' }}
          >
            <span className="sub-row-badge badge-live">
              <span className="badge-live-dot" />
              ĐANG PHÁT{detectedSourceLang ? ` • ${getLangLabel(detectedSourceLang).toUpperCase()}` : ''}
            </span>
            {showOrig && <span id="sub-live-orig" className="sub-text sub-interim" />}
            {showTrans && (
              <span
                id="sub-live-trans"
                className="sub-text sub-text-trans sub-interim-trans"
              />
            )}
          </div>
        </div>
      )}
    </div>
  )
}

export function SubtitleBelow(_props: Props) {
  const cuesOriginal = useAppStore((s) => s.cuesOriginal)
  const cuesTranslation = useAppStore((s) => s.cuesTranslation)
  const interimOriginal = useAppStore((s) => s.interimOriginal)
  const interimTranslation = useAppStore((s) => s.interimTranslation)
  const settings = useAppStore((s) => s.settings)
  const detectedSourceLang = useAppStore((s) => s.detectedSourceLang)
  const status = useAppStore((s) => s.status)
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [cuesOriginal, cuesTranslation, interimOriginal, interimTranslation])

  const showOrig = settings.showOriginal
  const showTrans = settings.showTranslation && settings.enableTranslation
  const live = status === 'live'
  const hasCues =
    cuesOriginal.length > 0 ||
    cuesTranslation.length > 0 ||
    !!interimOriginal ||
    !!interimTranslation
  const shouldRender = (live || hasCues) && (showOrig || showTrans)

  if (!shouldRender) return null

  return (
    <div
      className="subtitle-below"
      ref={scrollRef}
      style={{ fontSize: `${settings.fontScale}em` }}
    >
      {/* Khối Hàng Trên: Âm thanh đã nói */}
      <div className="below-block">
        <div className="below-label">
          <span className="sub-row-badge badge-spoken">ĐÃ NÓI</span> Lời thoại đã phát biểu
        </div>
        <div className="below-text">
          {showOrig && (
            <div className="below-orig-stream">
              {cuesOriginal.map((c) => (
                <span key={c.id} className="below-cue">
                  {c.text}{' '}
                </span>
              ))}
            </div>
          )}
          {showTrans && cuesTranslation.length > 0 && (
            <div
              className="below-trans-stream"
              style={{ color: 'var(--accent)', marginTop: '4px' }}
            >
              {cuesTranslation.map((c) => (
                <span key={c.id} className="below-cue">
                  {c.text}{' '}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Khối Hàng Dưới: Âm thanh đang phát ra */}
      {(interimOriginal || interimTranslation) && (
        <div className="below-block">
          <div className="below-label">
            <span className="sub-row-badge badge-live">
              <span className="badge-live-dot" />
              ĐANG PHÁT{detectedSourceLang ? ` • ${getLangLabel(detectedSourceLang)}` : ''}
            </span>{' '}
            Âm thanh đang phát ra thời gian thực
          </div>
          <div className="below-text">
            {showOrig && interimOriginal && (
              <div className="sub-interim">{interimOriginal}</div>
            )}
            {showTrans && interimTranslation && (
              <div
                className="sub-interim sub-interim-trans"
                style={{ color: 'var(--accent)', marginTop: '2px' }}
              >
                {interimTranslation}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

export function fmtTime(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000))
  const m = Math.floor(s / 60)
  const sec = s % 60
  return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
}
