import { useState } from 'react'
import { useAuth } from './hooks/useAuth'
import { useDatabase } from './hooks/useDatabase'
import { LoginScreen } from './components/LoginScreen'
import { TopicList } from './components/TopicList'
import { LessonViewer } from './components/LessonViewer'
import { AddTopicScreen } from './components/AddTopicScreen'
import { searchWikipedia, generateLessonFromWikipedia, slugify } from './lib/wikiLesson'
import { writeGeneratedTopic } from './lib/topicWriter'

function BuildFooter() {
  return (
    <footer className="fixed bottom-2 inset-x-0 text-center text-[10px] text-[#3A2415]/70 z-50 pointer-events-none">
      build {typeof __BUILD_ID__ !== 'undefined' ? __BUILD_ID__ : 'dev'}
    </footer>
  )
}

function App() {
  const { user, accessToken, loading: authLoading, gisReady, login, logout, clearAuth } = useAuth()
  const { loading: dbLoading, error: dbError, query, mutate } = useDatabase(accessToken, clearAuth)
  const [view, setView] = useState({ screen: 'domains' })

  // Looks up a topic (with its domain) by slug, for both "already exists,
  // just navigate" and "open the topic this one was spun off from."
  function findTopicWithDomain(slug) {
    const row = query(
      `SELECT t.*, d.id AS domain_id, d.slug AS domain_slug, d.name AS domain_name
       FROM topics t JOIN domains d ON d.id = t.domain_id
       WHERE t.slug = ?`,
      [slug]
    )[0]
    if (!row) return null
    return {
      topic: row,
      domain: { id: row.domain_id, slug: row.domain_slug, name: row.domain_name },
    }
  }

  // Shared by the search screen ("Explore a topic") and "pull a thread" in
  // the lesson viewer: reuse an existing generated topic if one already
  // matches, otherwise build one from Wikipedia and write it into the
  // Explore domain. Throws on failure — callers show the message inline.
  async function createTopicFromWikipedia(title, { originCardId = null } = {}) {
    const guessedSlug = slugify(title)
    const existing = findTopicWithDomain(guessedSlug)
    if (existing) {
      setView({ screen: 'lesson', domain: existing.domain, topic: existing.topic })
      return
    }

    const lesson = await generateLessonFromWikipedia(title)
    const exploreDomainId = query("SELECT id FROM domains WHERE slug = 'explore'")[0]?.id
    if (!exploreDomainId) throw new Error('Explore domain is missing — try reloading the app.')

    const { topicId, slug } = await mutate(db =>
      writeGeneratedTopic(db, {
        domainId: exploreDomainId,
        slug: slugify(lesson.title),
        title: lesson.title,
        description: lesson.description,
        pageUrl: lesson.pageUrl,
        cards: lesson.cards,
        originCardId,
      })
    )

    const found = findTopicWithDomain(slug)
    if (!found) throw new Error('Saved, but could not reopen it — try again.')
    setView({ screen: 'lesson', domain: found.domain, topic: { ...found.topic, id: topicId } })
  }

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

  const domains = query('SELECT id, slug, name FROM domains ORDER BY id')

  let body = null
  if (dbLoading) {
    body = <p className="text-sm opacity-70">Loading your lessons from Drive…</p>
  } else if (dbError) {
    body = <p className="text-sm text-red-700">{dbError}</p>
  } else if (view.screen === 'domains') {
    body = (
      <div>
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-sm font-semibold uppercase tracking-wide opacity-60">
            Domains
          </h2>
          <button
            onClick={() => setView({ screen: 'search', returnTo: { screen: 'domains' } })}
            className="text-xs rounded-full bg-[#6B4226]/10 hover:bg-[#6B4226]/20 px-3 py-1.5 font-medium"
          >
            + Explore a topic
          </button>
        </div>
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
  } else if (view.screen === 'search') {
    body = (
      <AddTopicScreen
        onSearch={q => searchWikipedia(q)}
        onPick={title => createTopicFromWikipedia(title)}
        onBack={() => setView(view.returnTo || { screen: 'domains' })}
      />
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
        onAddTopic={() => setView({ screen: 'search', returnTo: { screen: 'topics', domain: view.domain } })}
      />
    )
  } else if (view.screen === 'lesson') {
    // Re-fetch the full row (source_kind, origin_card_id aren't on the
    // lighter list-view projection used by TopicList/createTopicFromWikipedia).
    const topic = query('SELECT * FROM topics WHERE id = ?', [view.topic.id])[0] || view.topic
    const lesson = query(
      "SELECT id, title FROM lessons WHERE topic_id = ? AND kind = 'overview' LIMIT 1",
      [topic.id]
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
    const originInfo = topic.origin_card_id
      ? query(
          `SELECT t.title, t.slug
           FROM cards c JOIN lessons l ON l.id = c.lesson_id JOIN topics t ON t.id = l.topic_id
           WHERE c.id = ?`,
          [topic.origin_card_id]
        )[0]
      : null
    body = (
      <LessonViewer
        topic={topic}
        domain={view.domain}
        lessonTitle={lesson?.title}
        cards={cards}
        accessToken={accessToken}
        onBack={() => setView({ screen: 'topics', domain: view.domain })}
        originInfo={originInfo}
        onOpenOrigin={info => {
          const found = findTopicWithDomain(info.slug)
          if (found) setView({ screen: 'lesson', domain: found.domain, topic: found.topic })
        }}
        onFollowThread={(wikiTitle, originCardId) => createTopicFromWikipedia(wikiTitle, { originCardId })}
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
    </div>
  )
}

export default App
