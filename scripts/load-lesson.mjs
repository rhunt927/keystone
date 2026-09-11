#!/usr/bin/env node
// Loads a hand-authored, source-grounded narrative lesson (db/lessons/<slug>.json)
// into keystone.db. Unlike generate-lesson.mjs (which chunks Wikipedia prose
// verbatim), these lessons are written for engagement — a hook, an arc, an
// ending — but every beat still carries a visible citation, no invented quotes
// or events. Authoring happens by hand from the cited sources; this script just
// writes the result and resolves each beat's Commons image.
//
// Talks to keystone.db over the Drive REST API (not a local Drive-synced
// folder), so this can run from any machine with network access and a valid
// GOOGLE_DRIVE_REFRESH_TOKEN in .env — see scripts/drive-auth.mjs.
//
// Usage: node scripts/load-lesson.mjs black-death

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import initSqlJs from 'sql.js'
import { runMigrations } from '../src/lib/migrate.js'
import { getAccessToken } from './lib/driveAuth.mjs'
import { findOrCreateFolder, findFile, downloadFile, uploadFile } from './lib/drive.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(__dirname, '..')
const SCHEMA_PATH = path.join(REPO_ROOT, 'db', 'schema.sql')
const DB_FILENAME = 'keystone.db'
const USER_AGENT = 'keystone-app/0.1 (personal learning project; rghunt@gmail.com)'

function stripHtml(html) {
  const text = (html || '').replace(/<[^>]+>/g, '').trim()
  const half = text.slice(0, text.length / 2)
  return text.length % 2 === 0 && half + half === text ? half : text
}

async function fetchJson(url) {
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } })
  if (!res.ok) throw new Error(`Fetch failed (${res.status}): ${url}`)
  return res.json()
}

async function commonsInfo(fileName) {
  const name = fileName.replace(/^File:/i, '')
  const data = await fetchJson(
    `https://commons.wikimedia.org/w/api.php?action=query&titles=${encodeURIComponent('File:' + name)}&prop=imageinfo&iiprop=extmetadata%7Curl%7Csize&format=json`
  )
  const info = Object.values(data.query.pages)[0]?.imageinfo?.[0]
  if (!info?.url) return null
  const meta = info.extmetadata || {}
  return {
    url: info.url,
    sourceUrl: info.descriptionurl || info.url,
    attribution: stripHtml(meta.Artist?.value) || stripHtml(meta.Credit?.value) || 'Wikimedia Commons',
    license: stripHtml(meta.LicenseShortName?.value) || null,
  }
}

async function resolveBeatImage(beat) {
  if (beat.image_file) return commonsInfo(beat.image_file)
  if (beat.image_query) {
    const search = await fetchJson(
      `https://commons.wikimedia.org/w/api.php?action=query&list=search&srnamespace=6&srsearch=${encodeURIComponent(beat.image_query)}&srlimit=6&format=json`
    )
    for (const hit of search.query?.search || []) {
      if (!/\.(jpe?g|png)$/i.test(hit.title)) continue
      const info = await commonsInfo(hit.title)
      if (info) return info
    }
  }
  return null
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
  return db.exec('SELECT last_insert_rowid() AS id')[0].values[0][0]
}

// Writes one lesson's beats as cards (used for both the overview lesson and
// any deep dives) — image/visual resolution, thread_refs, and source links.
// `sourceIdByKey` is the whole doc's shared source registry (both the
// overview and every deep dive cite from the same pool).
async function writeBeats(db, { lessonId, beats, sourceIdByKey, altText, now }) {
  let withImage = 0
  let withVisual = 0
  for (let i = 0; i < beats.length; i++) {
    const beat = beats[i]
    let imageId = null
    if (!beat.visual) {
      const image = await resolveBeatImage(beat).catch(() => null)
      if (image) {
        imageId = upsertImage(db, image, beat.headline || altText, now)
        withImage++
      } else {
        console.warn(`  beat ${i} ("${beat.headline || ''}") — no image resolved`)
      }
    } else {
      withVisual++
    }

    const threadRefs = (beat.threads || []).map(t => ({
      label: t.label,
      ...(t.lesson_slug ? { lesson_slug: t.lesson_slug } : {}),
      ...(t.topic_slug ? { topic_slug: t.topic_slug } : {}),
    }))

    db.run(
      `INSERT INTO cards (lesson_id, position, card_type, headline, body, image_id, visual_spec, thread_refs, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        lessonId, i, beat.visual ? 'visual' : 'text',
        beat.headline || null, beat.body, imageId,
        beat.visual ? JSON.stringify(beat.visual) : null,
        threadRefs.length ? JSON.stringify(threadRefs) : null,
        now,
      ]
    )
    const cardId = db.exec('SELECT last_insert_rowid() AS id')[0].values[0][0]
    for (const key of beat.source_ids || []) {
      if (sourceIdByKey[key]) {
        db.run('INSERT OR IGNORE INTO card_sources (card_id, source_id) VALUES (?, ?)', [cardId, sourceIdByKey[key]])
      }
    }
  }
  return { withImage, withVisual }
}

async function main() {
  const slug = process.argv[2]
  if (!slug) {
    console.error('Usage: node scripts/load-lesson.mjs <lesson-slug>')
    process.exit(1)
  }

  const lessonPath = path.join(REPO_ROOT, 'db', 'lessons', `${slug}.json`)
  const doc = JSON.parse(fs.readFileSync(lessonPath, 'utf8'))
  const { topic, sources, beats, deep_dives = [] } = doc
  console.log(`Loading "${topic.title}" — ${beats.length} beat(s), ${sources.length} source(s), ${deep_dives.length} deep dive(s)`)

  console.log('Connecting to Drive…')
  const token = await getAccessToken()
  const keystoneFolderId = await findOrCreateFolder(token, 'keystone')
  const dbFileId = await findFile(token, DB_FILENAME, keystoneFolderId)
  const dbBytes = dbFileId ? await downloadFile(token, dbFileId) : null

  const SQL = await initSqlJs({
    locateFile: file => path.join(REPO_ROOT, 'node_modules', 'sql.js', 'dist', file),
  })
  const db = dbBytes ? new SQL.Database(dbBytes) : new SQL.Database()
  db.run(fs.readFileSync(SCHEMA_PATH, 'utf8'))
  runMigrations(db)

  const now = new Date().toISOString()
  const domainId = db.exec('SELECT id FROM domains WHERE slug = ?', [topic.domain])[0]?.values[0][0]
  if (!domainId) throw new Error(`Unknown domain "${topic.domain}"`)

  db.run(
    `INSERT INTO topics (domain_id, slug, title, one_line_summary, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'ready', ?, ?)
     ON CONFLICT(slug) DO UPDATE SET
       one_line_summary = excluded.one_line_summary, status = 'ready', updated_at = excluded.updated_at`,
    [domainId, topic.slug, topic.title, topic.one_line_summary || null, now, now]
  )
  const topicId = db.exec('SELECT id FROM topics WHERE slug = ?', [topic.slug])[0].values[0][0]

  // Replace this topic's overview lesson (cards cascade) on re-run.
  const existing = db.exec("SELECT id FROM lessons WHERE topic_id = ? AND kind = 'overview'", [topicId])[0]
  if (existing) db.run('DELETE FROM lessons WHERE id = ?', [existing.values[0][0]])

  db.run(
    "INSERT INTO lessons (topic_id, kind, title, position, created_at) VALUES (?, 'overview', ?, 0, ?)",
    [topicId, topic.title, now]
  )
  const lessonId = db.exec('SELECT last_insert_rowid() AS id')[0].values[0][0]

  const sourceIdByKey = {}
  for (const s of sources) {
    db.run(
      `INSERT INTO sources (url, title, publisher, source_type, retrieved_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(url) DO UPDATE SET title = excluded.title, publisher = excluded.publisher,
         source_type = excluded.source_type, retrieved_at = excluded.retrieved_at`,
      [s.url, s.title, s.publisher || null, s.source_type || 'other', now, now]
    )
    sourceIdByKey[s.id] = db.exec('SELECT id FROM sources WHERE url = ?', [s.url])[0].values[0][0]
  }

  const { withImage, withVisual } = await writeBeats(db, {
    lessonId, beats, sourceIdByKey, altText: topic.title, now,
  })

  // Deep dives — each is its own addressable (by slug) lesson, cited from the
  // same shared source pool. Replaced by slug on re-run, same as the overview.
  let deepDiveCount = 0
  for (const dd of deep_dives) {
    const existingDd = db.exec('SELECT id FROM lessons WHERE slug = ?', [dd.slug])[0]
    if (existingDd) db.run('DELETE FROM lessons WHERE id = ?', [existingDd.values[0][0]])

    db.run(
      "INSERT INTO lessons (topic_id, kind, slug, title, position, created_at) VALUES (?, 'deep_dive', ?, ?, ?, ?)",
      [topicId, dd.slug, dd.title, deepDiveCount + 1, now]
    )
    const ddLessonId = db.exec('SELECT last_insert_rowid() AS id')[0].values[0][0]
    await writeBeats(db, { lessonId: ddLessonId, beats: dd.beats, sourceIdByKey, altText: dd.title, now })
    deepDiveCount++
    console.log(`  deep dive "${dd.title}" (slug "${dd.slug}") — ${dd.beats.length} beat(s)`)
  }

  db.run(
    `INSERT INTO search_cache (topic_id, query, provider, raw_response, retrieved_at)
     VALUES (?, ?, 'authored', ?, ?)`,
    [topicId, slug, JSON.stringify(doc), now]
  )

  console.log('Saving to Drive…')
  await uploadFile(token, {
    fileId: dbFileId,
    name: DB_FILENAME,
    parentId: keystoneFolderId,
    mimeType: 'application/octet-stream',
    buffer: Buffer.from(db.export()),
  })
  db.close()

  console.log(`\n✔ Loaded "${topic.title}" (topic ${topicId}, lesson ${lessonId})`)
  console.log(`  ${beats.length} beats — ${withImage} with a photo, ${withVisual} with a motion graphic`)
  if (deepDiveCount) console.log(`  ${deepDiveCount} deep dive(s) loaded`)
  console.log(`  Saved to Drive: keystone/${DB_FILENAME}`)
}

main().catch(err => {
  console.error('\n✘', err.message)
  process.exit(1)
})
