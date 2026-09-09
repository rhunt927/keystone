import { useCallback, useEffect, useRef, useState } from 'react'

const VOICE_STORAGE_KEY = 'ks_voice_uri'

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

export function useSpeech() {
  const [speaking, setSpeaking] = useState(false)
  const [voices, setVoices] = useState([])
  const [storedVoiceURI, setStoredVoiceURI] = useState(() => {
    try { return localStorage.getItem(VOICE_STORAGE_KEY) } catch { return null }
  })
  const voiceRef = useRef(null)
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

  const speak = useCallback(text => {
    if (!supported || !text) return
    window.speechSynthesis.cancel() // stop any previous utterance first
    const utterance = new SpeechSynthesisUtterance(text)
    if (voiceRef.current) utterance.voice = voiceRef.current
    utterance.onstart = () => setSpeaking(true)
    utterance.onend = () => setSpeaking(false)
    utterance.onerror = () => setSpeaking(false)
    window.speechSynthesis.speak(utterance)
  }, [supported])

  const stop = useCallback(() => {
    if (supported) window.speechSynthesis.cancel()
    setSpeaking(false)
  }, [supported])

  useEffect(() => stop, [stop]) // stop narration on unmount

  return {
    speak,
    stop,
    speaking,
    supported,
    voices,
    selectedVoiceURI: effectiveVoice?.voiceURI ?? '',
    selectVoice,
  }
}
