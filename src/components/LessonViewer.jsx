import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSpeech } from '../hooks/useSpeech'
import { useAudioLesson } from '../hooks/useAudioLesson'
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

export function LessonViewer({
  topic, domain, lessonTitle, audioSlug, cards, accessToken, onBack, backLabel, onOpenThread,
}) {
  const [index, setIndex] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [ended, setEnded] = useState(false)
  const [showText, setShowText] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const {
    speak, resume, pause, stop, speaking, sentenceIndex, canResume, loadedText,
    supported, voices, voiceName, selectedVoiceURI, selectVoice, refreshVoices, rate, setRate,
  } = useSpeech()
  const { ready: audioReady, engine: audio } = useAudioLesson(accessToken, audioSlug || topic.slug, cards.length, rate)
  const touchStartX = useRef(null)
  const { accent } = narratorFor(domain?.slug)

  const card = cards[index]
  const narrationText = card?.body || ''
  const sentences = useMemo(() => splitSentences(narrationText), [narrationText])
  const beatText = useCallback(i => cards[i]?.body || '', [cards])

  // If every beat has pre-generated audio, play that (studio voice, consistent
  // everywhere). Otherwise fall back to the browser's speech synthesis.
  const audioMode = audioReady

  const visualSpec = useMemo(() => {
    if (!card?.visual_spec) return null
    try { return JSON.parse(card.visual_spec) } catch { return null }
  }, [card])

  // Hand-picked at authoring time (see thread_refs in schema.sql) — every
  // entry here already points at a real, finished lesson or topic. Never a
  // live search, never a "not built yet" placeholder.
  const threads = useMemo(() => {
    if (!card?.thread_refs) return []
    try { return JSON.parse(card.thread_refs) } catch { return [] }
  }, [card])

  const curatedImage = card?.image_url
    ? { url: card.image_url, source_url: card.image_source_url, attribution: card.image_attribution }
    : null
  const useLiveSearch = !visualSpec && !curatedImage
  const activeSentence = useLiveSearch && !audioMode && (playing || speaking) ? sentences[sentenceIndex] : null
  const displayedImage = useSentenceImage(topic.title, activeSentence, curatedImage)
  const visualCredit = visualSpec ? visualAttribution(visualSpec) : null

  // Unified engine surface
  const enginePlaying = audioMode ? audio.playing : speaking
  const engineCanResume = audioMode
    ? audio.canResume
    : canResume && loadedText === narrationText
  const beatProgress = audioMode
    ? audio.progress
    : speaking && sentences.length
      ? Math.min(sentenceIndex / sentences.length, 1)
      : 0

  const startBeat = useCallback((i, onDone) => {
    if (audioMode) audio.start(i, { onDone })
    else speak(beatText(i), { onDone })
  }, [audioMode, audio, speak, beatText])

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

  const playingRef = useRef(playing)
  useEffect(() => { playingRef.current = playing }, [playing])

  // Beat-change effect: narrate the new beat and auto-advance on finish. The
  // first play is kicked off from the tap in handlePlayToggle; this covers
  // auto-advance and skips.
  useEffect(() => {
    if (!playingRef.current) return
    if (!audioMode && !supported) {
      const t = window.setTimeout(advance, Math.max(4500, narrationText.length * 55))
      return () => window.clearTimeout(t)
    }
    startBeat(index, advance)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, audioMode])

  function handlePlayToggle() {
    if (playing) {
      audioMode ? audio.pause() : pause()
      setPlaying(false)
      return
    }
    if (ended) {
      audioMode ? audio.stop() : stop()
      setEnded(false)
      setIndex(0)
      setPlaying(true)
      startBeat(0, advance)
      return
    }
    setPlaying(true)
    if (engineCanResume) {
      audioMode ? audio.resume({ onDone: advance }) : resume({ onDone: advance })
    } else {
      startBeat(index, advance)
    }
  }

  function goToBeat(i) {
    audioMode ? audio.stop() : stop()
    setEnded(false)
    setIndex(Math.max(0, Math.min(cards.length - 1, i)))
  }

  function leave() {
    audio.stop()
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

  const overallProgress = (index + (ended ? 1 : beatProgress)) / cards.length

  function onScrub(e) {
    const rect = e.currentTarget.getBoundingClientRect()
    const ratio = (e.clientX - rect.left) / rect.width
    goToBeat(Math.floor(ratio * cards.length))
  }

  const active = playing || enginePlaying

  return (
    <div className="space-y-3">
      <button onClick={leave} className="text-sm opacity-60 hover:opacity-100">
        ← {backLabel || 'Topics'}
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
              <Equalizer active={enginePlaying} />
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

          {onOpenThread && threads.length > 0 && (
            <div className="flex flex-wrap items-center justify-center gap-1.5">
              <span className="text-[10px] opacity-40">Pull a thread:</span>
              {threads.map(t => (
                <button
                  key={t.lesson_slug || t.topic_slug}
                  onClick={() => { audio.stop(); stop(); setPlaying(false); onOpenThread(t) }}
                  className="text-xs rounded-full bg-[#6B4226]/10 hover:bg-[#6B4226]/20 px-3 py-1 font-medium"
                >
                  🧵 {t.label}
                </button>
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
            <div className="text-center text-[10px] opacity-40">
              {audioMode
                ? 'narration: studio audio'
                : supported
                  ? `voice: ${voiceName || 'default'}${speaking ? ` · ${sentenceIndex + 1}/${sentences.length}` : ''}`
                  : 'speech synthesis not available'}
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
            {(supported || audioMode) && (
              <button
                onClick={() => { refreshVoices(); setShowSettings(s => !s) }}
                aria-pressed={showSettings}
                className={`px-2 py-1 rounded font-medium ${showSettings ? 'bg-[#6B4226] text-[#F1E4CF]' : 'opacity-60 hover:opacity-100'}`}
              >
                {audioMode ? 'Speed' : 'Voice & speed'}
              </button>
            )}
          </div>

          {showSettings && (
            <div className="flex flex-col items-center gap-2 pt-1">
              {!audioMode && (() => {
                // Apple's novelty/effect "voices" — filter them out, they're not narration.
                const NOVELTY = /^(albert|bad news|bahh|bells|boing|bubbles|cellos|good news|jester|organ|superstar|trinoids|whisper|wobble|zarvox)$/i
                const enVoices = voices.filter(
                  v => v.lang?.toLowerCase().startsWith('en') && !NOVELTY.test(v.name.trim())
                )
                const tierOf = v =>
                  /premium/i.test(v.name) ? 'Premium' : /enhanced/i.test(v.name) ? 'Enhanced' : 'Standard'
                return (
                  <>
                    <select
                      value={selectedVoiceURI || ''}
                      onChange={e => selectVoice(e.target.value)}
                      className="text-[11px] bg-transparent opacity-80 hover:opacity-100 max-w-full"
                    >
                      {['Premium', 'Enhanced', 'Standard'].map(tier => {
                        const group = enVoices.filter(v => tierOf(v) === tier)
                        if (!group.length) return null
                        return (
                          <optgroup key={tier} label={tier}>
                            {group.map(v => (
                              <option key={v.voiceURI} value={v.voiceURI}>
                                {v.name.replace(/\s*\((premium|enhanced)\)/i, '')}
                                {v.localService ? '' : ' — online'}
                              </option>
                            ))}
                          </optgroup>
                        )
                      })}
                    </select>
                    <div className="text-[10px] opacity-40 text-center">
                      {voices.length} voice{voices.length === 1 ? '' : 's'} on this device
                      {' · '}
                      {enVoices.filter(v => tierOf(v) !== 'Standard').length} enhanced/premium
                    </div>
                  </>
                )
              })()}
              <div className="flex items-center gap-2">
                <span className="text-[11px] opacity-60">Speed</span>
                <input
                  type="range" min="0.5" max="2" step="0.1" value={rate}
                  onChange={e => { setRate(Number(e.target.value)); if (!audioMode && speaking) resume({ onDone: advance }) }}
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
