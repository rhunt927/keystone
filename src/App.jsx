import { useState } from 'react'
import { useAuth } from './hooks/useAuth'
import { useDatabase } from './hooks/useDatabase'
import { LoginScreen } from './components/LoginScreen'
import { TopicList } from './components/TopicList'
import { LessonViewer } from './components/LessonViewer'

function BuildFooter() {
  return (
    <footer className="fixed bottom-2 inset-x-0 text-center text-[10px] text-[#3A2415]/70 z-50 pointer-events-none">
      build {typeof __BUILD_ID__ !== 'undefined' ? __BUILD_ID__ : 'dev'}
    </footer>
  )
}

function App() {
  const { user, accessToken, loading: authLoading, gisReady, login, logout, clearAuth } = useAuth()
  const { loading: dbLoading, error: dbError, query } = useDatabase(accessToken, clearAuth)
  const [view, setView] = useState({ screen: 'domains' })

  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#F1E4CF] text-[#3A2415]">
        Loading…
        <BuildFooter />
      </div>
    )
  }

  if (!user || !accessToken) {
    return (
      <>
        <LoginScreen onLogin={login} gisReady={gisReady} />
        <BuildFooter />
      </>
    )
  }

  const domains = query('SELECT id, slug, name FROM domains ORDER BY id')

  let body = null
  if (dbLoading) {
    body = <p className="text-sm opacity-70">Loading your lessons from Drive…</p>
  } else if (dbError) {
    body = <p className="text-sm text-red-700">{dbError}</p>
  } else if (view.screen === 'domains') {
    body = (
      <div>
        <h2 className="text-sm font-semibold uppercase tracking-wide opacity-60 mb-2">
          Domains
        </h2>
        <ul className="space-y-1">
          {domains.map(d => (
            <li key={d.id}>
              <button
                onClick={() => setView({ screen: 'topics', domain: d })}
                className="w-full text-left rounded-lg bg-white/40 hover:bg-white/60 transition-colors px-3 py-2 text-sm"
              >
                {d.name}
              </button>
            </li>
          ))}
        </ul>
      </div>
    )
  } else if (view.screen === 'topics') {
    const topics = query(
      "SELECT id, slug, title, one_line_summary FROM topics WHERE domain_id = ? AND status = 'ready' ORDER BY title",
      [view.domain.id]
    )
    body = (
      <TopicList
        domain={view.domain}
        topics={topics}
        onSelectTopic={topic => setView({ screen: 'lesson', domain: view.domain, topic })}
        onBack={() => setView({ screen: 'domains' })}
      />
    )
  } else if (view.screen === 'lesson') {
    const lesson = query(
      "SELECT id, title FROM lessons WHERE topic_id = ? AND kind = 'overview' LIMIT 1",
      [view.topic.id]
    )[0]
    const rawCards = lesson
      ? query(
          `SELECT c.id, c.position, c.card_type, c.headline, c.body, c.visual_spec,
                  i.url AS image_url, i.attribution AS image_attribution, i.source_url AS image_source_url
           FROM cards c
           LEFT JOIN images i ON i.id = c.image_id
           WHERE c.lesson_id = ?
           ORDER BY c.position`,
          [lesson.id]
        )
      : []
    const cards = rawCards.map(c => ({
      ...c,
      sources: query(
        `SELECT s.url, s.title, s.publisher FROM sources s
         JOIN card_sources cs ON cs.source_id = s.id
         WHERE cs.card_id = ?`,
        [c.id]
      ),
    }))
    body = (
      <LessonViewer
        topic={view.topic}
        domain={view.domain}
        lessonTitle={lesson?.title}
        cards={cards}
        onBack={() => setView({ screen: 'topics', domain: view.domain })}
      />
    )
  }

  return (
    <div className="min-h-screen bg-[#F1E4CF] text-[#3A2415] px-6 py-10">
      <div className="max-w-md mx-auto space-y-6">
        <header className="flex items-center justify-between">
          <h1 className="text-2xl font-serif">keystone</h1>
          <button onClick={logout} className="text-xs opacity-60 hover:opacity-100">
            Sign out
          </button>
        </header>

        {view.screen === 'domains' && user.name && (
          <p className="text-sm opacity-70">Signed in as {user.name}</p>
        )}

        {body}
      </div>
      <BuildFooter />
    </div>
  )
}

export default App
