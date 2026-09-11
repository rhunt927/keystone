import { useState, useEffect, useRef, useCallback } from 'react'
import initSqlJs from 'sql.js'
import sqlWasm from 'sql.js/dist/sql-wasm.wasm?url'
import schemaSql from '../../db/schema.sql?raw'
import { loadDatabase, saveDatabase } from './useGoogleDrive'
import { runMigrations } from '../lib/migrate'

// db/schema.sql is the single source of truth for new installs — it's all
// `CREATE TABLE IF NOT EXISTS` / `INSERT OR IGNORE`, so re-running it on every
// load is a safe, idempotent "create" step. Schema *changes* to existing
// tables (new columns, altered CHECK constraints) go through runMigrations.
// Returns true if the DB shape actually changed (new install, or a migration
// ran) — the caller only writes back to Drive in that case, so a plain read
// doesn't race the authoring scripts that also write keystone.db.
function applySchema(db, isNewFile) {
  db.run(schemaSql)
  const migrated = runMigrations(db)
  return isNewFile || migrated
}

// `folderId` is the keystone folder's Drive id — under the narrow drive.file
// scope, it must already be known (granted via the one-time picker in
// useDriveFolder) before this can do anything, so init waits for both.
export function useDatabase(accessToken, folderId, onAuthError) {
  const [db, setDb] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [, setTick] = useState(0)
  const driveRef = useRef({ folderId: null, fileId: null })

  useEffect(() => {
    if (!accessToken || !folderId) return
    let cancelled = false

    async function init() {
      setLoading(true)
      try {
        const SQL = await initSqlJs({ locateFile: () => sqlWasm })
        const { fileId, data } = await loadDatabase(accessToken, folderId)
        if (cancelled) return

        driveRef.current = { folderId, fileId }
        const database = data ? new SQL.Database(data) : new SQL.Database()
        const changed = applySchema(database, !data)
        setDb(database)

        // Only write back when we actually changed the shape — otherwise a
        // plain read would clobber a newer keystone.db an authoring script
        // just uploaded.
        if (changed && !cancelled) {
          const newFileId = await saveDatabase(accessToken, folderId, fileId ?? null, database.export())
          driveRef.current.fileId = newFileId
        }
      } catch (e) {
        if (cancelled) return
        if (e.isAuthError) {
          onAuthError?.()
        } else {
          setError(e.message)
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    init()
    return () => { cancelled = true }
  }, [accessToken, folderId])

  const save = useCallback(async () => {
    if (!db || !accessToken) return
    const { folderId, fileId } = driveRef.current
    const newFileId = await saveDatabase(accessToken, folderId, fileId, db.export())
    driveRef.current.fileId = newFileId
  }, [db, accessToken])

  const query = useCallback((sql, params = []) => {
    if (!db) return []
    const result = db.exec(sql, params)
    if (!result.length) return []
    const { columns, values } = result[0]
    return values.map(row => Object.fromEntries(columns.map((col, i) => [col, row[i]])))
  }, [db])

  const run = useCallback((sql, params = []) => {
    if (!db) return
    db.run(sql, params)
    setTick(t => t + 1)
  }, [db])

  return { db, loading, error, save, query, run }
}
