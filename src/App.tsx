import { useCallback, useEffect, useRef, useState } from 'react'
import type { RefObject } from 'react'
import { useAppStore } from './store/app.store'
import { VideoPlayer } from './components/VideoPlayer'
import { SubtitleOverlay, SubtitleBelow } from './components/SubtitleOverlay'
import { Controls } from './components/Controls'
import { UrlInput } from './components/UrlInput'
import { useSonioxLive } from './hooks/useSonioxLive'

export default function App() {
  const videoRef = useRef<HTMLVideoElement>(null)
  const playerWrapRef = useRef<HTMLDivElement>(null)
  const [isFullscreen, setIsFullscreen] = useState(false)

  const subtitleMode = useAppStore((s) => s.settings.subtitleMode)
  const videoSource = useAppStore((s) => s.videoSource)
  const setError = useAppStore((s) => s.setError)
  const { start, stop } = useSonioxLive({ videoRef })

  // Lắng nghe sự kiện toàn màn hình từ trình duyệt
  useEffect(() => {
    const handleFsChange = async () => {
      const fsEl = document.fullscreenElement || (document as any).webkitFullscreenElement
      const video = videoRef.current
      const wrap = playerWrapRef.current

      // Nếu thẻ video bị browser đưa vào native fullscreen (ví dụ qua menu chuột phải),
      // tự động chuyển sang fullscreen container để hiển thị trọn vẹn lớp phủ phụ đề
      if (fsEl && fsEl === video && wrap && wrap.requestFullscreen) {
        try {
          await wrap.requestFullscreen()
          return
        } catch {
          // bỏ qua nếu browser từ chối
        }
      }

      const isFs = Boolean(fsEl && (fsEl === wrap || fsEl === video))
      setIsFullscreen(isFs)
    }

    document.addEventListener('fullscreenchange', handleFsChange)
    document.addEventListener('webkitfullscreenchange', handleFsChange)

    const video = videoRef.current
    const onWebkitBegin = () => setIsFullscreen(true)
    const onWebkitEnd = () => setIsFullscreen(false)
    video?.addEventListener('webkitbeginfullscreen', onWebkitBegin)
    video?.addEventListener('webkitendfullscreen', onWebkitEnd)

    return () => {
      document.removeEventListener('fullscreenchange', handleFsChange)
      document.removeEventListener('webkitfullscreenchange', handleFsChange)
      video?.removeEventListener('webkitbeginfullscreen', onWebkitBegin)
      video?.removeEventListener('webkitendfullscreen', onWebkitEnd)
    }
  }, [])

  // Bật/tắt toàn màn hình: hỗ trợ cả Native Fullscreen API và Viewport Fullscreen fallback (cho iframe)
  const toggleFullscreen = useCallback(async () => {
    const wrap = playerWrapRef.current
    const video = videoRef.current
    if (!wrap) return

    const isCurrentFs =
      isFullscreen ||
      Boolean(
        document.fullscreenElement ||
          (document as any).webkitFullscreenElement ||
          (video as any)?.webkitDisplayingFullscreen,
      )

    if (isCurrentFs) {
      setIsFullscreen(false)
      try {
        if (document.fullscreenElement || (document as any).webkitFullscreenElement) {
          if (document.exitFullscreen) {
            await document.exitFullscreen()
          } else if ((document as any).webkitExitFullscreen) {
            await (document as any).webkitExitFullscreen()
          }
        }
      } catch (err) {
        console.warn('Exit fullscreen notice:', err)
      }
    } else {
      setIsFullscreen(true)
      try {
        if (wrap.requestFullscreen) {
          await wrap.requestFullscreen()
        } else if ((wrap as any).webkitRequestFullscreen) {
          await (wrap as any).webkitRequestFullscreen()
        } else if ((wrap as any).mozRequestFullScreen) {
          await (wrap as any).mozRequestFullScreen()
        } else if ((wrap as any).msRequestFullscreen) {
          await (wrap as any).msRequestFullscreen()
        } else if (video && (video as any).webkitEnterFullscreen) {
          ;(video as any).webkitEnterFullscreen()
        }
      } catch (err) {
        // Trong môi trường iframe bị chặn Fullscreen API, setIsFullscreen(true)
        // sẽ kích hoạt CSS Viewport Fullscreen (fixed 100vw x 100vh) đảm bảo luôn hoạt động!
        console.warn('Native requestFullscreen blocked, using viewport fullscreen:', err)
      }
    }
  }, [isFullscreen])

  // Phím tắt 'F' để phóng to/thu nhỏ, 'Escape' để thoát
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isFullscreen) {
        setIsFullscreen(false)
        if (document.fullscreenElement && document.exitFullscreen) {
          document.exitFullscreen().catch(() => {})
        }
        return
      }

      if (e.key === 'f' || e.key === 'F') {
        const target = e.target as HTMLElement | null
        if (
          target &&
          (target.tagName === 'INPUT' ||
            target.tagName === 'TEXTAREA' ||
            target.isContentEditable)
        ) {
          return
        }
        e.preventDefault()
        toggleFullscreen()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [toggleFullscreen, isFullscreen])

  const onVideoReady = useCallback(() => {
    const st = useAppStore.getState()
    if (st.status === 'live' || st.status === 'connecting') {
      // AudioContext ready
    }
  }, [])

  const onVideoError = useCallback(
    (msg: string) => {
      setError(msg)
    },
    [setError],
  )

  const videoRefObj = videoRef as RefObject<HTMLVideoElement>

  return (
    <div className="app">
      <header className="app-header">
        <div className="brand">
          <span className="brand-mark" />
          <span className="brand-name">LiveSubs</span>
        </div>
        <div className="header-tag">Soniox Real-time STT + Dịch</div>
      </header>

      <main className="app-main">
        <section className="player-zone">
          {videoSource.kind === 'none' ? (
            <div className="empty-state">
              <div className="empty-icon">▶</div>
              <div className="empty-title">Chưa chọn video</div>
              <div className="empty-sub">Dán URL hoặc chọn file để bắt đầu.</div>
            </div>
          ) : (
            <div
              ref={playerWrapRef}
              className={`player-wrap ${isFullscreen ? 'is-fullscreen' : ''}`}
            >
              <VideoPlayer
                videoRef={videoRefObj}
                containerRef={playerWrapRef}
                isFullscreen={isFullscreen}
                onToggleFullscreen={toggleFullscreen}
                onVideoReady={onVideoReady}
                onVideoError={onVideoError}
              />
              {/* Khi toàn màn hình, luôn hiển thị SubtitleOverlay để phụ đề nổi rõ ràng trên video */}
              {(subtitleMode === 'overlay' || isFullscreen) && (
                <SubtitleOverlay videoRef={videoRefObj} isFullscreen={isFullscreen} />
              )}
            </div>
          )}
          {subtitleMode === 'below' && !isFullscreen && videoSource.kind !== 'none' && (
            <SubtitleBelow videoRef={videoRefObj} />
          )}
        </section>

        <section className="panel">
          <UrlInput />
          <Controls
            onStart={start}
            onStop={stop}
            onToggleFullscreen={videoSource.kind !== 'none' ? toggleFullscreen : undefined}
            isFullscreen={isFullscreen}
          />
        </section>
      </main>

      <footer className="app-footer">
        <span>Audio → PCM 16kHz → wss://stt-rt.soniox.com</span>
      </footer>
    </div>
  )
}
