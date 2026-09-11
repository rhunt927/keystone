#!/usr/bin/env node
// One-off migration, run once right after drive-auth.mjs's Picker step: the
// new drive.file-scoped grant only covers the "keystone" folder itself and
// whatever gets created under it going forward — it does NOT retroactively
// see keystone.db or the existing audio/ tree, which were created before
// this narrower scope existed. This script re-uploads all of that under the
// new scope so it becomes "app created" and visible from now on.
//
// Reads the OLD (wide-scope) refresh token from a temp backup file rather
// than .env, since drive-auth.mjs already overwrote .env with the new one.
//
// Usage: node scripts/migrate-to-narrow-scope.mjs [path-to-old-token-backup]

import fs from 'node:fs'
import { readEnv } from './lib/env.mjs'
import { getAccessToken } from './lib/driveAuth.mjs'
import { findOrCreateFolder, findFile, listChildren, downloadFile, uploadFile } from './lib/drive.mjs'

const DEFAULT_BACKUP_PATH = '/tmp/keystone-old-drive-token.bak'

function extractToken(line) {
  return line.split('=').slice(1).join('=').trim()
}

async function copyFolderTree(oldToken, newToken, oldFolderId, newParentId, label) {
  const children = await listChildren(oldToken, oldFolderId)
  let filesCopied = 0
  for (const child of children) {
    if (child.mimeType === 'application/vnd.google-apps.folder') {
      const newChildId = await findOrCreateFolder(newToken, child.name, newParentId)
      filesCopied += await copyFolderTree(oldToken, newToken, child.id, newChildId, `${label}/${child.name}`)
    } else {
      const bytes = await downloadFile(oldToken, child.id)
      await uploadFile(newToken, {
        name: child.name,
        parentId: newParentId,
        mimeType: child.mimeType,
        buffer: bytes,
      })
      filesCopied++
      console.log(`  ${label}/${child.name} (${(bytes.length / 1024).toFixed(0)} KB)`)
    }
  }
  return filesCopied
}

async function main() {
  const backupPath = process.argv[2] || DEFAULT_BACKUP_PATH
  const oldTokenLine = fs.readFileSync(backupPath, 'utf8').trim()
  const oldRefreshToken = extractToken(oldTokenLine)

  const newFolderId = readEnv('GOOGLE_DRIVE_FOLDER_ID')
  if (!newFolderId) throw new Error('GOOGLE_DRIVE_FOLDER_ID not in .env — run drive-auth.mjs (the Picker step) first.')

  console.log('Getting an access token under the OLD (wide) scope, to read existing content…')
  const oldToken = await getAccessToken(oldRefreshToken)
  console.log('Getting an access token under the NEW (drive.file) scope, to write it back…')
  const newToken = await getAccessToken()

  // Find the OLD keystone folder by name (only possible under the wide scope).
  const search = await fetch(
    `https://www.googleapis.com/drive/v3/files?q=name='keystone' and mimeType='application/vnd.google-apps.folder' and trashed=false&fields=files(id)`,
    { headers: { Authorization: `Bearer ${oldToken}` } }
  ).then(r => r.json())
  const oldFolderId = search.files?.[0]?.id
  if (!oldFolderId) throw new Error('Could not find the old "keystone" folder under the wide-scope token.')

  console.log('\nCopying keystone.db…')
  const dbFileId = await findFile(oldToken, 'keystone.db', oldFolderId)
  if (dbFileId) {
    const dbBytes = await downloadFile(oldToken, dbFileId)
    await uploadFile(newToken, {
      name: 'keystone.db',
      parentId: newFolderId,
      mimeType: 'application/octet-stream',
      buffer: dbBytes,
    })
    console.log(`  keystone.db (${(dbBytes.length / 1024).toFixed(0)} KB) copied.`)
  } else {
    console.warn('  keystone.db not found under the old scope either — skipping (unexpected).')
  }

  console.log('\nCopying the audio/ tree (this walks every lesson — may take a couple of minutes)…')
  const oldAudioId = await findFile(oldToken, 'audio', oldFolderId)
  if (oldAudioId) {
    const newAudioId = await findOrCreateFolder(newToken, 'audio', newFolderId)
    const count = await copyFolderTree(oldToken, newToken, oldAudioId, newAudioId, 'audio')
    console.log(`\n  ${count} audio file(s) copied.`)
  } else {
    console.warn('  No audio/ folder found under the old scope — skipping.')
  }

  // Verify with a fresh token under the new scope.
  const verifyToken = await getAccessToken()
  const verify = await fetch(
    `https://www.googleapis.com/drive/v3/files?q=name='keystone.db' and trashed=false&fields=files(id,name)`,
    { headers: { Authorization: `Bearer ${verifyToken}` } }
  ).then(r => r.json())
  console.log(verify.files?.length
    ? `\n✔ keystone.db is now visible under the new narrow scope. Migration complete.`
    : `\n✘ Still not visible — something's off, don't delete the old token backup yet.`)

  if (verify.files?.length) {
    fs.unlinkSync(backupPath)
    console.log(`  Deleted the temporary old-token backup (${backupPath}).`)
    console.log(`  The old, wide-scope copies of keystone.db and audio/ are still sitting in Drive under the`)
    console.log(`  old grant — harmless leftovers (the wide-scope refresh token itself is what you'd revoke`)
    console.log(`  at myaccount.google.com/permissions if you want to fully retire it); delete them by hand`)
    console.log(`  in Drive's UI whenever you like, no rush.`)
  }
}

main().catch(err => {
  console.error('\n✘', err.message)
  process.exit(1)
})
