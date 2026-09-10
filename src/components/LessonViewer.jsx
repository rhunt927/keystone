import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
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

function Icon({ path, className = 'w-6 h-6' }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden>
      <path d={path} />
    </svg>
  )
}
const ICONS = {
  prev: 'M7 5v14a1 1 0 0 1-2 0V5a1 1 0 0 1 2 0zm12.5-.87L9 11.13a1 1 0 0 0 0 1.74l10.5 7A1 1 0 0 0 21 19V5a1 1 0 0 0-1.5-.87z',
  next: 'M17 5v14a1 1 0 0 0 2 0V5a1 1 0 0 0-2 0zM4.5 4.13A1 1 0 0 0 3 5v14a1 1 0 0 0 1.5.87l10.5-7a1 1 0 0 0 0-1.74l-10.5-7z',
  play: 'M6 4.75a1 1 0 0 1 1.53-.85l12 7.25a1 1 0 0 1 0 1.7l-12 7.25A1 1 0 0 1 6 19.25V4.75z',
  pause: 'M7 4a1 1 0 0 1 1 1v14a1 1 0 0 1-2 0V5a1 1 0 0 1 1-1zm10 0a1 1 0 0 1 1 1v14a1 1 0 0 1-2 0V5a1 1 0 0 1 1-1z',
  replay: 'M12 5V2L8 6l4 4V7a5 5 0 1 1-5 5H5a7 7 0 1 0 7-7z',
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
  const [playing, setPlaying] = useState(false)
  const [ended, setEnded] = useState(false)
  const [showText, setShowText] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const {
    speak, resume, pause, stop, prime, speaking, sentenceIndex, canResume, loadedText,
    supported, voices, selectedVoiceURI, selectVoice, rate, setRate,
  } = useSpeech()
  const touchStartX = useRef(null)
  const { accent } = narratorFor(domain?.slug)

  const card = cards[index]
  // Narrate the beat's body only — the short headline labels ("Twelve ships",
  // "What it was") read as flashcard chapter titles, not narration.
  const narrationText = card?.body || ''
  const sentences = useMemo(() => splitSentences(narrationText), [narrationText])
  const beatText = useCallback(i => cards[i]?.body || '', [cards])

  const visualSpec = useMemo(() => {
    if (!card?.visual_spec) return null
    try { return JSON.parse(card.visual_spec) } catch { return null }
  }, [card])

  const curatedImage = card?.image_url
    ? { url: card.image_url, source_url: card.image_source_url, attribution: card.image_attribution }
    : null
  const useLiveSearch = !visualSpec && !curatedImage
  const activeSentence = useLiveSearch && (playing || speaking) ? sentences[sentenceIndex] : null
  const displayedImage = useSentenceImage(topic.title, activeSentence, curatedImage)
  const visualCredit = visualSpec ? visualAttribution(visualSpec) : null

  const advance = useCallback(() => {
    setIndex(i => {
      if (i >= cards.length - 1) {
        setPlaying(false)
        setEnded(true)
        return i
      }
      return i + 1
    })
  }, [cards.length])

  // playingRef lets the beat-change effect below check "are we playing" without
  // re-running every time `playing` toggles (which would restart, not resume).
  const playingRef = useRef(playing)
  useEffect(() => { playingRef.current = playing }, [playing])

  // When the beat changes while playing, narrate the new beat and auto-advance
  // on finish. The FIRST play is kicked off directly from the tap in
  // handlePlayToggle (iOS needs the first speak() inside a user gesture) — this
  // effect only covers auto-advance and skips.
  useEffect(() => {
    if (!playingRef.current) return
    if (!supported) {
      const t = window.setTimeout(advance, Math.max(4500, narrationText.length * 55))
      return () => window.clearTimeout(t)
    }
    speak(narrationText, { onDone: advance })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index])

  function handlePlayToggle() {
    if (playing) {
      pause()
      setPlaying(false)
      return
    }
    prime() // unlock iOS speech synthesis inside this tap
    if (ended) {
      stop()
      setEnded(false)
      setIndex(0)
      setPlaying(true)
      speak(beatText(0), { onDone: advance })
      return
    }
    setPlaying(true)
    if (canResume && loadedText === narrationText) {
      resume({ onDone: advance })
    } else {
      speak(narrationText, { onDone: advance })
    }
  }

  function goToBeat(i) {
    stop()
    setEnded(false)
    setIndex(Math.max(0, Math.min(cards.length - 1, i)))
    // the [index] effect re-speaks the new beat if we're playing
  }

  function leave() {
    stop()
    setPlaying(false)
    onBack()
  }

  function onTouchStart(e) { touchStartX.current = e.touches[0].clientX }
  function onTouchEnd(e) {
    if (touchStartX.current == null) return
    const dx = e.changedTouches[0].clientX - touchStartX.current
    touchStartX.current = null
    if (dx > 50) goToBeat(index - 1)
    else if (dx < -50) goToBeat(index + 1)
  }

  const cardProgress = sentences.length ? Math.min(sentenceIndex / sentences.length, 1) : 0
  const overallProgress = (index + (ended ? 1 : speaking ? cardProgress : 0)) / cards.length

  function onScrub(e) {
    const rect = e.currentTarget.getBoundingClientRect()
    const ratio = (e.clientX - rect.left) / rect.width
    goToBeat(Math.floor(ratio * cards.length))
  }

  const active = playing || speaking

  return (
    <div className="space-y-3">
      <button onClick={leave} className="text-sm opacity-60 hover:opacity-100">
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
                <img
                  src={displayedImage.url}
                  alt=""
                  aria-hidden
                  className="absolute inset-0 w-full h-full object-cover blur-2xl scale-110 opacity-50"
                />
                <img
                  src={displayedImage.url}
                  alt={topic.title}
                  className={`relative w-full h-full object-contain ${active ? 'ken-burns' : ''}`}
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
              <div className="absolute inset-x-0 bottom-0 p-4 text-white bg-black/45">
                <p className="text-sm leading-relaxed">{card.body}</p>
              </div>
            )}
          </div>

          {card.sources.length > 0 && (
            <div className="text-xs opacity-70 space-x-2 text-center">
              {card.sources.map(s => (
                <a key={s.url} href={s.url} target="_blank" rel="noreferrer" className="underline hover:opacity-100">
                  Source: {s.publisher || s.title}
                </a>
              ))}
            </div>
          )}

          <div className="space-y-1">
            <div
              onClick={onScrub}
              className="h-2 rounded-full bg-[#6B4226]/20 cursor-pointer relative"
              role="progressbar"
              aria-valuenow={Math.round(overallProgress * 100)}
            >
              <div
                className="h-full rounded-full bg-[#6B4226] transition-[width] duration-200"
                style={{ width: `${overallProgress * 100}%` }}
              />
            </div>
            <div className="flex justify-between text-[10px] opacity-50">
              <span>Beat {index + 1} of {cards.length}</span>
              {ended && <span>End — press play to replay</span>}
            </div>
          </div>

          <div className="flex items-center justify-center gap-6">
            <button
              onClick={() => goToBeat(index - 1)}
              disabled={index === 0}
              className="p-2 rounded-full disabled:opacity-25 hover:bg-black/5"
              aria-label="Previous beat"
            >
              <Icon path={ICONS.prev} />
            </button>
            <button
              onClick={handlePlayToggle}
              className="p-3 rounded-full bg-[#6B4226] text-[#F1E4CF] hover:bg-[#59371f]"
              aria-label={playing ? 'Pause' : ended ? 'Replay' : 'Play'}
            >
              <Icon path={ended && !playing ? ICONS.replay : playing ? ICONS.pause : ICONS.play} className="w-7 h-7" />
            </button>
            <button
              onClick={() => goToBeat(index + 1)}
              disabled={index === cards.length - 1}
              className="p-2 rounded-full disabled:opacity-25 hover:bg-black/5"
              aria-label="Next beat"
            >
              <Icon path={ICONS.next} />
            </button>
          </div>

          <div className="flex items-center justify-center gap-4 text-xs">
            <button
              onClick={() => setShowText(s => !s)}
              aria-pressed={showText}
              className={`px-2 py-1 rounded font-medium ${showText ? 'bg-[#6B4226] text-[#F1E4CF]' : 'opacity-60 hover:opacity-100'}`}
            >
              Transcript
            </button>
            {supported && (
              <button
                onClick={() => setShowSettings(s => !s)}
                aria-pressed={showSettings}
                className={`px-2 py-1 rounded font-medium ${showSettings ? 'bg-[#6B4226] text-[#F1E4CF]' : 'opacity-60 hover:opacity-100'}`}
              >
                Voice &amp; speed
              </button>
            )}
          </div>

          {showSettings && voices.length > 0 && (
            <div className="flex flex-col items-center gap-2 pt-1">
              <select
                value={selectedVoiceURI || ''}
                onChange={e => selectVoice(e.target.value)}
                className="text-[11px] bg-transparent opacity-70 hover:opacity-100 max-w-full"
              >
                {voices.filter(v => v.lang?.startsWith('en')).map(v => (
                  <option key={v.voiceURI} value={v.voiceURI}>{v.name} ({v.lang})</option>
                ))}
              </select>
              <div className="flex items-center gap-2">
                <span className="text-[11px] opacity-60">Speed</span>
                <input
                  type="range" min="0.5" max="2" step="0.1" value={rate}
                  onChange={e => { setRate(Number(e.target.value)); if (speaking) resume({ onDone: advance }) }}
                  className="w-32 accent-[#6B4226]"
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
