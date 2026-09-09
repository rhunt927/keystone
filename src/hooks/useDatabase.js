import { useState, useEffect, useRef, useCallback } from 'react'
import initSqlJs from 'sql.js'
import sqlWasm from 'sql.js/dist/sql-wasm.wasm?url'
import schemaSql from '../../db/schema.sql?raw'
import { loadDatabase, saveDatabase } from './useGoogleDrive'

// db/schema.sql is the single source of truth for the schema — it's all
// `CREATE TABLE IF NOT EXISTS` / `INSERT OR IGNORE`, so re-running it on
// every load is a safe, idempotent "create or migrate" step.
function applySchema(db) {
  db.run(schemaSql)
}

export function useDatabase(accessToken, onAuthError) {
  const [db, setDb] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [, setTick] = useState(0)
  const driveRef = useRef({ folderId: null, fileId: null })

  useEffect(() => {
    if (!accessToken) return
    let cancelled = false

    async function init() {
      setLoading(true)
      try {
        const SQL = await initSqlJs({ locateFile: () => sqlWasm })
        const { folderId, fileId, data } = await loadDatabase(accessToken)
        if (cancelled) return

        driveRef.current = { folderId, fileId }
        const database = data ? new SQL.Database(data) : new SQL.Database()
        applySchema(database)
        setDb(database)

        // Save immediately after schema apply so Drive is up to date
        // (covers both "brand new file" and "schema version bump" cases).
        const newFileId = await saveDatabase(accessToken, folderId, fileId ?? null, database.export())
        if (!cancelled) driveRef.current.fileId = newFileId
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
  }, [accessToken])

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
