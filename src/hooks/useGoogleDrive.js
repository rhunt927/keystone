// Reads/writes keystone.db in the user's Google Drive under My Drive/keystone —
// the same folder the Drive Desktop client already syncs locally at
// ~/Library/CloudStorage/GoogleDrive-<account>/My Drive/keystone/keystone.db.
// Live app writes go through the Drive API (this file), not the desktop sync
// client, so it works the same from any device/browser.
const FOLDER_NAME = 'keystone'
const DB_FILENAME = 'keystone.db'

async function driveRequest(path, options, token) {
  const res = await fetch(`https://www.googleapis.com/drive/v3/${path}`, {
    ...options,
    headers: { Authorization: `Bearer ${token}`, ...options?.headers },
  })
  if (!res.ok) {
    const body = await res.text()
    const err = new Error(`Drive API error: ${res.status} ${body}`)
    if (res.status === 401 || res.status === 403) err.isAuthError = true
    throw err
  }
  return res
}

async function findOrCreateFolder(token) {
  const search = await driveRequest(
    `files?q=name='${FOLDER_NAME}' and mimeType='application/vnd.google-apps.folder' and trashed=false&fields=files(id)`,
    {}, token
  )
  const { files } = await search.json()
  if (files.length > 0) return files[0].id

  const res = await driveRequest('files', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: FOLDER_NAME, mimeType: 'application/vnd.google-apps.folder' }),
  }, token)
  const folder = await res.json()
  return folder.id
}

async function findDbFile(folderId, token) {
  const search = await driveRequest(
    `files?q=name='${DB_FILENAME}' and '${folderId}' in parents and trashed=false&fields=files(id)`,
    {}, token
  )
  const { files } = await search.json()
  return files.length > 0 ? files[0].id : null
}

export async function loadDatabase(token) {
  const folderId = await findOrCreateFolder(token)
  const fileId = await findDbFile(folderId, token)

  if (!fileId) return { folderId, fileId: null, data: null }

  const res = await driveRequest(`files/${fileId}?alt=media`, {}, token)
  const buffer = await res.arrayBuffer()
  return { folderId, fileId, data: new Uint8Array(buffer) }
}

// --- Pre-generated narration audio (keystone/audio/<slug>/beat-N.mp3) ---------

const folderIdCache = new Map() // "audio", "audio/<slug>" -> Drive folder id
const audioUrlCache = new Map() // relPath -> object URL

async function findChildFolder(parentId, name, token) {
  const key = `${parentId}/${name}`
  if (folderIdCache.has(key)) return folderIdCache.get(key)
  const res = await driveRequest(
    `files?q=name='${name}' and '${parentId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false&fields=files(id)`,
    {}, token
  )
  const { files } = await res.json()
  const id = files[0]?.id || null
  folderIdCache.set(key, id)
  return id
}

// relPath like "black-death/beat-3.mp3". Returns an object URL (cached), or
// null if the file isn't in Drive.
export async function fetchAudioUrl(token, relPath) {
  if (audioUrlCache.has(relPath)) return audioUrlCache.get(relPath)

  const [slug, filename] = relPath.split('/')
  const keystoneId = await findOrCreateFolder(token)
  const audioId = await findChildFolder(keystoneId, 'audio', token)
  if (!audioId) return null
  const slugId = await findChildFolder(audioId, slug, token)
  if (!slugId) return null

  const search = await driveRequest(
    `files?q=name='${filename}' and '${slugId}' in parents and trashed=false&fields=files(id)`,
    {}, token
  )
  const fileId = (await search.json()).files[0]?.id
  if (!fileId) return null

  const res = await driveRequest(`files/${fileId}?alt=media`, {}, token)
  const url = URL.createObjectURL(await res.blob())
  audioUrlCache.set(relPath, url)
  return url
}

export async function saveDatabase(token, folderId, fileId, uint8Array) {
  const blob = new Blob([uint8Array], { type: 'application/octet-stream' })
  const metadata = { name: DB_FILENAME, mimeType: 'application/octet-stream' }

  const form = new FormData()
  form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }))
  form.append('file', blob)

  if (fileId) {
    await fetch(`https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=multipart`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${token}` },
      body: form,
    })
    return fileId
  } else {
    const metadataWithParent = { ...metadata, parents: [folderId] }
    const form2 = new FormData()
    form2.append('metadata', new Blob([JSON.stringify(metadataWithParent)], { type: 'application/json' }))
    form2.append('file', blob)
    const res = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: form2,
    })
    const file = await res.json()
    return file.id
  }
}
