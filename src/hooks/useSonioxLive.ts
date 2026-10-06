import { useCallback, useEffect, useRef, useState } from 'react'
import type { RefObject } from 'react'
import { useAppStore } from '../store/app.store'
import { VideoAudioCapture, getOrCreateAudioContext } from '../audio/capture'
import { SonioxSession, fetchTemporaryKey } from '../lib/soniox'

type Props = {
  videoRef: RefObject<HTMLVideoElement>
}

export function useSonioxLive({ videoRef }: Props) {
  const settings = useAppStore((s) => s.settings)
  const ingestTokens = useAppStore((s) => s.ingestTokens)
  const setStatus = useAppStore((s) => s.setStatus)
  const setError = useAppStore((s) => s.setError)
  const setCapturing = useAppStore((s) => s.setCapturing)
  const captureRef = useRef<VideoAudioCapture | null>(null)
  const sessionRef = useRef<SonioxSession | null>(null)
  const reconnectTimer = useRef<number | null>(null)
  const seekTimer = useRef<number | null>(null)
  const stoppedRef = useRef(false)
  const [ready, setReady] = useState(false)

  const stop = useCallback(() => {
    stoppedRef.current = true
    if (reconnectTimer.current) {
      clearTimeout(reconnectTimer.current)
      reconnectTimer.current = null
    }
    if (seekTimer.current) {
      clearTimeout(seekTimer.current)
      seekTimer.current = null
    }

    try {
      sessionRef.current?.close()
    } catch {
      // ignore
    }
    sessionRef.current = null

    try {
      captureRef.current?.detach()
    } catch {
      // ignore
    }

    setCapturing(false)
    setStatus('idle', 'Đã dừng.')
    setReady(false)
  }, [setStatus, setCapturing])

  const start = useCallback(async () => {
    stoppedRef.current = false
    setError(null)

    // 1) Quan trọng nhất: Kích hoạt AudioContext & Play video ngay lập tức trong User Gesture
    const ctx = getOrCreateAudioContext()
    if (ctx.state === 'suspended') {
      try {
        await ctx.resume()
      } catch (err) {
        console.warn('AudioContext resume gesture:', err)
      }
    }

    let v = videoRef.current
    if (v && v.paused) {
      try {
        await v.play()
      } catch (playErr) {
        console.warn('Video auto-play deferred:', playErr)
      }
    }

    // Đợi video mount nếu cần
    if (!v) {
      await new Promise<void>((resolve) => {
        let attempts = 0
        const interval = setInterval(() => {
          attempts++
          if (videoRef.current || attempts > 12) {
            clearInterval(interval)
            resolve()
          }
        }, 50)
      })
      v = videoRef.current
    }

    const videoSource = useAppStore.getState().videoSource
    if (!v || videoSource.kind === 'none') {
      setError('Chưa chọn video. Hãy dán URL hoặc chọn file video trước.')
      setStatus('idle')
      return
    }

    // Mốc thời gian bắt đầu phiên nhận diện khớp với thời điểm hiện tại của video
    const timeOffsetMs = Math.max(0, Math.floor((v?.currentTime || 0) * 1000))
    useAppStore.getState().syncVideoTime(timeOffsetMs)

    // Đóng phiên WebSocket cũ nếu còn sót lại
    if (sessionRef.current) {
      try {
        sessionRef.current.close()
      } catch {
        // ignore
      }
      sessionRef.current = null
    }

    // 2) Lấy API key
    let apiKey = ''
    if (settings.useServerKey) {
      setStatus('connecting', 'Lấy temporary key từ server…')
      try {
        const k = await fetchTemporaryKey()
        if (k) apiKey = k
      } catch {
        // fallback
      }
    }
    if (!apiKey) {
      apiKey = settings.apiKeyInput.trim()
    }
    if (!apiKey) {
      setError('Cần Soniox API Key. Nhập ở Cài đặt hoặc đặt SONIOX_API_KEY trong .env server.')
      setStatus('idle')
      return
    }

    if (stoppedRef.current) return

    // 3) Khởi động bộ thu âm video
    setStatus('connecting', 'Chuẩn bị âm thanh…')
    try {
      if (!captureRef.current) {
        captureRef.current = new VideoAudioCapture((pcm16) => {
          sessionRef.current?.sendPcm(pcm16)
        })
      }
      await captureRef.current.attach(v)
    } catch (e) {
      setError(`Không trích xuất được âm thanh: ${String(e)}`)
      setStatus('idle')
      return
    }

    if (stoppedRef.current) {
      captureRef.current?.detach()
      return
    }

    // 4) Mở kết nối WebSocket Soniox
    const isAutoDetect = settings.autoDetectSourceLang
    const hints = isAutoDetect
      ? undefined
      : settings.srcLangHints.length > 0
        ? settings.srcLangHints
        : undefined

    setStatus('connecting', isAutoDetect ? 'Kết nối Soniox (Tự động nhận diện)…' : 'Kết nối Soniox…')
    const session = new SonioxSession(
      {
        apiKey,
        model: 'stt-rt-v5',
        languageHints: hints,
        enableLanguageIdentification: true,
        translation: settings.enableTranslation
          ? { type: 'one_way', target_language: settings.targetLang }
          : null,
        sampleRate: 16000,
        numChannels: 1,
      },
      {
        onOpen: () => {
          if (stoppedRef.current) return
          const currentVideo = videoRef.current
          if (currentVideo && currentVideo.paused) {
            setStatus('live', 'Đang nhận diện (Video đang tạm dừng — Nhấn Play)')
          } else {
            setStatus('live', 'Đang nhận diện…')
          }
          setCapturing(true)
          setReady(true)
        },
        onTokens: (tokens) => {
          // Bù trừ độ lệch thời gian để phụ đề khớp chính xác với video khi bấm Dừng rồi Bắt đầu lại ở giữa video!
          const offsetTokens = tokens.map((t) => ({
            ...t,
            start_ms: t.start_ms != null ? t.start_ms + timeOffsetMs : t.start_ms,
            end_ms: t.end_ms != null ? t.end_ms + timeOffsetMs : t.end_ms,
          }))
          ingestTokens(offsetTokens)
        },
        onError: (msg) => {
          setError(`Soniox: ${msg}`)
        },
        onClose: (code) => {
          if (stoppedRef.current) return
          if (sessionRef.current?.rejected) return
          if (code !== 1000 && code !== 1005) {
            setStatus('connecting', 'Mất kết nối, thử lại…')
            reconnectTimer.current = window.setTimeout(() => {
              if (!stoppedRef.current) start()
            }, 1500)
          }
        },
      },
    )
    sessionRef.current = session
    session.connect()
  }, [videoRef, settings, ingestTokens, setStatus, setError, setCapturing])

  // Lắng nghe sự kiện play/pause của video để đồng bộ status hiển thị
  useEffect(() => {
    const video = videoRef.current
    if (!video) return

    const onPlay = () => {
      const st = useAppStore.getState()
      if (st.status === 'live') {
        st.setStatus('live', 'Đang nhận diện…')
      }
      captureRef.current?.resume()
    }

    const onPause = () => {
      const st = useAppStore.getState()
      if (st.status === 'live') {
        st.setStatus('live', 'Video đang tạm dừng — Nhấn Play để tiếp tục')
      }
    }

    const onSeeking = () => {
      // Khi đang kéo thanh tua, tạm xóa chữ đang phát ra để không bị gián đoạn
      useAppStore.getState().resetInterim()
    }

    const onSeeked = () => {
      useAppStore.getState().resetInterim()
      const st = useAppStore.getState()
      // Nếu đang trong chế độ live hoặc đang bật tạo phụ đề, tự động khởi động lại tại mốc thời gian mới
      if (!stoppedRef.current && (st.status === 'live' || st.status === 'connecting' || ready)) {
        if (seekTimer.current) clearTimeout(seekTimer.current)
        seekTimer.current = window.setTimeout(() => {
          if (!stoppedRef.current) {
            start()
          }
        }, 180)
      }
    }

    video.addEventListener('play', onPlay)
    video.addEventListener('pause', onPause)
    video.addEventListener('seeking', onSeeking)
    video.addEventListener('seeked', onSeeked)
    return () => {
      video.removeEventListener('play', onPlay)
      video.removeEventListener('pause', onPause)
      video.removeEventListener('seeking', onSeeking)
      video.removeEventListener('seeked', onSeeked)
    }
  }, [videoRef, ready, start])

  // Dọn dẹp khi unmount
  useEffect(() => {
    return () => {
      stoppedRef.current = true
      if (seekTimer.current) {
        clearTimeout(seekTimer.current)
        seekTimer.current = null
      }
      sessionRef.current?.close()
      captureRef.current?.detach()
    }
  }, [])

  return { start, stop, ready }
}
