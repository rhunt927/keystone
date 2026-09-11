export function TopicList({ domain, topics, onSelectTopic, onBack, onAddTopic }) {
  return (
    <div className="space-y-4">
      <button onClick={onBack} className="text-sm opacity-60 hover:opacity-100">
        ← Domains
      </button>
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-serif">{domain.name}</h1>
        {onAddTopic && (
          <button
            onClick={onAddTopic}
            className="shrink-0 text-xs rounded-full bg-[#6B4226]/10 hover:bg-[#6B4226]/20 px-3 py-1.5 font-medium"
          >
            + Explore a topic
          </button>
        )}
      </div>

      {topics.length === 0 ? (
        <p className="text-sm opacity-70">
          {domain.slug === 'explore'
            ? 'Nothing here yet — search for any subject and it’ll show up below.'
            : 'No topics yet in this domain.'}
        </p>
      ) : (
        <ul className="space-y-2">
          {topics.map(t => (
            <li key={t.id}>
              <button
                onClick={() => onSelectTopic(t)}
                className="w-full text-left rounded-lg bg-white/40 hover:bg-white/60 transition-colors px-4 py-3"
              >
                <div className="font-medium">{t.title}</div>
                {t.one_line_summary && (
                  <div className="text-xs opacity-70 mt-0.5">{t.one_line_summary}</div>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
