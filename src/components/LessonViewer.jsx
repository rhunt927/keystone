import { useEffect, useMemo, useRef, useState } from 'react'
import { useSpeech } from '../hooks/useSpeech'
import { useSentenceImage } from '../hooks/useSentenceImage'
import { splitSentences } from '../lib/sentences'
import { narratorFor } from '../lib/narrators'
import { VisualCard } from './VisualCard'

function visualAttribution(spec) {
  if (spec?.type === 'spread-map' && spec.attribution) {
    return { text: `Map: ${spec.attribution}`, href: spec.source_url || spec.image }
  }
  return null
}

function Equalizer({ active }) {
  return (
    <div className="flex items-end gap-0.5 h-4">
      {[0, 1, 2, 3].map(i => (
        <span
          key={i}
          className={`w-1 rounded-full bg-[#F1E4CF] ${active ? 'eq-bar' : ''}`}
          style={active ? { animationDelay: `${i * 0.12}s` } : { height: '4px' }}
        />
      ))}
    </div>
  )
}

export function LessonViewer({ topic, domain, lessonTitle, cards, onBack }) {
  const [index, setIndex] = useState(0)
  const [showText, setShowText] = useState(false)
  const {
    speak, resume, pause, stop, speaking, sentenceIndex, canResume,
    supported, voices, selectedVoiceURI, selectVoice, rate, setRate,
  } = useSpeech()
  const touchStartX = useRef(null)
  const { accent } = narratorFor(domain?.slug)

  const card = cards[index]
  const narrationText = useMemo(
    () => [card?.headline, card?.body].filter(Boolean).join('. '),
    [card]
  )
  const sentences = useMemo(() => splitSentences(narrationText), [narrationText])

  const visualSpec = useMemo(() => {
    if (!card?.visual_spec) return null
    try { return JSON.parse(card.visual_spec) } catch { return null }
  }, [card])

  const curatedImage = card?.image_url
    ? { url: card.image_url, source_url: card.image_source_url, attribution: card.image_attribution }
    : null
  // Per-sentence live Commons search is only a fallback for auto-generated
  // lessons that have no curated image and no motion graphic — authored
  // lessons ship a hand-picked image per beat and skip the search entirely.
  const useLiveSearch = !visualSpec && !curatedImage
  const activeSentence = useLiveSearch && speaking ? sentences[sentenceIndex] : null
  const displayedImage = useSentenceImage(topic.title, activeSentence, curatedImage)
  const visualCredit = visualSpec ? visualAttribution(visualSpec) : null

  // Stop any narration in flight whenever the card changes or the viewer unmounts.
  useEffect(() => stop, [index, stop])

  function goTo(next) {
    stop()
    setIndex(Math.max(0, Math.min(cards.length - 1, next)))
  }

  function handlePlayPause() {
    if (speaking) {
      pause()
    } else if (canResume) {
      resume()
    } else {
      speak(narrationText)
    }
  }

  function handleRateChange(value) {
    setRate(value)
    // The Web Speech API can't change an utterance's rate mid-sentence —
    // resume() re-speaks from the current sentence (not the whole card) at
    // the new rate, so a change doesn't throw away narration progress.
    if (speaking) resume()
  }

  function onTouchStart(e) {
    touchStartX.current = e.touches[0].clientX
  }
  function onTouchEnd(e) {
    if (touchStartX.current == null) return
    const dx = e.changedTouches[0].clientX - touchStartX.current
    touchStartX.current = null
    if (dx > 50) goTo(index - 1)
    else if (dx < -50) goTo(index + 1)
  }

  return (
    <div className="space-y-4">
      <button onClick={onBack} className="text-sm opacity-60 hover:opacity-100">
        ← Topics
      </button>
      <h1 className="text-2xl font-serif">{lessonTitle || topic.title}</h1>

      {cards.length === 0 ? (
        <p className="text-sm opacity-70">No cards yet for this lesson.</p>
      ) : (
        <div onTouchStart={onTouchStart} onTouchEnd={onTouchEnd} className="space-y-3">
          <div
            key={`${card.id}-${visualSpec ? 'visual' : displayedImage?.url ?? 'none'}`}
            className="card-in relative rounded-xl overflow-hidden aspect-[4/5] bg-[#1c130c]"
          >
            {visualSpec ? (
              <VisualCard spec={visualSpec} />
            ) : displayedImage ? (
              <>
                {/* Blurred fill so wide paintings aren't cropped to unrecognizable */}
                <img
                  src={displayedImage.url}
                  alt=""
                  aria-hidden
                  className="absolute inset-0 w-full h-full object-cover blur-2xl scale-110 opacity-50"
                />
                <img
                  src={displayedImage.url}
                  alt={card.headline || topic.title}
                  className={`relative w-full h-full object-contain ${speaking ? 'ken-burns' : ''}`}
                />
              </>
            ) : (
              <div
                className="w-full h-full flex items-center justify-center text-center px-6 text-sm opacity-60"
                style={{ background: `${accent}33` }}
              >
                {topic.title}
              </div>
            )}

            <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/5 to-transparent pointer-events-none" />

            <div className="absolute top-3 right-3">
              <Equalizer active={speaking} />
            </div>

            {(displayedImage || visualCredit) && (
              <a
                href={visualCredit?.href || displayedImage.source_url || displayedImage.url}
                target="_blank"
                rel="noreferrer"
                className="absolute bottom-2 right-2 text-[10px] text-white/70 hover:text-white underline"
              >
                {visualCredit?.text || `Photo: ${displayedImage.attribution || 'Wikimedia Commons'}`}
              </a>
            )}

            {showText && (
              <div className="absolute inset-x-0 bottom-0 p-4 text-white space-y-1 bg-black/40">
                {card.headline && <h2 className="font-medium">{card.headline}</h2>}
                <p className="text-sm leading-relaxed">{card.body}</p>
              </div>
            )}
          </div>

          {card.sources.length > 0 && (
            <div className="text-xs opacity-70 space-x-2 text-center">
              {card.sources.map(s => (
                <a
                  key={s.url}
                  href={s.url}
                  target="_blank"
                  rel="noreferrer"
                  className="underline hover:opacity-100"
                >
                  Source: {s.publisher || s.title}
                </a>
              ))}
            </div>
          )}

          <div className="flex items-center justify-center gap-3">
            <button
              onClick={() => goTo(index - 1)}
              disabled={index === 0}
              className="px-3 py-2 rounded-lg bg-white/40 hover:bg-white/60 disabled:opacity-30 transition-colors"
              aria-label="Previous card"
            >
              ←
            </button>
            {supported && (
              <button
                onClick={handlePlayPause}
                className="px-5 py-2 rounded-lg bg-[#6B4226] hover:bg-[#59371f] text-[#F1E4CF] font-medium transition-colors"
              >
                {speaking ? '⏸ Pause' : canResume ? '▶ Resume' : '▶ Play'}
              </button>
            )}
            <button
              onClick={() => setShowText(s => !s)}
              aria-pressed={showText}
              className={`px-3 py-2 rounded-lg text-xs font-medium transition-colors ${
                showText ? 'bg-[#6B4226] text-[#F1E4CF]' : 'bg-white/40 hover:bg-white/60'
              }`}
            >
              Aa
            </button>
            <button
              onClick={() => goTo(index + 1)}
              disabled={index === cards.length - 1}
              className="px-3 py-2 rounded-lg bg-white/40 hover:bg-white/60 disabled:opacity-30 transition-colors"
              aria-label="Next card"
            >
              →
            </button>
          </div>

          <div className="flex justify-center gap-1.5">
            {cards.map((_, i) => (
              <span
                key={i}
                className={`h-1.5 rounded-full transition-all ${
                  i === index ? 'w-4 bg-[#6B4226]' : 'w-1.5 bg-[#6B4226]/30'
                }`}
              />
            ))}
          </div>

          {voices.length > 0 && (
            <div className="flex flex-col items-center gap-2">
              <select
                value={selectedVoiceURI || ''}
                onChange={e => selectVoice(e.target.value)}
                className="text-[11px] bg-transparent opacity-60 hover:opacity-100 max-w-full"
              >
                {voices
                  .filter(v => v.lang?.startsWith('en'))
                  .map(v => (
                    <option key={v.voiceURI} value={v.voiceURI}>
                      {v.name} ({v.lang})
                    </option>
                  ))}
              </select>

              <div className="flex items-center gap-2">
                <span className="text-[11px] opacity-60">Speed</span>
                <input
                  type="range"
                  min="0.5"
                  max="2"
                  step="0.1"
                  value={rate}
                  onChange={e => handleRateChange(Number(e.target.value))}
                  className="w-28 accent-[#6B4226]"
                  aria-label="Narration speed"
                />
                <span className="text-[11px] opacity-60 w-8 tabular-nums">{rate.toFixed(1)}x</span>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
