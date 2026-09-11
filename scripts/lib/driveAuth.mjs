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

// `refreshTokenOverride` lets a one-off script (e.g. a migration that needs
// to read under the OLD scope while writing under the new one) mint a token
// from a refresh token that isn't the current one in .env.
export async function getAccessToken(refreshTokenOverride) {
  const clientId = readEnv('GOOGLE_DRIVE_CLIENT_ID')
  const clientSecret = readEnv('GOOGLE_DRIVE_CLIENT_SECRET')
  const refreshToken = refreshTokenOverride || readEnv('GOOGLE_DRIVE_REFRESH_TOKEN')
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
    const err = new Error(
      `Couldn't refresh a Drive access token (${res.status}): ${data.error_description || data.error || JSON.stringify(data)}. ` +
      `If this says the token is invalid/expired, re-run \`node scripts/drive-auth.mjs\`.`
    )
    // Google's specific signal for "this refresh token is dead" (expired,
    // revoked, or — most commonly for this app — the 7-day Testing-status
    // limit) rather than some other failure (network, bad client id, etc.).
    err.isExpiredGrant = data.error === 'invalid_grant'
    throw err
  }
  return data.access_token
}

// Like getAccessToken, but if the refresh token has died, automatically runs
// the interactive re-authorization flow (one click through Google's consent
// screen — the folder is already known, so no picker needed again) and
// retries once. Only works where a browser is actually reachable (this Mac);
// elsewhere it surfaces a clear error instead of hanging.
export async function getValidAccessToken() {
  try {
    return await getAccessToken()
  } catch (e) {
    if (!e.isExpiredGrant) throw e
    console.log('\n⚠ Drive credential expired (the ~7-day limit while the app is in "Testing" status).')
    console.log('  Attempting to renew it automatically — check for a browser tab...')
    const { runInteractiveDriveAuth } = await import('./interactiveDriveAuth.mjs')
    await runInteractiveDriveAuth()
    return await getAccessToken()
  }
}
