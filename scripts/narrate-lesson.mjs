#!/usr/bin/env node
// Pre-generates studio-quality narration audio for an authored lesson, once, at
// authoring time. Google Cloud Text-to-Speech; the character cost is spent here
// and never again — the app just plays the resulting MP3s (stored in Drive).
//
// Needs GOOGLE_TTS_API_KEY in .env (gitignored; NOT VITE_-prefixed so it never
// reaches the app bundle).
//
// Usage: node scripts/narrate-lesson.mjs black-death [--force]

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import initSqlJs from 'sql.js'
import { runMigrations } from '../src/lib/migrate.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(__dirname, '..')
const SCHEMA_PATH = path.join(REPO_ROOT, 'db', 'schema.sql')
const DRIVE_BASE = '/Users/rhunt/Library/CloudStorage/GoogleDrive-rghunt@gmail.com/My Drive/keystone'
const DB_PATH = path.join(DRIVE_BASE, 'keystone.db')

const DEFAULT_VOICE = 'en-US-Studio-Q' // warm male narrator; override per lesson with topic.voice

function readEnv(key) {
  try {
    const line = fs.readFileSync(path.join(REPO_ROOT, '.env'), 'utf8')
      .split('\n')
      .find(l => l.startsWith(key + '='))
    return line ? line.slice(key.length + 1).trim() : null
  } catch {
    return null
  }
}

async function synthesize(text, voiceName, apiKey) {
  const res = await fetch(
    `https://texttospeech.googleapis.com/v1/text:synthesize?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        input: { text },
        voice: { languageCode: voiceName.slice(0, 5), name: voiceName },
        audioConfig: { audioEncoding: 'MP3', speakingRate: 1.0 },
      }),
    }
  )
  const data = await res.json()
  if (!res.ok || !data.audioContent) {
    throw new Error(`TTS failed (${res.status}): ${JSON.stringify(data.error || data).slice(0, 300)}`)
  }
  return Buffer.from(data.audioContent, 'base64')
}

async function main() {
  const slug = process.argv[2]
  const force = process.argv.includes('--force')
  if (!slug) {
    console.error('Usage: node scripts/narrate-lesson.mjs <lesson-slug> [--force]')
    process.exit(1)
  }

  const apiKey = readEnv('GOOGLE_TTS_API_KEY')
  if (!apiKey) throw new Error('GOOGLE_TTS_API_KEY not found in .env')

  const doc = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'db', 'lessons', `${slug}.json`), 'utf8'))
  const voiceName = doc.topic.voice || DEFAULT_VOICE
  const outDir = path.join(DRIVE_BASE, 'audio', slug)
  fs.mkdirSync(outDir, { recursive: true })

  console.log(`Narrating "${doc.topic.title}" — ${doc.beats.length} beat(s), voice ${voiceName}`)

  let charsUsed = 0
  let generated = 0
  for (let i = 0; i < doc.beats.length; i++) {
    const outPath = path.join(outDir, `beat-${i}.mp3`)
    if (fs.existsSync(outPath) && !force) {
      console.log(`  beat ${i}: exists, skipping`)
      continue
    }
    const text = doc.beats[i].body
    const mp3 = await synthesize(text, voiceName, apiKey)
    fs.writeFileSync(outPath, mp3)
    charsUsed += text.length
    generated++
    console.log(`  beat ${i}: ${text.length} chars -> ${(mp3.length / 1024).toFixed(0)} KB`)
  }

  // Mark the beats as having audio (by convention, path relative to keystone/audio/).
  const SQL = await initSqlJs({
    locateFile: f => path.join(REPO_ROOT, 'node_modules', 'sql.js', 'dist', f),
  })
  const db = new SQL.Database(fs.readFileSync(DB_PATH))
  db.run(fs.readFileSync(SCHEMA_PATH, 'utf8'))
  runMigrations(db)
  const lessonId = db.exec(
    `SELECT l.id FROM lessons l JOIN topics t ON t.id = l.topic_id
     WHERE t.slug = ? AND l.kind = 'overview'`,
    [slug]
  )[0]?.values[0][0]
  if (lessonId) {
    const cards = db.exec('SELECT id, position FROM cards WHERE lesson_id = ? ORDER BY position', [lessonId])[0]
    for (const [id, position] of cards?.values || []) {
      db.run('UPDATE cards SET audio_path = ? WHERE id = ?', [`${slug}/beat-${position}.mp3`, id])
    }
    fs.writeFileSync(DB_PATH, Buffer.from(db.export()))
  }
  db.close()

  console.log(`\n✔ ${generated} beat(s) generated, ${charsUsed} characters used`)
  console.log(`  MP3s: ${outDir}`)
  console.log(`  (Google TTS free tier is ~1,000,000 characters/month — spent once, never on playback)`)
}

main().catch(err => {
  console.error('\n✘', err.message)
  process.exit(1)
})
