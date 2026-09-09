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
const MAX_CARDS = 9
const SKIP_SECTIONS = /^(references|see also|external links|further reading|bibliography|notes|sources|citations|works cited|in popular culture|film and television|music)$/i

function slugify(s) {
  return s.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')
}

async function fetchJson(url) {
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } })
  if (!res.ok) throw new Error(`Fetch failed (${res.status}): ${url}`)
  return res.json()
}

// Splits Wikipedia's plaintext extract (which keeps "== Section ==" / "=== Sub ==="
// markers) into { title, paragraphs[] } blocks so we can pull from the WHOLE
// article, not just the date-heavy lead section — later sections ("Later life",
// "Legacy", "Death") are where the more surprising, less chronological facts live.
function splitIntoSections(fullText) {
  const sections = [{ title: 'Intro', paragraphs: [] }]
  for (const line of fullText.split('\n')) {
    const heading = line.match(/^=+\s*(.+?)\s*=+$/)
    if (heading) {
      sections.push({ title: heading[1], paragraphs: [] })
    } else if (line.trim()) {
      sections[sections.length - 1].paragraphs.push(line.trim())
    }
  }
  return sections.filter(s => s.paragraphs.length > 0 && !SKIP_SECTIONS.test(s.title))
}

// Later-life/legacy sections are where the surprising, less-chronological
// human-interest facts tend to live (e.g. a benefactor quietly paying rent for
// a decade) — a purely even spread across sections can miss that section
// entirely depending on section-count arithmetic, so it's explicitly favored.
const HUMAN_INTEREST_PATTERN = /later|legacy|death|assault|honor|controvers/i

function pickAcrossArticle(sections, maxCards) {
  const picks = []
  const used = new Set()

  // Always lead with the intro.
  if (sections[0]?.paragraphs.length) {
    picks.push({ section: 0 })
    used.add(0)
  }

  // Guarantee one human-interest section if the article has one.
  const interestingIdx = sections.findIndex((s, i) => !used.has(i) && HUMAN_INTEREST_PATTERN.test(s.title))
  if (interestingIdx !== -1 && picks.length < maxCards) {
    picks.push({ section: interestingIdx })
    used.add(interestingIdx)
  }

  // Fill the rest evenly across whatever sections remain.
  const remaining = sections.map((_, i) => i).filter(i => !used.has(i))
  const count = Math.min(maxCards - picks.length, remaining.length)
  for (let i = 0; i < count; i++) {
    const idx = remaining[Math.floor((i * remaining.length) / count)]
    picks.push({ section: idx })
    used.add(idx)
  }

  // Within each picked section (except the intro, which should stay the actual
  // opening sentence), take the LAST paragraph rather than the first —
  // chronological sections often open with a date-and-event sentence and save
  // the more notable/human aside for the end (true of the Ilitch rent story,
  // the 3rd of 3 paragraphs in Rosa Parks's "1990s"). Keep final narration in
  // article order, not selection order.
  return picks
    .sort((a, b) => a.section - b.section)
    .map(({ section }) => {
      const s = sections[section]
      const isIntro = s.title === 'Intro'
      return { headline: isIntro ? null : s.title, body: isIntro ? s.paragraphs[0] : s.paragraphs[s.paragraphs.length - 1] }
    })
}

async function fetchWikipedia(title) {
  const summary = await fetchJson(
    `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`
  )
  if (summary.type === 'disambiguation') {
    throw new Error(`"${title}" is a disambiguation page — use a more specific title`)
  }

  const extractData = await fetchJson(
    `https://en.wikipedia.org/w/api.php?action=query&prop=extracts&explaintext=1&format=json&titles=${encodeURIComponent(summary.title)}`
  )
  const page = Object.values(extractData.query.pages)[0]
  const fullExtract = page.extract || summary.extract || ''

  const sections = splitIntoSections(fullExtract)
  const cards = pickAcrossArticle(sections, MAX_CARDS)

  return {
    title: summary.title,
    description: summary.description || '',
    pageUrl: summary.content_urls?.desktop?.page,
    cards,
  }
}

function stripHtml(html) {
  const text = (html || '').replace(/<[^>]+>/g, '').trim()
  // Commons' "Creator" template often renders the name twice (once visible,
  // once for embedded schema.org microdata) — collapse an exact doubled string.
  const half = text.slice(0, text.length / 2)
  return text.length % 2 === 0 && half + half === text ? half : text
}

const SKIP_FILE_PATTERN = /commons-logo|wiki.*logo|edit-icon|folder|ambox|question_book|padlock|disambig|nuvola|crystal_clear|red_x|green_tick|semi-protection/i

// Maps each section title to the filenames of images that actually appear
// within that section in the wikitext — so a card pulled from "Montgomery bus
// boycott" gets an image that literally sits inside that section, not just
// "some image from roughly the same area of the article." `prop=images` (used
// in an earlier version of this script) doesn't preserve reading order at all
// (it's closer to alphabetical) and doesn't carry per-section position, so this
// scans the raw wikitext directly instead.
async function fetchSectionImageMap(title) {
  const wikiData = await fetchJson(
    `https://en.wikipedia.org/w/api.php?action=parse&prop=wikitext&format=json&page=${encodeURIComponent(title)}`
  )
  const wikitext = wikiData.parse?.wikitext?.['*'] || ''
  const linkPattern = /\[\[\s*(?:File|Image)\s*:\s*([^|\]]+)/gi

  const map = { Intro: [] }
  let current = 'Intro'
  for (const line of wikitext.split('\n')) {
    const heading = line.match(/^=+\s*(.+?)\s*=+$/)
    if (heading) {
      current = heading[1].trim()
      if (!map[current]) map[current] = []
      continue
    }
    let match
    while ((match = linkPattern.exec(line))) {
      map[current].push(match[1].trim().replace(/ /g, '_'))
    }
  }
  return map
}

// Infobox portraits are usually a bare filename parameter (`| image = Foo.jpg`)
// inside the template, not a `[[File:...]]` link — `pageimages` is the reliable
// way to get it, separately from the section scan above.
async function fetchLeadImageName(title) {
  const data = await fetchJson(
    `https://en.wikipedia.org/w/api.php?action=query&prop=pageimages&piprop=name&format=json&titles=${encodeURIComponent(title)}`
  )
  return Object.values(data.query.pages)[0]?.pageimage || null
}

async function fetchCommonsInfo(fileName) {
  const commonsData = await fetchJson(
    `https://commons.wikimedia.org/w/api.php?action=query&titles=${encodeURIComponent('File:' + fileName)}&prop=imageinfo&iiprop=extmetadata%7Curl%7Csize&format=json`
  )
  const info = Object.values(commonsData.query.pages)[0]?.imageinfo?.[0]
  if (!info?.url || info.width < 200) return null // skip small icons
  const meta = info.extmetadata || {}
  return {
    url: info.url,
    sourceUrl: info.descriptionurl || info.url,
    attribution: stripHtml(meta.Artist?.value) || stripHtml(meta.Credit?.value) || 'Wikimedia Commons',
    license: stripHtml(meta.LicenseShortName?.value) || null,
  }
}

// Resolves one image per card, preferring an image from that card's own
// section, falling back to nearby sections, then the lead portrait, then
// nothing — rather than one global pool cycled independently of content.
// Prefers not to repeat an image across cards when the section has more than
// one available; only reuses one (in a second pass) rather than show nothing.
async function resolveImagesForCards(title, cards) {
  const [sectionMap, leadFile] = await Promise.all([
    fetchSectionImageMap(title).catch(() => ({ Intro: [] })),
    fetchLeadImageName(title).catch(() => null),
  ])
  if (leadFile) sectionMap.Intro = [leadFile, ...sectionMap.Intro]

  const sectionTitles = Object.keys(sectionMap)
  const resolvedCache = new Map() // fileName -> imageInfo | null (null = tried and failed)
  const usedFileNames = new Set()

  async function resolve(name) {
    if (!resolvedCache.has(name)) {
      resolvedCache.set(name, await fetchCommonsInfo(name).catch(() => null))
    }
    return resolvedCache.get(name)
  }

  function searchOrderFor(sectionTitle) {
    const ownIndex = sectionTitles.indexOf(sectionTitle)
    if (ownIndex === -1) return sectionTitles
    return [...sectionTitles].sort(
      (a, b) =>
        Math.abs(sectionTitles.indexOf(a) - ownIndex) - Math.abs(sectionTitles.indexOf(b) - ownIndex)
    )
  }

  function ownCandidates(card) {
    return (sectionMap[card.headline || 'Intro'] || []).filter(
      name => /\.(jpe?g|png)$/i.test(name) && !SKIP_FILE_PATTERN.test(name)
    )
  }

  const results = new Array(cards.length).fill(null)

  // Phase 1: every card gets first crack at an image from its OWN section,
  // before any card is allowed to borrow from a neighbor. Without this, an
  // early card with no images of its own could search outward and grab a
  // later card's rightful, exactly-matching image before that card's turn —
  // e.g. an "Early life" card stealing the boycott section's own boycott
  // photo, leaving the actual boycott card with something unrelated.
  for (let i = 0; i < cards.length; i++) {
    for (const name of ownCandidates(cards[i])) {
      if (usedFileNames.has(name)) continue
      const info = await resolve(name)
      if (info) {
        results[i] = { name, info }
        usedFileNames.add(name)
        break
      }
    }
  }

  // Phase 2: any card still without an image searches outward to neighboring
  // sections (preferring unused images, then allowing reuse as a last resort).
  for (let i = 0; i < cards.length; i++) {
    if (results[i]) continue
    const order = searchOrderFor(cards[i].headline || 'Intro')
    search: for (const reuseAllowed of [false, true]) {
      for (const sectionTitle of order) {
        const candidates = sectionMap[sectionTitle].filter(
          name =>
            /\.(jpe?g|png)$/i.test(name) &&
            !SKIP_FILE_PATTERN.test(name) &&
            (reuseAllowed || !usedFileNames.has(name))
        )
        for (const name of candidates) {
          const info = await resolve(name)
          if (info) {
            results[i] = { name, info }
            usedFileNames.add(name)
            break search
          }
        }
      }
    }
  }

  return results.map(r => r?.info ?? null)
}

async function main() {
  const [, , topicArg, domainSlug = 'history'] = process.argv
  if (!topicArg) {
    console.error('Usage: node scripts/generate-lesson.mjs "<Wikipedia page title>" [domainSlug]')
    process.exit(1)
  }

  console.log(`Fetching "${topicArg}" from Wikipedia…`)
  const { title, description, pageUrl, cards } = await fetchWikipedia(topicArg)
  if (!pageUrl) throw new Error('No source URL returned — refusing to write unsourced content')
  if (cards.length === 0) throw new Error('No content retrieved — nothing to write')
  console.log(`Retrieved "${title}" — ${cards.length} card(s) spread across the article from ${pageUrl}`)

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

  let perCardImages = cards.map(() => null)
  try {
    perCardImages = await resolveImagesForCards(title, cards)
    console.log(`Matched images for ${perCardImages.filter(Boolean).length}/${cards.length} card(s) to their own section`)
  } catch (e) {
    console.warn(`Image matching failed, continuing without images: ${e.message}`)
  }

  cards.forEach(({ headline, body }, i) => {
    const image = perCardImages[i]
    let imageId = null
    if (image) {
      const existing = db.exec('SELECT id FROM images WHERE url = ?', [image.url])[0]
      if (existing) {
        imageId = existing.values[0][0]
        db.run('UPDATE images SET attribution = ?, license = ? WHERE id = ?', [
          image.attribution, image.license, imageId,
        ])
      } else {
        db.run(
          `INSERT INTO images (url, alt_text, attribution, source_url, license, is_photo, depicts_named_real_person, created_at)
           VALUES (?, ?, ?, ?, ?, 1, 0, ?)`,
          [image.url, title, image.attribution, image.sourceUrl, image.license, now]
        )
        imageId = db.exec('SELECT last_insert_rowid() AS id')[0].values[0][0]
      }
    }
    db.run(
      "INSERT INTO cards (lesson_id, position, card_type, headline, body, image_id, created_at) VALUES (?, ?, 'text', ?, ?, ?, ?)",
      [lessonId, i, headline, body, imageId, now]
    )
    const cardId = db.exec('SELECT last_insert_rowid() AS id')[0].values[0][0]
    db.run('INSERT OR IGNORE INTO card_sources (card_id, source_id) VALUES (?, ?)', [cardId, sourceId])
  })

  db.run(
    `INSERT INTO search_cache (topic_id, query, provider, raw_response, retrieved_at)
     VALUES (?, ?, 'wikipedia_rest_api', ?, ?)`,
    [topicId, topicArg, JSON.stringify({ title, description, pageUrl, cards }), now]
  )

  fs.writeFileSync(DB_PATH, Buffer.from(db.export()))
  db.close()

  console.log(`\n✔ Wrote topic "${title}" (id ${topicId}), lesson id ${lessonId}, ${cards.length} card(s)`)
  console.log(`  Source: ${pageUrl}`)
  console.log(`  Saved to ${DB_PATH}`)
}

main().catch(err => {
  console.error('\n✘', err.message)
  process.exit(1)
})
