import { useEffect, useState } from 'react'

// Renders a motion graphic built from sourced numbers/dates instead of a photo.
// Not AI imagery, not dramatization — just a visualization of the same figures
// stated (and cited) on the card.

function useRafProgress(durationMs, loop) {
  const [progress, setProgress] = useState(0)
  useEffect(() => {
    let raf
    let start
    function tick(now) {
      if (start == null) start = now
      const t = Math.min((now - start) / durationMs, 1)
      setProgress(t)
      if (t < 1) {
        raf = requestAnimationFrame(tick)
      } else if (loop) {
        start = null
        raf = requestAnimationFrame(tick)
      }
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [durationMs, loop])
  return progress
}

function SpreadMap({ spec }) {
  const from = spec.from_year ?? 1347
  const to = spec.to_year ?? 1353
  // Reveal once and hold — no loop (the looping "circle in and out" was
  // distracting during narration).
  const progress = useRafProgress(6500, false)
  const eased = progress < 0.5 ? 2 * progress * progress : 1 - Math.pow(-2 * progress + 2, 2) / 2
  const year = Math.round(from + eased * (to - from))
  // Reveal expands from the south-east corner (Crimea / the Black Sea), which
  // is roughly where the spread actually began.
  const radius = 8 + eased * 150

  return (
    <div className="absolute inset-0 bg-[#1c130c]">
      <img
        src={spec.image}
        alt="Spread of the Black Death across Europe, 1347–1353"
        className="w-full h-full object-contain"
        style={{ clipPath: `circle(${radius}% at 72% 46%)` }}
      />
      <div className="absolute top-3 left-3 font-serif text-[#F1E4CF] text-3xl tabular-nums drop-shadow">
        {year}
      </div>
    </div>
  )
}

function CountUp({ spec }) {
  const to = Number(spec.to) || 0
  const progress = useRafProgress(2200, false)
  const eased = 1 - Math.pow(1 - progress, 3)
  const value = Math.round(eased * to)

  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center text-center px-6 bg-[#3A2415] text-[#F1E4CF]">
      <div className="font-serif text-6xl tabular-nums">
        {spec.prefix || ''}{value}{spec.suffix || ''}
      </div>
      {spec.label && <div className="mt-3 text-sm max-w-xs opacity-90">{spec.label}</div>}
      {spec.note && <div className="mt-2 text-[11px] opacity-60">{spec.note}</div>}
    </div>
  )
}

function Timeline({ spec }) {
  const events = spec.events || []
  const progress = useRafProgress(Math.max(3000, events.length * 1400), false)
  const shown = Math.ceil(progress * events.length)

  return (
    <div className="absolute inset-0 flex flex-col justify-center gap-5 px-7 bg-[#3A2415] text-[#F1E4CF]">
      {events.map((e, i) => (
        <div
          key={i}
          className="flex gap-3 transition-all duration-500"
          style={{ opacity: i < shown ? 1 : 0.12, transform: i < shown ? 'none' : 'translateY(4px)' }}
        >
          <div className="flex flex-col items-center pt-1">
            <div className="w-2.5 h-2.5 rounded-full bg-[#F1E4CF]" />
            {i < events.length - 1 && <div className="w-px flex-1 bg-[#F1E4CF]/30 mt-1" />}
          </div>
          <div className="pb-1">
            <div className="text-xs font-serif opacity-70">{e.date}</div>
            <div className="text-sm leading-snug">{e.label}</div>
          </div>
        </div>
      ))}
    </div>
  )
}

export function VisualCard({ spec }) {
  if (!spec) return null
  if (spec.type === 'spread-map') return <SpreadMap spec={spec} />
  if (spec.type === 'counter') return <CountUp spec={spec} />
  if (spec.type === 'timeline') return <Timeline spec={spec} />
  return null
}
