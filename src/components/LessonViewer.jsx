import { useEffect, useRef, useState } from 'react'
import { useSpeech } from '../hooks/useSpeech'
import { narratorFor } from '../lib/narrators'

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
  const { speak, stop, speaking, supported, voiceName } = useSpeech()
  const touchStartX = useRef(null)
  const { accent } = narratorFor(domain?.slug)

  const card = cards[index]

  // Stop any narration in flight whenever the card changes or the viewer unmounts.
  useEffect(() => stop, [index, stop])

  function goTo(next) {
    stop()
    setIndex(Math.max(0, Math.min(cards.length - 1, next)))
  }

  function handlePlayPause() {
    if (speaking) {
      stop()
      return
    }
    if (!card) return
    speak([card.headline, card.body].filter(Boolean).join('. '))
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
          <div key={card.id} className="card-in relative rounded-xl overflow-hidden aspect-[4/5] bg-black/10">
            {card.image_url ? (
              <img
                src={card.image_url}
                alt={card.headline || topic.title}
                className={`w-full h-full object-cover ${speaking ? 'ken-burns' : ''}`}
              />
            ) : (
              <div
                className="w-full h-full flex items-center justify-center text-center px-6 text-sm opacity-60"
                style={{ background: `${accent}33` }}
              >
                {topic.title}
              </div>
            )}

            <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/5 to-transparent" />

            <div className="absolute top-3 right-3">
              <Equalizer active={speaking} />
            </div>

            {card.image_url && (
              <a
                href={card.image_source_url || card.image_url}
                target="_blank"
                rel="noreferrer"
                className="absolute bottom-2 right-2 text-[10px] text-white/70 hover:text-white underline"
              >
                Photo: {card.image_attribution || 'Wikimedia Commons'}
              </a>
            )}

            {showText && (
              <div className="absolute inset-x-0 bottom-0 p-4 text-white space-y-1">
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
                {speaking ? '⏸ Stop' : '▶ Play'}
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

          {voiceName && <p className="text-center text-[10px] opacity-40">Voice: {voiceName}</p>}
        </div>
      )}
    </div>
  )
}
