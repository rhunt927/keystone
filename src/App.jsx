import { useState } from 'react'
import { useAuth } from './hooks/useAuth'
import { useDatabase } from './hooks/useDatabase'
import { useDriveFolder } from './hooks/useDriveFolder'
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
  const { folderId, picking, error: folderError, pick, reset: resetFolder } = useDriveFolder(accessToken)
  const { loading: dbLoading, error: dbError, query } = useDatabase(accessToken, folderId, clearAuth)
  const [view, setView] = useState({ screen: 'domains' })

  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#F1E4CF] text-[#3A2415]">
        Loading…
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

  // One-time-per-device step: under the narrow drive.file scope the app has
  // no way to discover the existing "keystone" folder on its own — you hand
  // it over explicitly, once, through Google's own picker. Remembered in
  // localStorage after that (see useDriveFolder).
  if (!folderId) {
    return (
      <>
        <div className="min-h-screen flex items-center justify-center bg-[#F1E4CF] text-[#3A2415] px-6">
          <div className="max-w-sm text-center space-y-4">
            <h1 className="text-2xl font-serif">One-time setup</h1>
            <p className="text-sm opacity-70">
              Point keystone at your "keystone" folder in Drive — just once on this device.
            </p>
            {folderError && <p className="text-sm text-red-700">{folderError}</p>}
            <button
              onClick={pick}
              disabled={picking}
              className="rounded-lg bg-[#6B4226] text-[#F1E4CF] px-4 py-2 text-sm font-medium disabled:opacity-50"
            >
              {picking ? 'Opening picker…' : 'Select your keystone folder'}
            </button>
          </div>
        </div>
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
    // A thread can open a specific deep-dive lesson by its own slug; absent
    // that, it's the topic's normal overview lesson.
    const lesson = view.lessonSlug
      ? query('SELECT id, slug, title FROM lessons WHERE slug = ?', [view.lessonSlug])[0]
      : query("SELECT id, slug, title FROM lessons WHERE topic_id = ? AND kind = 'overview' LIMIT 1", [view.topic.id])[0]
    const rawCards = lesson
      ? query(
          `SELECT c.id, c.position, c.card_type, c.headline, c.body, c.visual_spec, c.thread_refs,
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

    // Resolves a thread's target (another lesson, or another topic's
    // overview) to a full view object, always pointing "back" at where we
    // came from. Both kinds of reference already point at real, existing,
    // already-authored content — never a live lookup or a placeholder.
    function resolveThread(ref) {
      if (ref.lesson_slug) {
        const row = query(
          `SELECT l.slug AS lesson_slug, t.id AS topic_id, t.slug AS topic_slug, t.title AS topic_title,
                  d.id AS domain_id, d.slug AS domain_slug, d.name AS domain_name
           FROM lessons l JOIN topics t ON t.id = l.topic_id JOIN domains d ON d.id = t.domain_id
           WHERE l.slug = ?`,
          [ref.lesson_slug]
        )[0]
        if (!row) return null
        return {
          screen: 'lesson',
          domain: { id: row.domain_id, slug: row.domain_slug, name: row.domain_name },
          topic: { id: row.topic_id, slug: row.topic_slug, title: row.topic_title },
          lessonSlug: row.lesson_slug,
          backTo: view,
        }
      }
      if (ref.topic_slug) {
        const row = query(
          `SELECT t.id, t.slug, t.title, d.id AS domain_id, d.slug AS domain_slug, d.name AS domain_name
           FROM topics t JOIN domains d ON d.id = t.domain_id WHERE t.slug = ?`,
          [ref.topic_slug]
        )[0]
        if (!row) return null
        return {
          screen: 'lesson',
          domain: { id: row.domain_id, slug: row.domain_slug, name: row.domain_name },
          topic: { id: row.id, slug: row.slug, title: row.title },
          backTo: view,
        }
      }
      return null
    }

    body = (
      <LessonViewer
        // Forces a fresh mount (reset index/playback state) whenever the
        // actual lesson changes — including a thread jumping straight into a
        // deep dive mid-beat, or coming back from one.
        key={lesson?.id ?? `${view.topic.id}-empty`}
        topic={view.topic}
        domain={view.domain}
        lessonTitle={lesson?.title}
        audioSlug={lesson?.slug || view.topic.slug}
        cards={cards}
        accessToken={accessToken}
        folderId={folderId}
        onBack={() => setView(view.backTo || { screen: 'topics', domain: view.domain })}
        backLabel={view.backTo ? (view.backTo.topic?.title || 'Back') : 'Topics'}
        onOpenThread={ref => {
          const next = resolveThread(ref)
          if (next) setView(next)
        }}
      />
    )
  }

  return (
    <div className="min-h-screen bg-[#F1E4CF] text-[#3A2415] px-6 py-10">
      <div className="max-w-md mx-auto space-y-6">
        <header className="flex items-center justify-between">
          <h1 className="text-2xl font-serif">keystone</h1>
          <div className="flex items-center gap-3">
            {folderId && (
              <button onClick={resetFolder} className="text-xs opacity-60 hover:opacity-100">
                Change Drive folder
              </button>
            )}
            <button onClick={logout} className="text-xs opacity-60 hover:opacity-100">
              Sign out
            </button>
          </div>
        </header>

        {view.screen === 'domains' && user.name && (
          <p className="text-sm opacity-70">Signed in as {user.name}</p>
        )}

        {body}
      </div>
    </div>
  )
}

export default App
