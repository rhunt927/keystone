// Mints a fresh Drive access token from a long-lived refresh token, so the
// authoring scripts (load-lesson.mjs, narrate-lesson.mjs) can read/write
// keystone.db and its audio over the Drive REST API — the same thing the
// deployed app does — instead of assuming a local Drive-synced folder. That's
// what makes them runnable from *any* machine (a cloud/remote Claude Code
// session, not just this Mac), which is the whole point: authoring a lesson
// no longer requires being at this laptop.
//
// One-time setup: run `node scripts/drive-auth.mjs` on a machine with a
// browser (this Mac) to mint the refresh token once; after that, copy the
// three GOOGLE_DRIVE_* lines from .env into wherever else you want to run
// these scripts from. Note: while the OAuth consent screen is in "Testing"
// status, Google expires this refresh token after 7 days — re-run
// drive-auth.mjs when it stops working.
import { readEnv } from './env.mjs'

export async function getAccessToken() {
  const clientId = readEnv('GOOGLE_DRIVE_CLIENT_ID')
  const clientSecret = readEnv('GOOGLE_DRIVE_CLIENT_SECRET')
  const refreshToken = readEnv('GOOGLE_DRIVE_REFRESH_TOKEN')
  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error(
      'Missing GOOGLE_DRIVE_CLIENT_ID / GOOGLE_DRIVE_CLIENT_SECRET / GOOGLE_DRIVE_REFRESH_TOKEN in .env — run `node scripts/drive-auth.mjs` first.'
    )
  }

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  })
  const data = await res.json()
  if (!res.ok) {
    throw new Error(
      `Couldn't refresh a Drive access token (${res.status}): ${data.error_description || data.error || JSON.stringify(data)}. ` +
      `If this says the token is invalid/expired, re-run \`node scripts/drive-auth.mjs\`.`
    )
  }
  return data.access_token
}
