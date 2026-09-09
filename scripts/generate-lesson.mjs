#!/usr/bin/env node
// Standalone "topic in -> sourced summary out" pipeline (Phase 3 proof), per the
// project brief's Next Steps: prove this out before wiring it into the UI.
//
// Retrieval: Wikipedia REST + Action APIs (free, no key). Generation: NONE — the
// lead-section prose is used verbatim, chunked into cards. No model rewrite step,
// so there is no rewording that could drift from the source and nothing to
// hallucinate; the content IS the cited source. Revisit if a more narrative voice
// is wanted later (would then cost money per the brief's open question).
//
// Usage: node scripts/generate-lesson.mjs "<Wikipedia page title>" [domainSlug]
//   e.g. node scripts/generate-lesson.mjs "Rosa Parks" history

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import initSqlJs from 'sql.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(__dirname, '..')
const SCHEMA_PATH = path.join(REPO_ROOT, 'db', 'schema.sql')
const DB_PATH =
  '/Users/rhunt/Library/CloudStorage/GoogleDrive-rghunt@gmail.com/My Drive/keystone/keystone.db'

const USER_AGENT = 'keystone-app/0.1 (personal learning project; rghunt@gmail.com)'
const MAX_CARDS = 6

function slugify(s) {
  return s.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')
}

async function fetchJson(url) {
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } })
  if (!res.ok) throw new Error(`Fetch failed (${res.status}): ${url}`)
  return res.json()
}

async function fetchWikipedia(title) {
  const summary = await fetchJson(
    `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`
  )
  if (summary.type === 'disambiguation') {
    throw new Error(`"${title}" is a disambiguation page — use a more specific title`)
  }

  const extractData = await fetchJson(
    `https://en.wikipedia.org/w/api.php?action=query&prop=extracts&exintro=1&explaintext=1&format=json&titles=${encodeURIComponent(summary.title)}`
  )
  const page = Object.values(extractData.query.pages)[0]
  const fullExtract = page.extract || summary.extract || ''

  const paragraphs = fullExtract
    .split('\n')
    .map(p => p.trim())
    .filter(Boolean)
    .slice(0, MAX_CARDS)

  return {
    title: summary.title,
    description: summary.description || '',
    pageUrl: summary.content_urls?.desktop?.page,
    paragraphs,
  }
}

async function main() {
  const [, , topicArg, domainSlug = 'history'] = process.argv
  if (!topicArg) {
    console.error('Usage: node scripts/generate-lesson.mjs "<Wikipedia page title>" [domainSlug]')
    process.exit(1)
  }

  console.log(`Fetching "${topicArg}" from Wikipedia…`)
  const { title, description, pageUrl, paragraphs } = await fetchWikipedia(topicArg)
  if (!pageUrl) throw new Error('No source URL returned — refusing to write unsourced content')
  if (paragraphs.length === 0) throw new Error('No content retrieved — nothing to write')
  console.log(`Retrieved "${title}" — ${paragraphs.length} paragraph(s) from ${pageUrl}`)

  const SQL = await initSqlJs({
    locateFile: file => path.join(REPO_ROOT, 'node_modules', 'sql.js', 'dist', file),
  })
  const dbBytes = fs.readFileSync(DB_PATH)
  const db = new SQL.Database(dbBytes)
  db.run(fs.readFileSync(SCHEMA_PATH, 'utf8')) // idempotent create-or-migrate

  const domainRow = db.exec('SELECT id FROM domains WHERE slug = ?', [domainSlug])[0]
  if (!domainRow) throw new Error(`Unknown domain slug "${domainSlug}"`)
  const domainId = domainRow.values[0][0]

  const now = new Date().toISOString()
  const topicSlug = slugify(title)

  db.run(
    `INSERT INTO topics (domain_id, slug, title, one_line_summary, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'ready', ?, ?)
     ON CONFLICT(slug) DO UPDATE SET
       one_line_summary = excluded.one_line_summary,
       status = 'ready',
       updated_at = excluded.updated_at`,
    [domainId, topicSlug, title, description, now, now]
  )
  const topicId = db.exec('SELECT id FROM topics WHERE slug = ?', [topicSlug])[0].values[0][0]

  // Idempotent re-run: drop this topic's existing overview lesson (cards/quiz
  // cascade) before rewriting, so re-running doesn't pile up duplicates.
  const existingLesson = db.exec(
    "SELECT id FROM lessons WHERE topic_id = ? AND kind = 'overview'",
    [topicId]
  )[0]
  if (existingLesson) {
    db.run('DELETE FROM lessons WHERE id = ?', [existingLesson.values[0][0]])
  }

  db.run(
    "INSERT INTO lessons (topic_id, kind, title, position, created_at) VALUES (?, 'overview', ?, 0, ?)",
    [topicId, title, now]
  )
  const lessonId = db.exec('SELECT last_insert_rowid() AS id')[0].values[0][0]

  db.run(
    `INSERT INTO sources (url, title, publisher, source_type, retrieved_at, created_at)
     VALUES (?, ?, 'Wikipedia', 'encyclopedic', ?, ?)
     ON CONFLICT(url) DO UPDATE SET retrieved_at = excluded.retrieved_at`,
    [pageUrl, `${title} — Wikipedia`, now, now]
  )
  const sourceId = db.exec('SELECT id FROM sources WHERE url = ?', [pageUrl])[0].values[0][0]

  paragraphs.forEach((body, i) => {
    db.run(
      "INSERT INTO cards (lesson_id, position, card_type, body, created_at) VALUES (?, ?, 'text', ?, ?)",
      [lessonId, i, body, now]
    )
    const cardId = db.exec('SELECT last_insert_rowid() AS id')[0].values[0][0]
    db.run('INSERT OR IGNORE INTO card_sources (card_id, source_id) VALUES (?, ?)', [cardId, sourceId])
  })

  db.run(
    `INSERT INTO search_cache (topic_id, query, provider, raw_response, retrieved_at)
     VALUES (?, ?, 'wikipedia_rest_api', ?, ?)`,
    [topicId, topicArg, JSON.stringify({ title, description, pageUrl, paragraphs }), now]
  )

  fs.writeFileSync(DB_PATH, Buffer.from(db.export()))
  db.close()

  console.log(`\n✔ Wrote topic "${title}" (id ${topicId}), lesson id ${lessonId}, ${paragraphs.length} card(s)`)
  console.log(`  Source: ${pageUrl}`)
  console.log(`  Saved to ${DB_PATH}`)
}

main().catch(err => {
  console.error('\n✘', err.message)
  process.exit(1)
})
