import { useCallback, useEffect, useRef, useState } from 'react'
import { splitSentences } from '../lib/sentences'

const VOICE_STORAGE_KEY = 'ks_voice_uri'
const RATE_STORAGE_KEY = 'ks_speech_rate'
const DEFAULT_RATE = 1

// Apple doesn't expose Siri's actual voice model to web apps — no public API
// lets a website request "the Siri voice" by name. What IS available via the
// standard Web Speech API on Apple platforms: whatever AVSpeechSynthesizer
// voices the OS has installed (Settings/System Settings > Accessibility >
// Spoken Content). Some newer OS versions do list one literally named "Siri" —
// preferred if present, then the best-quality Enhanced/Premium voice, then any
// en-US voice — but the user can always override this via the voice picker.
function autoPickVoice(voices) {
  if (!voices.length) return null
  return (
    voices.find(v => /siri/i.test(v.name)) ||
    voices.find(v => /premium|enhanced/i.test(v.name) && v.lang?.startsWith('en')) ||
    voices.find(v => v.lang === 'en-US') ||
    voices[0]
  )
}

// Narration is spoken one sentence at a time (shared splitSentences). That lets
// pause/resume and speed changes continue from the current sentence instead of
// restarting a whole beat — Safari's native speechSynthesis.pause()/resume() is
// unreliable, especially on iOS, and this app targets Apple devices. A
// generation counter invalidates the onend callbacks of any utterance that's
// been superseded (Safari fires onend on cancel(), which would otherwise
// advance a stale sentence chain).
export function useSpeech() {
  const [speaking, setSpeaking] = useState(false)
  const [sentenceIndex, setSentenceIndex] = useState(0)
  const [canResume, setCanResume] = useState(false)
  const [loadedText, setLoadedText] = useState(null)
  const [voices, setVoices] = useState([])
  const [storedVoiceURI, setStoredVoiceURI] = useState(() => {
    try { return localStorage.getItem(VOICE_STORAGE_KEY) } catch { return null }
  })
  const [rate, setRateState] = useState(() => {
    try { return Number(localStorage.getItem(RATE_STORAGE_KEY)) || DEFAULT_RATE } catch { return DEFAULT_RATE }
  })

  const voiceRef = useRef(null)
  const rateRef = useRef(rate)
  const sentencesRef = useRef([])
  const posRef = useRef(0)
  const doneRef = useRef(null)
  const genRef = useRef(0)
  const supported = typeof window !== 'undefined' && 'speechSynthesis' in window

  useEffect(() => {
    if (!supported) return
    const loadVoices = () => setVoices(window.speechSynthesis.getVoices())
    loadVoices()
    window.speechSynthesis.onvoiceschanged = loadVoices
    return () => { window.speechSynthesis.onvoiceschanged = null }
  }, [supported])

  const effectiveVoice =
    voices.find(v => v.voiceURI === storedVoiceURI) || autoPickVoice(voices) || null
  useEffect(() => { voiceRef.current = effectiveVoice }, [effectiveVoice])

  const selectVoice = useCallback(voiceURI => {
    setStoredVoiceURI(voiceURI)
    try { localStorage.setItem(VOICE_STORAGE_KEY, voiceURI) } catch { /* ignore */ }
  }, [])

  const setRate = useCallback(value => {
    rateRef.current = value
    setRateState(value)
    try { localStorage.setItem(RATE_STORAGE_KEY, String(value)) } catch { /* ignore */ }
  }, [])

  function speakFrom(startIdx, gen) {
    const sentences = sentencesRef.current
    if (startIdx >= sentences.length) {
      setSpeaking(false)
      setCanResume(false)
      const cb = doneRef.current
      doneRef.current = null
      cb?.()
      return
    }
    posRef.current = startIdx
    setSentenceIndex(startIdx)
    setCanResume(startIdx > 0)

    const u = new SpeechSynthesisUtterance(sentences[startIdx])
    if (voiceRef.current) u.voice = voiceRef.current
    u.rate = rateRef.current
    u.onstart = () => { if (gen === genRef.current) setSpeaking(true) }
    u.onerror = () => { if (gen === genRef.current) setSpeaking(false) }
    u.onend = () => {
      if (gen !== genRef.current) return
      posRef.current = startIdx + 1
      speakFrom(startIdx + 1, gen)
    }
    window.speechSynthesis.speak(u)
  }

  // iOS Safari only lets speechSynthesis start from inside a user gesture, and
  // only after a first successful utterance. The real speak() happens a tick
  // later (in an effect), so call this synchronously from the Play tap to
  // unlock it.
  const prime = useCallback(() => {
    if (!supported) return
    try {
      window.speechSynthesis.speak(new SpeechSynthesisUtterance(' '))
      window.speechSynthesis.cancel()
    } catch { /* ignore */ }
  }, [supported])

  // Start a text from the top.
  const speak = useCallback((text, opts = {}) => {
    if (!supported || !text) return
    genRef.current += 1
    window.speechSynthesis.cancel()
    sentencesRef.current = splitSentences(text)
    posRef.current = 0
    doneRef.current = opts.onDone || null
    setLoadedText(text)
    setSentenceIndex(0)
    speakFrom(0, genRef.current)
  }, [supported])

  // Continue the loaded text from the current sentence — after a pause, or a
  // speed change, without losing your place.
  const resume = useCallback((opts = {}) => {
    if (!supported || !sentencesRef.current.length) return
    genRef.current += 1
    window.speechSynthesis.cancel()
    if (opts.onDone) doneRef.current = opts.onDone
    speakFrom(posRef.current, genRef.current)
  }, [supported])

  // Stop but keep the sentence bookmark, so resume() picks up from here.
  const pause = useCallback(() => {
    genRef.current += 1
    if (supported) window.speechSynthesis.cancel()
    setSpeaking(false)
  }, [supported])

  // Full reset — nothing to resume (leaving the lesson, or jumping beats).
  const stop = useCallback(() => {
    genRef.current += 1
    if (supported) window.speechSynthesis.cancel()
    sentencesRef.current = []
    posRef.current = 0
    doneRef.current = null
    setSpeaking(false)
    setCanResume(false)
    setSentenceIndex(0)
    setLoadedText(null)
  }, [supported])

  useEffect(() => stop, [stop]) // fully stop on unmount

  return {
    speak, resume, pause, stop, prime,
    speaking, sentenceIndex, canResume, loadedText,
    supported,
    voices,
    selectedVoiceURI: effectiveVoice?.voiceURI ?? '',
    selectVoice,
    rate, setRate,
  }
}
