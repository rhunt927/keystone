import { useEffect, useRef, useState } from 'react'

// Common nouns that tend to have a specific, findable photo on Commons but
// aren't proper nouns themselves (a sentence about "a bust was placed in the
// Capitol" needs both words to find the right image).
const OBJECT_WORDS = [
  'statue', 'bust', 'memorial', 'monument', 'plaque', 'museum', 'stamp', 'medal',
  'mural', 'portrait', 'building', 'library', 'funeral', 'casket', 'courthouse',
  'jail', 'mugshot', 'fingerprint', 'trial', 'ceremony', 'congress', 'capitol',
  'march', 'protest', 'boycott', 'bus', 'award', 'honor', 'induct', 'unveil',
]

function extractQuery(topicTitle, sentence) {
  const properNouns = sentence.match(/\b[A-Z][a-zA-Z]*(?:\s+[A-Z][a-zA-Z]*)*\b/g) || []
  const objectHits = OBJECT_WORDS.filter(w => new RegExp(`\\b${w}`, 'i').test(sentence))
  const terms = [...new Set([...properNouns, ...objectHits])].slice(0, 6)
  return [topicTitle, ...terms].join(' ')
}

function stripHtml(html) {
  return (html || '').replace(/<[^>]+>/g, '').trim()
}

// Live, client-side Commons search (free, no key — MediaWiki's action API
// supports cross-origin requests via `origin=*`) scoped to what a SPECIFIC
// sentence is actually about, rather than one fixed image for the whole card.
async function searchCommonsImage(query) {
  const searchRes = await fetch(
    `https://commons.wikimedia.org/w/api.php?action=query&list=search&srnamespace=6&srsearch=${encodeURIComponent(query)}&srlimit=6&format=json&origin=*`
  )
  const searchData = await searchRes.json()
  const candidates = (searchData.query?.search || [])
    .map(r => r.title)
    .filter(t => /\.(jpe?g|png)$/i.test(t))

  for (const fileTitle of candidates) {
    const infoRes = await fetch(
      `https://commons.wikimedia.org/w/api.php?action=query&titles=${encodeURIComponent(fileTitle)}&prop=imageinfo&iiprop=extmetadata%7Curl%7Csize&format=json&origin=*`
    )
    const infoData = await infoRes.json()
    const info = Object.values(infoData.query?.pages || {})[0]?.imageinfo?.[0]
    if (info?.url && info.width >= 200) {
      const meta = info.extmetadata || {}
      return {
        url: info.url,
        source_url: info.descriptionurl || info.url,
        attribution: stripHtml(meta.Artist?.value) || stripHtml(meta.Credit?.value) || 'Wikimedia Commons',
      }
    }
  }
  return null
}

// Returns the best image for `sentence` — searched live and cached per
// sentence text — falling back to `fallbackImage` (the card's stored image)
// while a search is in flight or if nothing usable turns up. Pass `null` for
// `sentence` to just show the fallback without searching (e.g. when paused).
export function useSentenceImage(topicTitle, sentence, fallbackImage) {
  const [image, setImage] = useState(fallbackImage)
  const cacheRef = useRef(new Map())

  useEffect(() => {
    if (!sentence) return // render below falls back without needing a search
    let cancelled = false
    const cache = cacheRef.current
    // Route a cache hit through the same .then() as a fresh search (rather
    // than setState synchronously at the top of the effect) so there's only
    // ever one, consistently-async place this hook updates state from.
    const lookup = cache.has(sentence)
      ? Promise.resolve(cache.get(sentence))
      : searchCommonsImage(extractQuery(topicTitle, sentence)).then(result => {
          cache.set(sentence, result)
          return result
        })
    lookup.then(result => {
      if (!cancelled) setImage(result || fallbackImage)
    })
    return () => { cancelled = true }
  }, [topicTitle, sentence, fallbackImage])

  return sentence ? image : fallbackImage
}
