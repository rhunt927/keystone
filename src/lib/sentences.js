// Shared between useSpeech (what's being spoken) and useSentenceImage (what's
// shown) so their indices always line up against the exact same split.
export function splitSentences(text) {
  if (!text) return []
  const matches = text.match(/[^.!?]+[.!?]+[\])'"]*\s*|[^.!?]+$/g)
  return matches ? matches.map(s => s.trim()).filter(Boolean) : [text]
}
