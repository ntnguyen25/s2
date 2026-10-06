import { useState } from 'react'
import { useAppStore } from '../store/app.store'

export function UrlInput() {
  const setVideoUrl = useAppStore((s) => s.setVideoUrl)
  const clearVideo = useAppStore((s) => s.clearVideo)
  const videoSource = useAppStore((s) => s.videoSource)
  const [value, setValue] = useState('')

  const apply = () => {
    const v = value.trim()
    if (!v) return
    useAppStore.getState().setError(null)
    setVideoUrl(v)
  }

  return (
    <div className="url-input">
      <div className="url-row">
        <input
          type="url"
          inputMode="url"
          placeholder="Dán URL video (mp4/webm/m3u8)…"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') apply()
          }}
        />
        <button className="btn btn-primary" onClick={apply}>
          Tải
        </button>
        {videoSource.kind !== 'none' && (
          <button className="btn btn-ghost" onClick={clearVideo}>
            Xoá
          </button>
        )}
      </div>
      <div className="url-hint">
        Hỗ trợ: MP4, WebM, HLS (.m3u8). URL cần cho phép CORS hoặc dùng file local.
      </div>
    </div>
  )
}