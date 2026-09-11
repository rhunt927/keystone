#!/usr/bin/env node
// One-time (and repeatable) interactive setup: mints a Drive refresh token
// for the authoring scripts, SCOPED TO JUST THE KEYSTONE FOLDER — not your
// whole Drive. The actual flow lives in scripts/lib/interactiveDriveAuth.mjs,
// shared with the automatic renew-when-expired path (see driveAuth.mjs's
// getValidAccessToken) — this file is just the manual entry point plus a
// health-check of the result.
//
// First run: requests the narrow `drive.file` scope, then opens Google's own
// folder-picker widget so you can hand it the `keystone` folder. A
// drive.file-scoped token that never sees that widget again can't reach
// anything outside what you picked, even if it leaked.
// Later runs (folder already known): just one click through Google's
// consent screen — no picker needed again.
//
// Needs a browser, so run this on the Mac — the resulting
// GOOGLE_DRIVE_REFRESH_TOKEN in .env can then be copied into any other
// environment (e.g. a cloud Claude Code session) you want to run authoring
// from, same as before.
//
// Prerequisites in .env (see the walkthrough for how to get each):
//   GOOGLE_DRIVE_CLIENT_ID / GOOGLE_DRIVE_CLIENT_SECRET — a "Desktop app"
//     OAuth client in the Keystone Google Cloud project.
//   GOOGLE_PICKER_API_KEY — a plain API key with the Google Picker API
//     enabled (Console -> APIs & Services -> Credentials -> Create
//     Credentials -> API key), used only to load the picker widget itself.
//
// Usage: node scripts/drive-auth.mjs

import { runInteractiveDriveAuth } from './lib/interactiveDriveAuth.mjs'
import { getAccessToken } from './lib/driveAuth.mjs'

async function verify(folderId) {
  console.log('\nVerifying the new token can see what it needs to see…')
  const token = await getAccessToken()
  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files?q=name='keystone.db' and '${folderId}' in parents and trashed=false&fields=files(id,name)`,
    { headers: { Authorization: `Bearer ${token}` } }
  )
  const data = await res.json()
  console.log(data.files?.length
    ? `✔ keystone.db is visible under the new token. All set.`
    : `✘ keystone.db is NOT visible under this grant — something's off, don't assume this worked.`)
}

async function main() {
  const result = await runInteractiveDriveAuth()
  if (result.renewed) {
    console.log('\n✔ Refresh token renewed (same folder as before) and saved to .env')
  } else {
    console.log(`\n✔ Granted access to "${result.folderName}", saved GOOGLE_DRIVE_REFRESH_TOKEN + GOOGLE_DRIVE_FOLDER_ID to .env`)
  }
  await verify(result.folderId)
  console.log('\nNote: while the OAuth consent screen is in "Testing" status, this refresh token')
  console.log('still expires after 7 days — load-lesson.mjs/narrate-lesson.mjs will now try to renew')
  console.log('it automatically when that happens; re-run this script by hand any time too.')
}

main().catch(err => {
  console.error('\n✘', err.message)
  process.exit(1)
})
