import { useCallback, useEffect, useState } from 'react'

// Browser-native text-to-speech (Web Speech API) — zero cost, no API key,
// works offline once the page has loaded. Voice quality is whatever the OS
// provides (more robotic than a produced voiceover), but it's free and it can
// only ever say the actual sourced text passed to it, never invented lines.
export function useSpeech() {
  const [speaking, setSpeaking] = useState(false)
  const supported = typeof window !== 'undefined' && 'speechSynthesis' in window

  const speak = useCallback(text => {
    if (!supported || !text) return
    window.speechSynthesis.cancel() // stop any previous utterance first
    const utterance = new SpeechSynthesisUtterance(text)
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

  return { speak, stop, speaking, supported }
}
