// Minimal Drive REST v3 client for the authoring scripts — same API surface
// the deployed app's useGoogleDrive.js uses, reimplemented here for Node
// (Buffers instead of Blobs, no browser globals). Every authoring script goes
// through this instead of a local filesystem path, so authoring works from
// any machine with network access + a valid token, not just this Mac's
// Drive-synced folder.

async function driveRequest(pathAndQuery, options, token) {
  const res = await fetch(`https://www.googleapis.com/drive/v3/${pathAndQuery}`, {
    ...options,
    headers: { Authorization: `Bearer ${token}`, ...options?.headers },
  })
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Drive API error ${res.status} on ${pathAndQuery}: ${body.slice(0, 300)}`)
  }
  return res
}

// Finds a folder by name (optionally scoped to a parent), creating it if it
// doesn't exist yet.
export async function findOrCreateFolder(token, name, parentId = null) {
  const parentClause = parentId ? ` and '${parentId}' in parents` : ''
  const search = await driveRequest(
    `files?q=name='${name}' and mimeType='application/vnd.google-apps.folder' and trashed=false${parentClause}&fields=files(id)`,
    {}, token
  )
  const { files } = await search.json()
  if (files.length > 0) return files[0].id

  const res = await driveRequest('files', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name,
      mimeType: 'application/vnd.google-apps.folder',
      ...(parentId ? { parents: [parentId] } : {}),
    }),
  }, token)
  return (await res.json()).id
}

// Walks/creates a nested folder path, e.g. ['keystone', 'audio', 'black-death'].
export async function ensureFolderPath(token, names) {
  let parentId = null
  for (const name of names) {
    parentId = await findOrCreateFolder(token, name, parentId)
  }
  return parentId
}

export async function findFile(token, name, parentId) {
  const search = await driveRequest(
    `files?q=name='${name}' and '${parentId}' in parents and trashed=false&fields=files(id)`,
    {}, token
  )
  const { files } = await search.json()
  return files.length > 0 ? files[0].id : null
}

export async function downloadFile(token, fileId) {
  const res = await driveRequest(`files/${fileId}?alt=media`, {}, token)
  return Buffer.from(await res.arrayBuffer())
}

// Creates the file if `fileId` is omitted, otherwise updates its content in
// place. Returns the file's id either way.
export async function uploadFile(token, { fileId, name, parentId, mimeType, buffer }) {
  const boundary = `keystone-${Date.now()}`
  const metadata = { name, mimeType, ...(parentId && !fileId ? { parents: [parentId] } : {}) }
  const body = Buffer.concat([
    Buffer.from(
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n` +
      `--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n`
    ),
    buffer,
    Buffer.from(`\r\n--${boundary}--`),
  ])

  const url = fileId
    ? `https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=multipart`
    : 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart'
  const res = await fetch(url, {
    method: fileId ? 'PATCH' : 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': `multipart/related; boundary=${boundary}`,
    },
    body,
  })
  if (!res.ok) {
    throw new Error(`Drive upload error ${res.status}: ${(await res.text()).slice(0, 300)}`)
  }
  return (await res.json()).id
}
