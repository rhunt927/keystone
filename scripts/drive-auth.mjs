#!/usr/bin/env node
// One-time interactive setup: mints a Drive refresh token for the authoring
// scripts (load-lesson.mjs, narrate-lesson.mjs) so they can talk to Drive
// over the API instead of assuming a local Drive-synced folder. Needs a
// browser, so run this once here on the Mac — the resulting refresh token in
// .env can then be copied into any other environment (e.g. a cloud Claude
// Code session) you want to run authoring from.
//
// Prerequisite: a Google Cloud "OAuth client ID" of type **Desktop app** in
// the Keystone project (Console -> APIs & Services -> Credentials -> Create
// Credentials -> OAuth client ID -> Desktop app). Put its two values in .env:
//   GOOGLE_DRIVE_CLIENT_ID=...
//   GOOGLE_DRIVE_CLIENT_SECRET=...
//
// Usage: node scripts/drive-auth.mjs

import http from 'node:http'
import { exec } from 'node:child_process'
import { readEnv, writeEnv } from './lib/env.mjs'

const PORT = 8991
const REDIRECT_URI = `http://localhost:${PORT}/oauth/callback`
const SCOPE = 'https://www.googleapis.com/auth/drive'

function html(body) {
  return `<!doctype html><html><body style="font-family:sans-serif;padding:2rem">${body}</body></html>`
}

async function main() {
  const clientId = readEnv('GOOGLE_DRIVE_CLIENT_ID')
  const clientSecret = readEnv('GOOGLE_DRIVE_CLIENT_SECRET')
  if (!clientId || !clientSecret) {
    console.error(
      'Missing GOOGLE_DRIVE_CLIENT_ID / GOOGLE_DRIVE_CLIENT_SECRET in .env.\n' +
      'Create a "Desktop app" OAuth client in the Keystone Google Cloud project\n' +
      '(APIs & Services -> Credentials -> Create Credentials -> OAuth client ID -> Desktop app)\n' +
      'and add both values to .env, then re-run this script.'
    )
    process.exit(1)
  }

  const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?${new URLSearchParams({
    client_id: clientId,
    redirect_uri: REDIRECT_URI,
    response_type: 'code',
    scope: SCOPE,
    access_type: 'offline',
    prompt: 'consent', // force a refresh_token even on repeat runs
  })}`

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, REDIRECT_URI)
    if (url.pathname !== '/oauth/callback') {
      res.writeHead(404).end()
      return
    }
    const code = url.searchParams.get('code')
    const error = url.searchParams.get('error')
    if (error) {
      res.writeHead(400, { 'Content-Type': 'text/html' }).end(html(`<p>Google said: ${error}. Close this tab and try again.</p>`))
      console.error(`\n✘ Google returned an error: ${error}`)
      server.close()
      process.exit(1)
    }

    try {
      const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: clientId,
          client_secret: clientSecret,
          code,
          grant_type: 'authorization_code',
          redirect_uri: REDIRECT_URI,
        }),
      })
      const data = await tokenRes.json()
      if (!tokenRes.ok || !data.refresh_token) {
        throw new Error(data.error_description || data.error || 'No refresh_token in response — did you already grant consent before without `prompt=consent`?')
      }

      writeEnv('GOOGLE_DRIVE_REFRESH_TOKEN', data.refresh_token)
      res.writeHead(200, { 'Content-Type': 'text/html' })
        .end(html('<p>✔ Drive access granted. You can close this tab and go back to the terminal.</p>'))
      console.log('\n✔ Saved GOOGLE_DRIVE_REFRESH_TOKEN to .env')
      console.log('  This is a long-lived secret — it stays local to .env (gitignored), same as GOOGLE_TTS_API_KEY.')
      console.log('  To run the authoring scripts from another machine/session, copy these three lines from .env there:')
      console.log('    GOOGLE_DRIVE_CLIENT_ID, GOOGLE_DRIVE_CLIENT_SECRET, GOOGLE_DRIVE_REFRESH_TOKEN')
      console.log('  Note: while the OAuth consent screen is in "Testing" status, this expires after 7 days —')
      console.log('  just re-run `node scripts/drive-auth.mjs` when load-lesson/narrate-lesson start failing auth.')
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'text/html' }).end(html(`<p>Something went wrong: ${e.message}</p>`))
      console.error('\n✘', e.message)
    } finally {
      server.close()
    }
  })

  server.listen(PORT, () => {
    console.log(`Opening your browser to grant Drive access...\nIf it doesn't open, visit:\n${authUrl}\n`)
    exec(`open "${authUrl}"`) // macOS
  })
}

main()
