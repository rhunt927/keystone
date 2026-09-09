import { useCallback, useEffect, useRef, useState } from 'react'

// Apple doesn't expose Siri's actual voice model to web apps — no public API
// lets a website request "the Siri voice" by name. What IS available via the
// standard Web Speech API on Apple platforms: whatever AVSpeechSynthesizer
// voices the OS has installed. Some newer OS versions do list one literally
// named "Siri" among them — use it if present, otherwise fall back to the
// best-quality Enhanced/Premium Apple voice available, then any en-US voice.
function pickVoice(voices) {
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
  const [voiceName, setVoiceName] = useState(null)
  const voiceRef = useRef(null)
  const supported = typeof window !== 'undefined' && 'speechSynthesis' in window

  useEffect(() => {
    if (!supported) return
    function loadVoices() {
      const chosen = pickVoice(window.speechSynthesis.getVoices())
      voiceRef.current = chosen
      setVoiceName(chosen?.name ?? null)
    }
    loadVoices()
    // Safari loads voices asynchronously — this fires once they're ready.
    window.speechSynthesis.onvoiceschanged = loadVoices
    return () => { window.speechSynthesis.onvoiceschanged = null }
  }, [supported])

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

  return { speak, stop, speaking, supported, voiceName }
}
