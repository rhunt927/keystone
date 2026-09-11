// The interactive half of Drive auth — needs a browser, so it only works
// when run somewhere a human can click through it (this Mac). Shared by the
// manual entry point (scripts/drive-auth.mjs) and the automatic
// renew-when-expired path (getValidAccessToken in driveAuth.mjs) — a routine
// renewal (folder already known) skips the picker step entirely and is just
// one click through Google's consent screen.
import http from 'node:http'
import { exec } from 'node:child_process'
import { readEnv, writeEnv } from './env.mjs'

const PORT = 8991
const REDIRECT_URI = `http://localhost:${PORT}/oauth/callback`
const SCOPE = 'https://www.googleapis.com/auth/drive.file'
const DEFAULT_TIMEOUT_MS = 3 * 60 * 1000 // give up if nobody's at the browser

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
    document.getElementById('status').innerText = 'Cancelled — close this tab and re-run to try again.';
  }
}
</script>
<script src="https://apis.google.com/js/api.js?onload=onApiLoad" async defer></script>
</body></html>`
}

// Confirms a known folder id is still reachable under a fresh token — used
// to skip the picker on a routine renewal (the grant persists across
// re-authorizations for the same client+folder, this just double-checks).
async function folderStillWorks(accessToken, folderId) {
  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files/${folderId}?fields=id,name,trashed`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  )
  if (!res.ok) return false
  const data = await res.json()
  return !data.trashed
}

// Runs the interactive loopback OAuth flow, saving a fresh
// GOOGLE_DRIVE_REFRESH_TOKEN to .env. If GOOGLE_DRIVE_FOLDER_ID is already
// known and still valid, that's all this does (one click through Google's
// consent screen). Otherwise it also shows the folder picker. Rejects after
// `timeoutMs` if nobody completes it — e.g. no browser available.
export async function runInteractiveDriveAuth({ timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const clientId = readEnv('GOOGLE_DRIVE_CLIENT_ID')
  const clientSecret = readEnv('GOOGLE_DRIVE_CLIENT_SECRET')
  const pickerApiKey = readEnv('GOOGLE_PICKER_API_KEY')
  const knownFolderId = readEnv('GOOGLE_DRIVE_FOLDER_ID')
  if (!clientId || !clientSecret) {
    throw new Error(
      'Missing GOOGLE_DRIVE_CLIENT_ID / GOOGLE_DRIVE_CLIENT_SECRET in .env — see the setup walkthrough.'
    )
  }
  if (!pickerApiKey) {
    throw new Error('Missing GOOGLE_PICKER_API_KEY in .env — see the setup walkthrough.')
  }

  const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?${new URLSearchParams({
    client_id: clientId,
    redirect_uri: REDIRECT_URI,
    response_type: 'code',
    scope: SCOPE,
    access_type: 'offline',
    prompt: 'consent', // force a refresh_token even on repeat runs
  })}`

  return new Promise((resolve, reject) => {
    let settled = false
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      server.close()
      reject(new Error(
        `Timed out waiting for the browser step (${Math.round(timeoutMs / 1000)}s). ` +
        `No browser available here? Run \`node scripts/drive-auth.mjs\` on a machine that has one, ` +
        `then copy the refreshed GOOGLE_DRIVE_REFRESH_TOKEN line from its .env into this one.`
      ))
    }, timeoutMs)

    function finish(err, result) {
      if (settled) return
      settled = true
      clearTimeout(timer)
      server.close()
      err ? reject(err) : resolve(result)
    }

    const server = http.createServer(async (req, res) => {
      const url = new URL(req.url, REDIRECT_URI)

      if (url.pathname === '/oauth/callback') {
        const code = url.searchParams.get('code')
        const error = url.searchParams.get('error')
        if (error) {
          res.writeHead(400, { 'Content-Type': 'text/html' }).end(html(`<p>Google said: ${error}. Close this tab and try again.</p>`))
          finish(new Error(`Google returned an error: ${error}`))
          return
        }
        try {
          const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
              client_id: clientId, client_secret: clientSecret, code,
              grant_type: 'authorization_code', redirect_uri: REDIRECT_URI,
            }),
          })
          const data = await tokenRes.json()
          if (!tokenRes.ok || !data.refresh_token) {
            throw new Error(data.error_description || data.error || 'No refresh_token in response.')
          }
          writeEnv('GOOGLE_DRIVE_REFRESH_TOKEN', data.refresh_token)

          if (knownFolderId && await folderStillWorks(data.access_token, knownFolderId).catch(() => false)) {
            res.writeHead(200, { 'Content-Type': 'text/html' })
              .end(html('<p>✔ Renewed. You can close this tab.</p>'))
            finish(null, { folderId: knownFolderId, renewed: true })
            return
          }

          res.writeHead(302, { Location: `/picker?token=${encodeURIComponent(data.access_token)}` }).end()
        } catch (e) {
          res.writeHead(500, { 'Content-Type': 'text/html' }).end(html(`<p>Something went wrong: ${e.message}</p>`))
          finish(e)
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
        res.writeHead(200, { 'Content-Type': 'text/html' }).end(html(`<p>✔ Granted access to "${folderName}". You can close this tab.</p>`))
        finish(null, { folderId, folderName, renewed: false })
        return
      }

      res.writeHead(404).end()
    })

    server.listen(PORT, () => {
      console.log(`Opening your browser to (re-)authorize Drive access...\nIf it doesn't open, visit:\n${authUrl}\n`)
      exec(`open "${authUrl}"`) // macOS
    })
  })
}
