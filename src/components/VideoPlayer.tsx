import { useEffect, useRef, useState } from 'react'
import type { RefObject } from 'react'
import Hls from 'hls.js'
import { Maximize, Minimize } from 'lucide-react'
import { useAppStore } from '../store/app.store'
import type { Cue } from '../lib/types'

type Props = {
  videoRef: RefObject<HTMLVideoElement>
  containerRef?: RefObject<HTMLDivElement>
  isFullscreen?: boolean
  onToggleFullscreen?: () => void
  onVideoReady: () => void
  onVideoError: (msg: string) => void
}

const HLS_EXT = /\.(m3u8)(\?|#|$)/i

export function VideoPlayer({
  videoRef,
  containerRef,
  isFullscreen = false,
  onToggleFullscreen,
  onVideoReady,
  onVideoError,
}: Props) {
  const useProxy = useAppStore((s) => s.settings.useMediaProxy)
  const hlsRef = useRef<Hls | null>(null)
  const [isHls, setIsHls] = useState(false)
  const [isPaused, setIsPaused] = useState(true)

  // URL cuối cùng cho <video>: nếu bật proxy và nguồn là URL (không phải blob), đi qua server
  const src = useAppStore((s) => {
    if (!s.videoUrlForElement) return null
    if (!useProxy) return s.videoUrlForElement
    if (s.videoSource.kind !== 'url') return s.videoUrlForElement
    return `/api/media/proxy?url=${encodeURIComponent(s.videoUrlForElement)}`
  })

  const isBlob = !!src?.startsWith('blob:')

  // 1. Chuyển hướng các lệnh Fullscreen từ thẻ video sang container
  useEffect(() => {
    const video = videoRef.current
    const container = containerRef?.current
    if (!video || !container) return

    const origRequestFullscreen = video.requestFullscreen
    const origWebkit = (video as any).webkitRequestFullscreen

    const requestContainerFullscreen = async function (this: any, options?: FullscreenOptions) {
      if (container.requestFullscreen) {
        return container.requestFullscreen(options)
      } else if ((container as any).webkitRequestFullscreen) {
        return (container as any).webkitRequestFullscreen(options)
      } else if (origRequestFullscreen) {
        return origRequestFullscreen.call(this, options)
      }
    }

    video.requestFullscreen = requestContainerFullscreen
    if (origWebkit) {
      ;(video as any).webkitRequestFullscreen = requestContainerFullscreen
    }

    return () => {
      video.requestFullscreen = origRequestFullscreen
      if (origWebkit) {
        ;(video as any).webkitRequestFullscreen = origWebkit
      }
    }
  }, [videoRef, containerRef])

  // 2. Đồng bộ phụ đề vào Native TextTrack (dự phòng trường hợp thẻ video bị Fullscreen độc lập hoặc trên iPhone)
  useEffect(() => {
    const video = videoRef.current
    if (!video) return

    let track = Array.from(video.textTracks || []).find((t) => t.label === 'LiveSubs')
    if (!track) {
      try {
        track = video.addTextTrack('subtitles', 'LiveSubs', 'vi')
      } catch (e) {
        console.warn('TextTrack init skipped:', e)
      }
    }

    const CueConstructor = window.VTTCue || (window as any).TextTrackCue
    if (!CueConstructor || !track) return

    let active = true
    let rafId: number | null = null

    const syncNativeTrack = () => {
      if (!active || !video || !track) return

      const isNativeFs =
        document.fullscreenElement === video ||
        Boolean((video as any)?.webkitDisplayingFullscreen)

      if (track.mode !== (isNativeFs ? 'showing' : 'hidden')) {
        track.mode = isNativeFs ? 'showing' : 'hidden'
      }

      if (isNativeFs) {
        const st = useAppStore.getState()
        const durationMs = (st.settings.subtitleDurationSec || 8) * 1000
        const t = (video.currentTime || 0) * 1000

        // Lấy câu đã nói gần nhất
        let bestOrig: Cue | null = null
        for (let i = st.cuesOriginal.length - 1; i >= 0; i--) {
          const c = st.cuesOriginal[i]
          const maxEnd = Math.max(c.endMs + 3500, c.startMs + durationMs)
          if (c.startMs - 400 <= t && t <= maxEnd) {
            bestOrig = c
            break
          }
        }
        if (!bestOrig && st.cuesOriginal.length > 0) {
          for (let i = st.cuesOriginal.length - 1; i >= 0; i--) {
            const c = st.cuesOriginal[i]
            if (t >= c.startMs && t - c.startMs <= durationMs) {
              bestOrig = c
              break
            }
          }
        }

        let bestTrans: Cue | null = null
        if (bestOrig) {
          bestTrans =
            st.cuesTranslation.find(
              (c) =>
                Math.abs(c.startMs - bestOrig!.startMs) < 3000 ||
                (c.startMs <= bestOrig!.endMs && c.endMs >= bestOrig!.startMs),
            ) || null
        }

        const lines: string[] = []
        if (st.settings.showOriginal && bestOrig?.text) {
          lines.push(bestOrig.text)
        }
        if (st.settings.showTranslation && st.settings.enableTranslation && bestTrans?.text) {
          lines.push(bestTrans.text)
        }

        const liveOrig = st.interimOriginal.trim()
        const liveTrans = st.interimTranslation.trim()
        if (st.settings.showOriginal && liveOrig) {
          lines.push(`● ${liveOrig}`)
        }
        if (st.settings.showTranslation && st.settings.enableTranslation && liveTrans) {
          lines.push(`● ${liveTrans}`)
        }

        const fullText = lines.join('\n').trim()
        const curCues = track.cues
        const currentCue = curCues && curCues.length > 0 ? (curCues[0] as VTTCue) : null

        if (fullText) {
          const curTimeSec = video.currentTime || 0
          if (!currentCue) {
            const newCue = new CueConstructor(
              Math.max(0, curTimeSec - 1),
              curTimeSec + 12,
              fullText,
            )
            track.addCue(newCue)
          } else {
            if (currentCue.text !== fullText) {
              currentCue.text = fullText
            }
            currentCue.startTime = Math.max(0, curTimeSec - 1)
            currentCue.endTime = curTimeSec + 12
          }
        } else if (currentCue) {
          try {
            track.removeCue(currentCue)
          } catch {}
        }
      }

      rafId = requestAnimationFrame(syncNativeTrack)
    }

    rafId = requestAnimationFrame(syncNativeTrack)

    return () => {
      active = false
      if (rafId) cancelAnimationFrame(rafId)
    }
  }, [videoRef])

  // 3. Quản lý luồng phát HLS / MP4
  useEffect(() => {
    const video = videoRef.current
    if (!video || !src) return

    let cleanup = () => {}

    if (hlsRef.current) {
      hlsRef.current.destroy()
      hlsRef.current = null
    }

    const isHlsUrl = HLS_EXT.test(src)
    if (isHlsUrl && Hls.isSupported()) {
      const hls = new Hls({
        enableWorker: true,
        lowLatencyMode: true,
        backBufferLength: 30,
      })
      hlsRef.current = hls
      hls.loadSource(src)
      hls.attachMedia(video)
      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        setIsHls(true)
        onVideoReady()
      })
      hls.on(Hls.Events.ERROR, (_e, data) => {
        if (data.fatal) {
          onVideoError(`Lỗi HLS: ${data.details}`)
        }
      })
      cleanup = () => {
        hls.destroy()
        if (hlsRef.current === hls) hlsRef.current = null
      }
    } else {
      setIsHls(false)
      const onCanPlay = () => onVideoReady()
      const onErr = () => {
        const err = video.error
        const st = useAppStore.getState()
        if (!useProxy && !isBlob && st.videoSource.kind === 'url') {
          console.warn('Direct video load failed, auto-enabling media proxy...')
          st.patchSettings({ useMediaProxy: true })
          return
        }
        onVideoError(
          err
            ? `Không phát được video (mã ${err.code}). Có thể URL chặn CORS hoặc sai định dạng — thử chọn file local hoặc kiểm tra lại URL.`
            : 'Không phát được video.',
        )
      }
      video.addEventListener('canplay', onCanPlay)
      video.addEventListener('error', onErr)
      video.src = src
      video.load()
      cleanup = () => {
        video.removeEventListener('canplay', onCanPlay)
        video.removeEventListener('error', onErr)
      }
    }

    return cleanup
  }, [src, videoRef, onVideoReady, onVideoError, useProxy, isBlob])

  // 4. Trạng thái tạm dừng
  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    const updatePlayState = () => setIsPaused(video.paused)
    video.addEventListener('play', updatePlayState)
    video.addEventListener('playing', updatePlayState)
    video.addEventListener('pause', updatePlayState)
    video.addEventListener('ended', updatePlayState)
    updatePlayState()
    return () => {
      video.removeEventListener('play', updatePlayState)
      video.removeEventListener('playing', updatePlayState)
      video.removeEventListener('pause', updatePlayState)
      video.removeEventListener('ended', updatePlayState)
    }
  }, [src, videoRef])

  useEffect(() => {
    return () => {
      hlsRef.current?.destroy()
      hlsRef.current = null
    }
  }, [])

  const handlePlayClick = async () => {
    const video = videoRef.current
    if (!video) return
    try {
      await video.play()
    } catch (e) {
      console.warn('Play attempt failed:', e)
    }
  }

  const handleDoubleClick = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('button, input, select')) return
    if (onToggleFullscreen) {
      onToggleFullscreen()
    }
  }

  return (
    <div className="video-shell" onDoubleClick={handleDoubleClick}>
      <video
        ref={videoRef}
        className="video-el"
        playsInline
        autoPlay
        controls
        controlsList="nofullscreen"
        crossOrigin={isBlob ? undefined : 'anonymous'}
        preload="auto"
      >
        <track
          kind="captions"
          label="LiveSubs"
          srcLang="vi"
          src="data:text/vtt,WEBVTT%0A%0A"
          default
        />
      </video>

      {/* Thanh công cụ góc trên player */}
      <div className="video-top-bar">
        <div className="video-top-left">
          {isHls && <span className="badge badge-hls">HLS</span>}
          {isFullscreen && <span className="badge badge-fs">Toàn màn hình</span>}
        </div>
        {onToggleFullscreen && (
          <div className="video-top-right">
            <button
              type="button"
              className="player-btn-fs"
              onClick={onToggleFullscreen}
              title={isFullscreen ? 'Thu nhỏ (F hoặc Esc)' : 'Toàn màn hình (F hoặc đúp chuột)'}
              aria-label={isFullscreen ? 'Thu nhỏ' : 'Toàn màn hình'}
            >
              {isFullscreen ? (
                <>
                  <Minimize size={15} />
                  <span className="fs-btn-label">Thu nhỏ</span>
                </>
              ) : (
                <>
                  <Maximize size={15} />
                  <span className="fs-btn-label">Toàn màn hình</span>
                </>
              )}
            </button>
          </div>
        )}
      </div>

      {/* Nút Toàn màn hình nổi ở góc dưới phải phía trên controls */}
      {onToggleFullscreen && (
        <button
          type="button"
          className="player-floating-fs-btn"
          onClick={onToggleFullscreen}
          title={isFullscreen ? 'Thu nhỏ (F hoặc Esc)' : 'Toàn màn hình (F)'}
          aria-label={isFullscreen ? 'Thu nhỏ' : 'Toàn màn hình'}
        >
          {isFullscreen ? <Minimize size={18} /> : <Maximize size={18} />}
        </button>
      )}

      {isPaused && (
        <button
          className="video-play-overlay"
          onClick={handlePlayClick}
          aria-label="Phát video"
          type="button"
        >
          <div className="play-icon-circle">▶</div>
          <span className="play-overlay-text">Nhấn để phát video</span>
        </button>
      )}
    </div>
  )
}
