import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { fetchAudioUrl } from './useGoogleDrive'

// Plays a lesson's pre-generated narration MP3s (from Drive) through a single
// <audio> element. Exposes the shape LessonViewer needs from a playback engine
// so the viewer can use this or the browser speech engine. `ready` is true only
// once every beat's audio has resolved.
export function useAudioLesson(accessToken, cards, rate) {
  const [resolved, setResolved] = useState({ sig: null, urls: [] })
  const [playing, setPlaying] = useState(false)
  const [progress, setProgress] = useState(0)
  const audioRef = useRef(null)
  const doneRef = useRef(null)
  const rateRef = useRef(rate)

  // Lazily create the <audio> element the first time an effect/handler needs it
  // (never during render).
  function getAudio() {
    if (audioRef.current === null && typeof Audio !== 'undefined') {
      audioRef.current = new Audio()
      audioRef.current.preload = 'auto'
    }
    return audioRef.current
  }

  const sig = useMemo(() => cards.map(c => c.audio_path || '').join('|'), [cards])

  useEffect(() => {
    const paths = sig.split('|')
    if (!accessToken || paths.length === 0 || paths.some(p => !p)) return
    let cancelled = false
    Promise.all(paths.map(p => fetchAudioUrl(accessToken, p).catch(() => null))).then(urls => {
      if (!cancelled) setResolved({ sig, urls })
    })
    return () => { cancelled = true }
  }, [accessToken, sig])

  const ready = resolved.sig === sig && resolved.urls.length > 0 && resolved.urls.every(Boolean)
  const urls = ready ? resolved.urls : []

  useEffect(() => {
    const a = getAudio()
    if (!a) return
    const onTime = () => setProgress(a.duration ? a.currentTime / a.duration : 0)
    const onEnd = () => {
      setPlaying(false)
      const cb = doneRef.current
      doneRef.current = null
      cb?.()
    }
    const onPlay = () => setPlaying(true)
    const onPause = () => setPlaying(false)
    a.addEventListener('timeupdate', onTime)
    a.addEventListener('ended', onEnd)
    a.addEventListener('play', onPlay)
    a.addEventListener('pause', onPause)
    return () => {
      a.removeEventListener('timeupdate', onTime)
      a.removeEventListener('ended', onEnd)
      a.removeEventListener('play', onPlay)
      a.removeEventListener('pause', onPause)
    }
  }, [])

  useEffect(() => {
    rateRef.current = rate
    const a = audioRef.current
    if (a) a.playbackRate = rate
  }, [rate])

  const start = useCallback((i, { onDone } = {}) => {
    const a = getAudio()
    if (!a || !urls[i]) return
    doneRef.current = onDone || null
    a.src = urls[i]
    a.playbackRate = rateRef.current
    a.currentTime = 0
    a.play().catch(() => {})
  }, [urls])

  const resume = useCallback(({ onDone } = {}) => {
    if (onDone) doneRef.current = onDone
    getAudio()?.play().catch(() => {})
  }, [])

  const pause = useCallback(() => { audioRef.current?.pause() }, [])

  const stop = useCallback(() => {
    const a = audioRef.current
    if (!a) return
    a.pause()
    try { a.currentTime = 0 } catch { /* not seekable yet */ }
    doneRef.current = null
    setProgress(0)
  }, [])

  const seek = useCallback(f => {
    const a = audioRef.current
    if (a?.duration) a.currentTime = Math.max(0, Math.min(1, f)) * a.duration
  }, [])

  return {
    ready,
    engine: {
      playing,
      progress,
      canResume: progress > 0.01 && progress < 0.99 && !playing,
      start, resume, pause, stop, seek,
    },
  }
}
