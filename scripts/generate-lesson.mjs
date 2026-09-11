#!/usr/bin/env node
// Standalone "topic in -> sourced summary out" pipeline (Phase 3 proof), per the
// project brief's Next Steps: prove this out before wiring it into the UI.
// As of the in-app "search for a subject" / "pull a thread" feature, this CLI
// and the app both share the same fetch pipeline (src/lib/wikiLesson.js) — this
// script is now mainly useful for pre-seeding a topic from a terminal.
//
// Retrieval: Wikipedia REST + Action APIs (free, no key). Generation: NONE — the
// lead-section prose is used verbatim, chunked into cards. No model rewrite step,
// so there is no rewording that could drift from the source and nothing to
// hallucinate; the content IS the cited source.
//
// Usage: node scripts/generate-lesson.mjs "<Wikipedia page title>" [domainSlug]
//   e.g. node scripts/generate-lesson.mjs "Rosa Parks"
// Defaults to the 'explore' domain — everything writeGeneratedTopic() writes
// is tagged source_kind='generated' (Wikipedia prose, device voice), which is
// exactly what the in-app search/thread flow files under Explore, not mixed
// into the curated, hand-authored domains. Pass a domainSlug explicitly to
// override, e.g. for pre-seeding.

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import initSqlJs from 'sql.js'
import { runMigrations } from '../src/lib/migrate.js'
import { generateLessonFromWikipedia, slugify } from '../src/lib/wikiLesson.js'
import { writeGeneratedTopic } from '../src/lib/topicWriter.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(__dirname, '..')
const SCHEMA_PATH = path.join(REPO_ROOT, 'db', 'schema.sql')
const DB_PATH =
  '/Users/rhunt/Library/CloudStorage/GoogleDrive-rghunt@gmail.com/My Drive/keystone/keystone.db'

async function main() {
  const [, , topicArg, domainSlug = 'explore'] = process.argv
  if (!topicArg) {
    console.error('Usage: node scripts/generate-lesson.mjs "<Wikipedia page title>" [domainSlug]')
    process.exit(1)
  }

  console.log(`Fetching "${topicArg}" from Wikipedia…`)
  const lesson = await generateLessonFromWikipedia(topicArg)
  console.log(`Retrieved "${lesson.title}" — ${lesson.cards.length} card(s) spread across the article from ${lesson.pageUrl}`)
  console.log(`  Matched images for ${lesson.cards.filter(c => c.image).length}/${lesson.cards.length} card(s)`)

  const SQL = await initSqlJs({
    locateFile: file => path.join(REPO_ROOT, 'node_modules', 'sql.js', 'dist', file),
  })
  const db = new SQL.Database(fs.readFileSync(DB_PATH))
  db.run(fs.readFileSync(SCHEMA_PATH, 'utf8'))
  runMigrations(db)

  const domainRow = db.exec('SELECT id FROM domains WHERE slug = ?', [domainSlug])[0]
  if (!domainRow) throw new Error(`Unknown domain slug "${domainSlug}"`)
  const domainId = domainRow.values[0][0]

  const { topicId, lessonId, slug } = writeGeneratedTopic(db, {
    domainId,
    slug: slugify(lesson.title),
    title: lesson.title,
    description: lesson.description,
    pageUrl: lesson.pageUrl,
    cards: lesson.cards,
  })

  fs.writeFileSync(DB_PATH, Buffer.from(db.export()))
  db.close()

  console.log(`\n✔ Wrote topic "${lesson.title}" (id ${topicId}, slug "${slug}"), lesson id ${lessonId}, ${lesson.cards.length} card(s)`)
  console.log(`  Source: ${lesson.pageUrl}`)
  console.log(`  Saved to ${DB_PATH}`)
}

main().catch(err => {
  console.error('\n✘', err.message)
  process.exit(1)
})
