import { useEffect, useRef, useState } from 'react'
import { useSpeech } from '../hooks/useSpeech'
import { Narrator } from './Narrator'

export function LessonViewer({ topic, domain, lessonTitle, cards, onBack }) {
  const [index, setIndex] = useState(0)
  const { speak, stop, speaking, supported } = useSpeech()
  const touchStartX = useRef(null)

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
        <div onTouchStart={onTouchStart} onTouchEnd={onTouchEnd} className="space-y-4">
          <div className="flex justify-center">
            <Narrator domainSlug={domain?.slug} speaking={speaking} />
          </div>

          <article key={card.id} className="card-in rounded-xl bg-white/50 px-4 py-4 space-y-2 min-h-[9rem]">
            {card.headline && <h2 className="font-medium">{card.headline}</h2>}
            <p className="text-sm leading-relaxed">{card.body}</p>
            {card.sources.length > 0 && (
              <div className="pt-1 border-t border-black/10 text-xs opacity-70 space-x-2">
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
          </article>

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
        </div>
      )}
    </div>
  )
}
