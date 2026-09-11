#!/usr/bin/env node
// Pre-generates studio-quality narration audio for an authored lesson, once, at
// authoring time. Google Cloud Text-to-Speech; the character cost is spent here
// and never again — the app just plays the resulting MP3s (stored in Drive).
//
// Needs GOOGLE_TTS_API_KEY in .env (gitignored; NOT VITE_-prefixed so it never
// reaches the app bundle), and a Drive refresh token — see scripts/drive-auth.mjs.
// Talks to Drive over the REST API (not a local Drive-synced folder), so this
// can run from any machine with network access, not just this Mac.
//
// Usage: node scripts/narrate-lesson.mjs black-death [--force]
//        node scripts/narrate-lesson.mjs sagrada-familia hanging-chain-model [--force]
//   (second form narrates one deep dive from db/lessons/<slug>.json's
//   deep_dives array — audio is stored under its own lesson slug, matching
//   how the app looks it up for a deep-dive lesson)

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { readEnv } from './lib/env.mjs'
import { getAccessToken } from './lib/driveAuth.mjs'
import { ensureFolderPath, findFile, uploadFile } from './lib/drive.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(__dirname, '..')

const DEFAULT_VOICE = 'en-US-Studio-Q' // warm male narrator; override per lesson with topic.voice

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
  const rest = process.argv.slice(3).filter(a => a !== '--force')
  const deepDiveSlug = rest[0]
  const force = process.argv.includes('--force')
  if (!slug) {
    console.error('Usage: node scripts/narrate-lesson.mjs <lesson-slug> [deep-dive-slug] [--force]')
    process.exit(1)
  }

  const apiKey = readEnv('GOOGLE_TTS_API_KEY')
  if (!apiKey) throw new Error('GOOGLE_TTS_API_KEY not found in .env')

  const doc = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'db', 'lessons', `${slug}.json`), 'utf8'))
  const voiceName = doc.topic.voice || DEFAULT_VOICE

  let beats = doc.beats
  let title = doc.topic.title
  let audioSlug = slug
  if (deepDiveSlug) {
    const dd = (doc.deep_dives || []).find(d => d.slug === deepDiveSlug)
    if (!dd) throw new Error(`No deep dive "${deepDiveSlug}" in db/lessons/${slug}.json`)
    beats = dd.beats
    title = dd.title
    audioSlug = dd.slug
  }

  console.log('Connecting to Drive…')
  const token = await getAccessToken()
  const audioFolderId = await ensureFolderPath(token, ['keystone', 'audio', audioSlug])

  console.log(`Narrating "${title}" — ${beats.length} beat(s), voice ${voiceName}`)

  let charsUsed = 0
  let generated = 0
  for (let i = 0; i < beats.length; i++) {
    const filename = `beat-${i}.mp3`
    const existingFileId = await findFile(token, filename, audioFolderId)
    if (existingFileId && !force) {
      console.log(`  beat ${i}: exists, skipping`)
      continue
    }
    const text = beats[i].body
    const mp3 = await synthesize(text, voiceName, apiKey)
    await uploadFile(token, {
      fileId: existingFileId || undefined,
      name: filename,
      parentId: audioFolderId,
      mimeType: 'audio/mpeg',
      buffer: mp3,
    })
    charsUsed += text.length
    generated++
    console.log(`  beat ${i}: ${text.length} chars -> ${(mp3.length / 1024).toFixed(0)} KB`)
  }

  // No DB write — the app discovers audio by checking Drive for
  // keystone/audio/<slug>/beat-N.mp3 directly, so nothing races keystone.db.
  console.log(`\n✔ ${generated} beat(s) generated, ${charsUsed} characters used`)
  console.log(`  MP3s: Drive keystone/audio/${audioSlug}/`)
  console.log(`  (Google TTS free tier is ~1,000,000 characters/month — spent once, never on playback)`)
}

main().catch(err => {
  console.error('\n✘', err.message)
  process.exit(1)
})
