// Reads/writes keystone.db in the user's Google Drive under My Drive/keystone.
// Under the narrow drive.file scope (2026-09-11), the app can't discover
// that folder by name search — the caller (App.jsx, via useDriveFolder) hands
// in the folder id explicitly, granted once through Google's own picker.
// Everything here operates relative to that known id, never a name search
// for the top-level folder itself.
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

async function findDbFile(folderId, token) {
  const search = await driveRequest(
    `files?q=name='${DB_FILENAME}' and '${folderId}' in parents and trashed=false&fields=files(id)`,
    {}, token
  )
  const { files } = await search.json()
  return files.length > 0 ? files[0].id : null
}

// `folderId` is the keystone folder's id, already known (granted via the
// one-time picker in useDriveFolder) — never discovered by name here.
export async function loadDatabase(token, folderId) {
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
// null if the file isn't in Drive. `keystoneFolderId` is the already-known
// folder id (see loadDatabase above) — never discovered by name here.
export async function fetchAudioUrl(token, keystoneFolderId, relPath) {
  if (audioUrlCache.has(relPath)) return audioUrlCache.get(relPath)

  const [slug, filename] = relPath.split('/')
  const audioId = await findChildFolder(keystoneFolderId, 'audio', token)
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
