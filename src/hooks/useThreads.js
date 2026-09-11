import { useEffect, useState } from 'react'

// A small set of lowercase connector words allowed *inside* a candidate
// phrase (so "Kingdom of Italy" and "Council of Trent" match as one thread,
// not two fragments either side of a lowercase word).
const CONNECTOR = '(?:of|the|and|de|von|van|der|la|le|du)'
const PHRASE_RE = new RegExp(`\\b[A-Z][a-zA-Z'’]+(?:\\s+(?:${CONNECTOR}\\s+)?[A-Z][a-zA-Z'’]+)*\\b`, 'g')

// Common capitalized sentence-starters/pronouns that match the regex above
// but are never a useful thread on their own.
const STOPWORDS = new Set([
  'the', 'a', 'an', 'it', 'its', 'he', 'she', 'they', 'we', 'i', 'this', 'that',
  'these', 'those', 'his', 'her', 'their', 'in', 'on', 'at', 'by', 'for', 'and',
  'but', 'or', 'so', 'then', 'there', 'here', 'what', 'when', 'where', 'why', 'how',
])

// A phrase that only happens to START a sentence with a preposition/article
// ("On Christmas Day...", "After the war...") is a false positive — it isn't
// naming anything, it's just mid-sentence capitalization by coincidence.
const LEADING_STOPWORDS = new Set([
  ...STOPWORDS, 'on', 'with', 'from', 'as', 'after', 'before', 'during', 'into',
  'over', 'under', 'through', 'while', 'since', 'without', 'about', 'across',
])

// Pulls candidate "threads" — proper-noun-ish phrases — out of a beat's body
// text, best guesses first (longer / multi-word phrases are more likely to be
// a real, specific, distinct topic than a single common capitalized word).
function extractCandidates(text, excludeTitle) {
  const seen = new Set()
  const excludeLower = (excludeTitle || '').toLowerCase()
  const candidates = []
  for (const match of text.matchAll(PHRASE_RE)) {
    const phrase = match[0].trim()
    const key = phrase.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    const words = phrase.split(/\s+/)
    if (words.length === 1 && (phrase.length < 4 || STOPWORDS.has(key))) continue
    if (LEADING_STOPWORDS.has(words[0].toLowerCase())) continue
    if (key === excludeLower || excludeLower.includes(key)) continue
    candidates.push(phrase)
  }
  // Longer, multi-word phrases first — they're more likely to name something
  // specific rather than a generic capitalized word mid-sentence.
  return candidates.sort((a, b) => b.length - a.length).slice(0, 6)
}

// Resolved-thread cache is process-lifetime, not per-component — the same
// phrase means the same Wikipedia article for the whole session, and this
// avoids re-fetching every time a beat replays.
const resolvedCache = new Map() // phrase -> {label, wikiTitle, description} | null

function normalizeWords(s) {
  return s.toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/).filter(Boolean)
}

// A redirect can occasionally drift a long way from what was actually typed
// (e.g. a phrase that happens to be a song title redirecting to the artist).
// Requiring at least one shared word between what we searched and what came
// back is a cheap guard against showing a thread chip for something the beat
// never actually mentioned.
function isPlausibleMatch(phrase, resolvedTitle) {
  const wanted = new Set(normalizeWords(phrase))
  return normalizeWords(resolvedTitle).some(w => wanted.has(w))
}

async function resolveCandidate(phrase) {
  if (resolvedCache.has(phrase)) return resolvedCache.get(phrase)
  const result = await fetch(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(phrase)}`)
    .then(res => (res.ok ? res.json() : null))
    .then(data => {
      if (!data || data.type === 'disambiguation') return null
      if (!isPlausibleMatch(phrase, data.title)) return null
      return { label: phrase, wikiTitle: data.title, description: data.description || '' }
    })
    .catch(() => null)
  resolvedCache.set(phrase, result)
  return result
}

// Resolves up to `limit` real, distinct Wikipedia topics mentioned in a
// beat's text — the "pull a thread" chips. Free (Wikipedia REST API, no
// key); resolution happens once per phrase per session thanks to the cache
// above, so replaying a beat costs nothing further.
export function useThreads(text, excludeTitle, limit = 4) {
  const [threads, setThreads] = useState([])

  useEffect(() => {
    let cancelled = false
    // Route the "nothing to do" case through the same .then() as a real
    // lookup, rather than calling setState synchronously in the effect body.
    const lookup = text
      ? Promise.all(extractCandidates(text, excludeTitle).map(resolveCandidate))
      : Promise.resolve([])
    lookup.then(results => {
      if (cancelled) return
      const unique = []
      const seenTitles = new Set()
      for (const r of results) {
        if (!r || seenTitles.has(r.wikiTitle)) continue
        seenTitles.add(r.wikiTitle)
        unique.push(r)
        if (unique.length >= limit) break
      }
      setThreads(unique)
    })
    return () => { cancelled = true }
  }, [text, excludeTitle, limit])

  return threads
}
