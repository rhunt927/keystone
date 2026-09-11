#!/usr/bin/env node
// One-time interactive setup: mints a Drive refresh token for the authoring
// scripts, SCOPED TO JUST THE KEYSTONE FOLDER — not your whole Drive.
//
// How: requests the narrow `drive.file` scope (access only to files the app
// creates, or files you explicitly hand it), then immediately opens Google's
// own folder-picker widget so you can hand it the `keystone` folder. A
// drive.file-scoped token that never sees that widget again can't reach
// anything outside what you picked, even if it leaked.
//
// Needs a browser, so run this once here on the Mac — the resulting
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

import http from 'node:http'
import { exec } from 'node:child_process'
import { readEnv, writeEnv } from './lib/env.mjs'

const PORT = 8991
const REDIRECT_URI = `http://localhost:${PORT}/oauth/callback`
const SCOPE = 'https://www.googleapis.com/auth/drive.file'

function html(body) {
  return `<!doctype html><html><body style="font-family:sans-serif;padding:2rem">${body}</body></html>`
}

function pickerPage(accessToken, pickerApiKey) {
  return `<!doctype html><html><body style="font-family:sans-serif;padding:2rem">
<h2>Pick the "keystone" folder</h2>
<p>This is the one-time step that limits access to just this folder. Pick "keystone" itself (not a file inside it).</p>
<div id="status">Loading the picker…</div>
<script>
function onApiLoad() { gapi.load('picker', { callback: createPicker }); }
function createPicker() {
  const view = new google.picker.DocsView(google.picker.ViewId.FOLDERS)
    .setIncludeFolders(true)
    .setSelectFolderEnabled(true)
    .setMimeTypes('application/vnd.google-apps.folder');
  const picker = new google.picker.PickerBuilder()
    .addView(view)
    .setOAuthToken(${JSON.stringify(accessToken)})
    .setDeveloperKey(${JSON.stringify(pickerApiKey)})
    .setTitle('Select the keystone folder')
    .setCallback(pickerCallback)
    .build();
  picker.setVisible(true);
  document.getElementById('status').innerText = '';
}
function pickerCallback(data) {
  if (data.action === google.picker.Action.PICKED) {
    const folder = data.docs[0];
    document.getElementById('status').innerText = 'Granting access to "' + folder.name + '"…';
    fetch('/picker-result?folderId=' + encodeURIComponent(folder.id) + '&folderName=' + encodeURIComponent(folder.name))
      .then(() => { document.getElementById('status').innerText = 'Done — "' + folder.name + '" granted. You can close this tab.'; });
  } else if (data.action === google.picker.Action.CANCEL) {
    document.getElementById('status').innerText = 'Cancelled — close this tab and re-run the script to try again.';
  }
}
</script>
<script src="https://apis.google.com/js/api.js?onload=onApiLoad" async defer></script>
</body></html>`
}

async function main() {
  const clientId = readEnv('GOOGLE_DRIVE_CLIENT_ID')
  const clientSecret = readEnv('GOOGLE_DRIVE_CLIENT_SECRET')
  const pickerApiKey = readEnv('GOOGLE_PICKER_API_KEY')
  if (!clientId || !clientSecret) {
    console.error(
      'Missing GOOGLE_DRIVE_CLIENT_ID / GOOGLE_DRIVE_CLIENT_SECRET in .env.\n' +
      'Create a "Desktop app" OAuth client in the Keystone Google Cloud project and add both to .env.'
    )
    process.exit(1)
  }
  if (!pickerApiKey) {
    console.error(
      'Missing GOOGLE_PICKER_API_KEY in .env.\n' +
      'Enable the "Google Picker API" (APIs & Services -> Library) and create a plain API key for it\n' +
      '(APIs & Services -> Credentials -> Create Credentials -> API key), then add it to .env.'
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

    if (url.pathname === '/oauth/callback') {
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
          throw new Error(data.error_description || data.error || 'No refresh_token in response.')
        }
        writeEnv('GOOGLE_DRIVE_REFRESH_TOKEN', data.refresh_token)
        console.log('\n✔ Got a drive.file-scoped refresh token, saved to .env')
        console.log('  Now pick the keystone folder in the browser tab that opens next…')
        res.writeHead(302, { Location: `/picker?token=${encodeURIComponent(data.access_token)}` }).end()
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'text/html' }).end(html(`<p>Something went wrong: ${e.message}</p>`))
        console.error('\n✘', e.message)
        server.close()
        process.exit(1)
      }
      return
    }

    if (url.pathname === '/picker') {
      const accessToken = url.searchParams.get('token')
      res.writeHead(200, { 'Content-Type': 'text/html' }).end(pickerPage(accessToken, pickerApiKey))
      return
    }

    if (url.pathname === '/picker-result') {
      const folderId = url.searchParams.get('folderId')
      const folderName = url.searchParams.get('folderName')
      writeEnv('GOOGLE_DRIVE_FOLDER_ID', folderId)
      res.writeHead(200, { 'Content-Type': 'text/html' }).end(html('OK'))
      console.log(`✔ Granted access to "${folderName}" (id ${folderId}), saved GOOGLE_DRIVE_FOLDER_ID to .env`)
      console.log('\nVerifying the new token can see what it needs to see…')
      server.close()
      await verify(folderName)
      return
    }

    res.writeHead(404).end()
  })

  server.listen(PORT, () => {
    console.log(`Opening your browser to grant access...\nIf it doesn't open, visit:\n${authUrl}\n`)
    exec(`open "${authUrl}"`) // macOS
  })
}

// Checks whether the pre-existing keystone.db (created before this narrower
// scope existed) is visible to the new drive.file token — honest, empirical,
// rather than assumed. Reports the result either way.
async function verify(expectedFolderName) {
  const { getAccessToken } = await import('./lib/driveAuth.mjs')
  const token = await getAccessToken()
  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files?q=name='keystone.db' and trashed=false&fields=files(id,name,parents)`,
    { headers: { Authorization: `Bearer ${token}` } }
  )
  const data = await res.json()
  const found = data.files?.length > 0
  console.log(found
    ? `✔ keystone.db is visible under the new scope (${data.files.length} match(es)) — no migration needed.`
    : `✘ keystone.db is NOT visible under the new scope yet — it was created before this grant existed.\n  Run: node scripts/migrate-to-narrow-scope.mjs`)
  console.log(`\nSetup complete. Picked folder: "${expectedFolderName}".`)
  console.log('Note: while the OAuth consent screen is in "Testing" status, this refresh token')
  console.log('still expires after 7 days — just re-run this script when auth starts failing.')
}

main().catch(err => {
  console.error('\n✘', err.message)
  process.exit(1)
})
