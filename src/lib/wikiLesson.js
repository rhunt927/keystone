// Shared, isomorphic (Node + browser) "Wikipedia topic -> lesson" pipeline.
// Pure fetch-based, no filesystem/sql.js here — that stays in the caller
// (scripts/generate-lesson.mjs for the CLI, src/lib/topicWriter.js for the
// in-app "search for a subject" / "pull a thread" flow). Free, no key: the
// same Wikimedia REST + Action APIs the authored-lesson tooling already uses.
//
// The Action API requires `&origin=*` to get a CORS header when called from
// a browser origin; it's harmless to always include it (Node ignores it).

const ORIGIN = '&origin=*'
// Wikimedia's API etiquette asks for a descriptive User-Agent; browsers treat
// it as a forbidden header and silently drop it (no error), so it's safe to
// always send — Node (the CLI script) actually gets the benefit of it.
const HEADERS = { 'User-Agent': 'keystone-app/0.1 (personal learning project; rghunt@gmail.com)' }
const MAX_CARDS = 9
const SKIP_SECTIONS = /^(references|see also|external links|further reading|bibliography|notes|sources|citations|works cited|in popular culture|film and television|music)$/i
const SKIP_FILE_PATTERN = /commons-logo|wiki.*logo|edit-icon|folder|ambox|question_book|padlock|disambig|nuvola|crystal_clear|red_x|green_tick|semi-protection/i
const HUMAN_INTEREST_PATTERN = /later|legacy|death|assault|honor|controvers/i

export function slugify(s) {
  return s.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')
}

async function fetchJson(url) {
  const res = await fetch(url, { headers: HEADERS })
  if (!res.ok) throw new Error(`Fetch failed (${res.status}): ${url}`)
  return res.json()
}

function stripHtml(html) {
  const text = (html || '').replace(/<[^>]+>/g, '').trim()
  const half = text.slice(0, text.length / 2)
  return text.length % 2 === 0 && half + half === text ? half : text
}

// Quick title/description search for a search-as-you-type UI or a
// disambiguation picker. Free, no key (Action API search).
export async function searchWikipedia(query, limit = 6) {
  if (!query?.trim()) return []
  const data = await fetchJson(
    `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(query)}&srlimit=${limit}&format=json${ORIGIN}`
  )
  return (data.query?.search || []).map(r => ({
    title: r.title,
    snippet: stripHtml(r.snippet),
  }))
}

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
// human-interest facts tend to live — a purely even spread across sections
// can miss that section entirely depending on section-count arithmetic, so
// it's explicitly favored.
function pickAcrossArticle(sections, maxCards) {
  const picks = []
  const used = new Set()

  if (sections[0]?.paragraphs.length) {
    picks.push({ section: 0 })
    used.add(0)
  }

  const interestingIdx = sections.findIndex((s, i) => !used.has(i) && HUMAN_INTEREST_PATTERN.test(s.title))
  if (interestingIdx !== -1 && picks.length < maxCards) {
    picks.push({ section: interestingIdx })
    used.add(interestingIdx)
  }

  const remaining = sections.map((_, i) => i).filter(i => !used.has(i))
  const count = Math.min(maxCards - picks.length, remaining.length)
  for (let i = 0; i < count; i++) {
    const idx = remaining[Math.floor((i * remaining.length) / count)]
    picks.push({ section: idx })
    used.add(idx)
  }

  return picks
    .sort((a, b) => a.section - b.section)
    .map(({ section }) => {
      const s = sections[section]
      const isIntro = s.title === 'Intro'
      return { headline: isIntro ? null : s.title, body: isIntro ? s.paragraphs[0] : s.paragraphs[s.paragraphs.length - 1] }
    })
}

// Fetches a Wikipedia article and chunks it into cards spread across the
// WHOLE article (not just the lead). Throws if the title resolves to a
// disambiguation page — callers should offer `searchWikipedia` results
// instead of guessing which one was meant.
export async function fetchWikipediaLesson(title) {
  const summary = await fetchJson(
    `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`
  )
  if (summary.type === 'disambiguation') {
    throw new Error(`"${title}" could mean several things — try a more specific title`)
  }

  const extractData = await fetchJson(
    `https://en.wikipedia.org/w/api.php?action=query&prop=extracts&explaintext=1&format=json&titles=${encodeURIComponent(summary.title)}${ORIGIN}`
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

async function fetchCommonsInfo(fileName) {
  const data = await fetchJson(
    `https://commons.wikimedia.org/w/api.php?action=query&titles=${encodeURIComponent('File:' + fileName)}&prop=imageinfo&iiprop=extmetadata%7Curl%7Csize&format=json${ORIGIN}`
  )
  const info = Object.values(data.query.pages)[0]?.imageinfo?.[0]
  if (!info?.url || info.width < 200) return null
  const meta = info.extmetadata || {}
  return {
    url: info.url,
    sourceUrl: info.descriptionurl || info.url,
    attribution: stripHtml(meta.Artist?.value) || stripHtml(meta.Credit?.value) || 'Wikimedia Commons',
    license: stripHtml(meta.LicenseShortName?.value) || null,
  }
}

// Maps each section title to the filenames of images that actually appear
// within that section in the wikitext, so a card pulled from one section
// gets an image that literally sits inside it. `prop=images` doesn't
// preserve reading order or carry per-section position, so this scans the
// raw wikitext directly instead.
async function fetchSectionImageMap(title) {
  const wikiData = await fetchJson(
    `https://en.wikipedia.org/w/api.php?action=parse&prop=wikitext&format=json&page=${encodeURIComponent(title)}${ORIGIN}`
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

// Infobox portraits are usually a bare filename parameter, not a
// `[[File:...]]` link — `pageimages` is the reliable way to get it.
async function fetchLeadImageName(title) {
  const data = await fetchJson(
    `https://en.wikipedia.org/w/api.php?action=query&prop=pageimages&piprop=name&format=json&titles=${encodeURIComponent(title)}${ORIGIN}`
  )
  return Object.values(data.query.pages)[0]?.pageimage || null
}

// Resolves one image per card, preferring an image from that card's own
// section, falling back to nearby sections, then the lead portrait, then
// nothing. Every card gets first claim on its own section's image before
// any card is allowed to borrow a neighbor's.
export async function resolveImagesForCards(title, cards) {
  const [sectionMap, leadFile] = await Promise.all([
    fetchSectionImageMap(title).catch(() => ({ Intro: [] })),
    fetchLeadImageName(title).catch(() => null),
  ])
  if (leadFile) sectionMap.Intro = [leadFile, ...sectionMap.Intro]

  const sectionTitles = Object.keys(sectionMap)
  const resolvedCache = new Map()
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

// The full pipeline: fetch + chunk + resolve images. Throws on disambiguation
// or a missing source URL (never write unsourced content).
export async function generateLessonFromWikipedia(title) {
  const lesson = await fetchWikipediaLesson(title)
  if (!lesson.pageUrl) throw new Error('No source URL returned — refusing to build unsourced content')
  if (lesson.cards.length === 0) throw new Error('No content retrieved — nothing to build')

  let images = lesson.cards.map(() => null)
  try {
    images = await resolveImagesForCards(lesson.title, lesson.cards)
  } catch {
    // Continue without images rather than fail the whole lesson.
  }

  return {
    ...lesson,
    cards: lesson.cards.map((c, i) => ({ ...c, image: images[i] })),
  }
}
