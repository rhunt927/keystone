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

// Sentences are chunked (via the shared splitSentences) so "pause" and "change
// speed" can resume from roughly where playback was, rather than restarting
// the whole card. Safari's native speechSynthesis.pause()/resume() is well
// known to be unreliable (it can silently fail to resume, especially on iOS)
// — since this app targets Apple devices specifically, tracking our own
// sentence position and re-speaking from there is the more robust approach,
// not a WebKit-specific workaround. The same split also drives per-sentence
// image matching (useSentenceImage) via the exposed `sentenceIndex`.
export function useSpeech() {
  const [speaking, setSpeaking] = useState(false)
  const [voices, setVoices] = useState([])
  const [storedVoiceURI, setStoredVoiceURI] = useState(() => {
    try { return localStorage.getItem(VOICE_STORAGE_KEY) } catch { return null }
  })
  const [rate, setRateState] = useState(() => {
    try { return Number(localStorage.getItem(RATE_STORAGE_KEY)) || DEFAULT_RATE } catch { return DEFAULT_RATE }
  })
  const voiceRef = useRef(null)
  // Kept in sync exclusively via setRate (below) — a plain render-time write
  // like `rateRef.current = rate` is itself an anti-pattern React now flags.
  const rateRef = useRef(rate)
  const sentencesRef = useRef([])
  const sentenceIndexRef = useRef(0)
  const currentTextRef = useRef(null)
  // Reactive mirror of sentenceIndexRef — consumers (like useSentenceImage)
  // need to re-render as narration progresses; the ref alone is silent.
  const [sentenceIndex, setSentenceIndex] = useState(0)
  const supported = typeof window !== 'undefined' && 'speechSynthesis' in window

  useEffect(() => {
    if (!supported) return
    function loadVoices() {
      setVoices(window.speechSynthesis.getVoices())
    }
    loadVoices()
    // Safari loads voices asynchronously — this fires once they're ready.
    window.speechSynthesis.onvoiceschanged = loadVoices
    return () => { window.speechSynthesis.onvoiceschanged = null }
  }, [supported])

  // Derived each render, not stored in state — the user's saved choice if it's
  // still available, otherwise the best auto-pick. Keeping this out of state
  // avoids a setState-during-effect just to mirror a value computable directly.
  const effectiveVoice =
    voices.find(v => v.voiceURI === storedVoiceURI) || autoPickVoice(voices) || null

  useEffect(() => {
    voiceRef.current = effectiveVoice
  }, [effectiveVoice])

  const selectVoice = useCallback(voiceURI => {
    setStoredVoiceURI(voiceURI)
    try { localStorage.setItem(VOICE_STORAGE_KEY, voiceURI) } catch { /* ignore */ }
  }, [])

  const setRate = useCallback(value => {
    rateRef.current = value // sync immediately — a caller may speak() in the same tick
    setRateState(value)
    try { localStorage.setItem(RATE_STORAGE_KEY, String(value)) } catch { /* ignore */ }
  }, [])

  function speakFrom(idx) {
    const sentences = sentencesRef.current
    if (idx >= sentences.length) {
      setSpeaking(false)
      return
    }
    const utterance = new SpeechSynthesisUtterance(sentences[idx])
    if (voiceRef.current) utterance.voice = voiceRef.current
    utterance.rate = rateRef.current
    utterance.onstart = () => {
      setSpeaking(true)
      setSentenceIndex(idx)
    }
    utterance.onerror = () => setSpeaking(false)
    utterance.onend = () => {
      sentenceIndexRef.current = idx + 1
      speakFrom(sentenceIndexRef.current)
    }
    window.speechSynthesis.speak(utterance)
  }

  // Starts a new card from the top. To continue an already-paused card instead,
  // use `resume()`.
  const speak = useCallback(text => {
    if (!supported || !text) return
    window.speechSynthesis.cancel()
    sentencesRef.current = splitSentences(text)
    sentenceIndexRef.current = 0
    currentTextRef.current = text
    speakFrom(0)
  }, [supported])

  // Continues from the current sentence — used after a pause, or after a
  // speed change so the new rate takes effect without losing your place.
  const resume = useCallback(() => {
    if (!supported || !currentTextRef.current) return
    window.speechSynthesis.cancel()
    speakFrom(sentenceIndexRef.current)
  }, [supported])

  // Stops speaking but remembers the sentence position, so `resume()` picks
  // back up from here rather than the top of the card.
  const pause = useCallback(() => {
    if (supported) window.speechSynthesis.cancel()
    setSpeaking(false)
  }, [supported])

  // Fully resets — used when switching cards, since there's nothing to resume.
  const stop = useCallback(() => {
    if (supported) window.speechSynthesis.cancel()
    sentencesRef.current = []
    sentenceIndexRef.current = 0
    currentTextRef.current = null
    setSpeaking(false)
    setSentenceIndex(0)
  }, [supported])

  useEffect(() => stop, [stop]) // fully stop narration on unmount

  return {
    speak,
    resume,
    pause,
    stop,
    speaking,
    sentenceIndex,
    canResume: sentenceIndexRef.current > 0 && sentenceIndexRef.current < sentencesRef.current.length,
    supported,
    voices,
    selectedVoiceURI: effectiveVoice?.voiceURI ?? '',
    selectVoice,
    rate,
    setRate,
  }
}
