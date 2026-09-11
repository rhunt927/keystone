// Writes the output of wikiLesson.generateLessonFromWikipedia() into a sql.js
// Database — shared by the CLI script (scripts/generate-lesson.mjs, DB opened
// from a file) and the in-app "search for a subject" / "pull a thread" flow
// (App.jsx, DB opened from Drive via useDatabase). Pure db.run/db.exec calls,
// no filesystem or network here.
//
// Every topic written this way is tagged source_kind = 'generated' — verbatim
// Wikipedia prose, no hand authoring, read aloud by the device's own voice —
// a different, clearly-labeled tier from the curated 'authored' lessons.

function lastInsertId(db) {
  return db.exec('SELECT last_insert_rowid() AS id')[0].values[0][0]
}

function upsertImage(db, image, altText, now) {
  const existing = db.exec('SELECT id FROM images WHERE url = ?', [image.url])[0]
  if (existing) {
    const id = existing.values[0][0]
    db.run('UPDATE images SET attribution = ?, license = ?, source_url = ? WHERE id = ?', [
      image.attribution, image.license, image.sourceUrl, id,
    ])
    return id
  }
  db.run(
    `INSERT INTO images (url, alt_text, attribution, source_url, license, is_photo, depicts_named_real_person, created_at)
     VALUES (?, ?, ?, ?, ?, 1, 0, ?)`,
    [image.url, altText, image.attribution, image.sourceUrl, image.license, now]
  )
  return lastInsertId(db)
}

// `cards`: [{ headline, body, image: {url, sourceUrl, attribution, license} | null }]
// `originCardId`: the id of the card this topic was spun off from, when it
// arrived via "pull a thread" rather than the search box. Omit/null otherwise.
export function writeGeneratedTopic(db, { domainId, slug, title, description, pageUrl, cards, originCardId = null }) {
  const now = new Date().toISOString()

  db.run(
    `INSERT INTO topics (domain_id, slug, title, one_line_summary, status, source_kind, origin_card_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'ready', 'generated', ?, ?, ?)
     ON CONFLICT(slug) DO UPDATE SET
       one_line_summary = excluded.one_line_summary,
       status = 'ready',
       origin_card_id = COALESCE(excluded.origin_card_id, topics.origin_card_id),
       updated_at = excluded.updated_at`,
    [domainId, slug, title, description || null, originCardId, now, now]
  )
  const topicId = db.exec('SELECT id FROM topics WHERE slug = ?', [slug])[0].values[0][0]

  // Idempotent re-run/re-follow: replace this topic's overview lesson (cards
  // cascade) rather than piling up duplicates.
  const existingLesson = db.exec("SELECT id FROM lessons WHERE topic_id = ? AND kind = 'overview'", [topicId])[0]
  if (existingLesson) db.run('DELETE FROM lessons WHERE id = ?', [existingLesson.values[0][0]])

  db.run(
    "INSERT INTO lessons (topic_id, kind, title, position, created_at) VALUES (?, 'overview', ?, 0, ?)",
    [topicId, title, now]
  )
  const lessonId = lastInsertId(db)

  db.run(
    `INSERT INTO sources (url, title, publisher, source_type, retrieved_at, created_at)
     VALUES (?, ?, 'Wikipedia', 'encyclopedic', ?, ?)
     ON CONFLICT(url) DO UPDATE SET retrieved_at = excluded.retrieved_at`,
    [pageUrl, `${title} — Wikipedia`, now, now]
  )
  const sourceId = db.exec('SELECT id FROM sources WHERE url = ?', [pageUrl])[0].values[0][0]

  cards.forEach(({ headline, body, image }, i) => {
    const imageId = image ? upsertImage(db, image, title, now) : null
    db.run(
      "INSERT INTO cards (lesson_id, position, card_type, headline, body, image_id, created_at) VALUES (?, ?, 'text', ?, ?, ?, ?)",
      [lessonId, i, headline, body, imageId, now]
    )
    const cardId = lastInsertId(db)
    db.run('INSERT OR IGNORE INTO card_sources (card_id, source_id) VALUES (?, ?)', [cardId, sourceId])
  })

  db.run(
    `INSERT INTO search_cache (topic_id, query, provider, raw_response, retrieved_at)
     VALUES (?, ?, 'wikipedia_rest_api', ?, ?)`,
    [topicId, title, JSON.stringify({ title, description, pageUrl, cardCount: cards.length }), now]
  )

  return { topicId, lessonId, slug }
}
