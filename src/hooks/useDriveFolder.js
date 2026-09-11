import { useCallback, useState } from 'react'
import { pickFolder } from '../lib/googlePicker'

const STORAGE_KEY = 'ks_drive_folder_id'

async function hasKeystoneDb(token, folderId) {
  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files?q=name='keystone.db' and '${folderId}' in parents and trashed=false&fields=files(id)`,
    { headers: { Authorization: `Bearer ${token}` } }
  )
  const data = await res.json()
  return (data.files || []).length > 0
}

// One-time-per-device grant: under the narrow drive.file scope, the app
// can't discover the existing "keystone" folder by search — you hand it over
// explicitly, once, through Google's own picker. The chosen folder id is
// remembered in localStorage so this never happens again on this device
// unless access is revoked.
export function useDriveFolder(accessToken) {
  const [folderId, setFolderId] = useState(() => localStorage.getItem(STORAGE_KEY))
  const [picking, setPicking] = useState(false)
  const [error, setError] = useState(null)

  const pick = useCallback(async () => {
    if (!accessToken) return
    setPicking(true)
    setError(null)
    try {
      const folder = await pickFolder(accessToken)
      if (!folder) { setPicking(false); return } // cancelled
      const looksRight = await hasKeystoneDb(accessToken, folder.id).catch(() => false)
      if (!looksRight) {
        setError(`"${folder.name}" doesn't look like the keystone folder (no keystone.db inside it) — try again and pick the folder named "keystone".`)
        setPicking(false)
        return
      }
      localStorage.setItem(STORAGE_KEY, folder.id)
      setFolderId(folder.id)
    } catch {
      setError("Couldn't open the folder picker — check your connection and try again.")
    } finally {
      setPicking(false)
    }
  }, [accessToken])

  return { folderId, picking, error, pick }
}
