export function LessonViewer({ topic, lessonTitle, cards, onBack }) {
  return (
    <div className="space-y-4">
      <button onClick={onBack} className="text-sm opacity-60 hover:opacity-100">
        ← Topics
      </button>
      <h1 className="text-2xl font-serif">{lessonTitle || topic.title}</h1>

      {cards.length === 0 ? (
        <p className="text-sm opacity-70">No cards yet for this lesson.</p>
      ) : (
        <div className="space-y-3">
          {cards.map(card => (
            <article key={card.id} className="rounded-lg bg-white/50 px-4 py-3 space-y-2">
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
          ))}
        </div>
      )}
    </div>
  )
}
