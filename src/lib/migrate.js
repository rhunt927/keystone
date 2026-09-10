// Migrations that CREATE TABLE IF NOT EXISTS in schema.sql can't express —
// adding a column, or changing a CHECK constraint (SQLite can't ALTER either
// on an existing table). Shared by the app (useDatabase) and the CLI scripts,
// both of which run against a sql.js Database.
//
// Each migration is idempotent: it checks the current shape first and no-ops
// if already applied, so it's safe to run on every load.

function columnNames(db, table) {
  const res = db.exec(`PRAGMA table_info(${table})`)
  if (!res.length) return []
  const nameIdx = res[0].columns.indexOf('name')
  return res[0].values.map(row => row[nameIdx])
}

// cards: add visual_spec (+ drop the old card_type CHECK that predates the
// 'visual' type — needs a table rebuild), and add audio_path.
function migrateCards(db) {
  const cols = columnNames(db, 'cards')
  if (cols.length === 0) return

  if (!cols.includes('visual_spec')) {
    db.run('PRAGMA foreign_keys=OFF')
    db.run(`
      CREATE TABLE cards_new (
        id           INTEGER PRIMARY KEY,
        lesson_id    INTEGER NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
        position     INTEGER NOT NULL DEFAULT 0,
        card_type    TEXT NOT NULL DEFAULT 'text',
        headline     TEXT,
        body         TEXT,
        image_id     INTEGER REFERENCES images(id) ON DELETE SET NULL,
        visual_spec  TEXT,
        audio_path   TEXT,
        created_at   TEXT NOT NULL DEFAULT (datetime('now'))
      );
      INSERT INTO cards_new (id, lesson_id, position, card_type, headline, body, image_id, created_at)
        SELECT id, lesson_id, position, card_type, headline, body, image_id, created_at FROM cards;
      DROP TABLE cards;
      ALTER TABLE cards_new RENAME TO cards;
      CREATE INDEX IF NOT EXISTS idx_cards_lesson ON cards(lesson_id);
    `)
    db.run('PRAGMA foreign_keys=ON')
    return
  }

  if (!cols.includes('audio_path')) {
    try { db.run('ALTER TABLE cards ADD COLUMN audio_path TEXT') } catch { /* already there */ }
  }
}

export function runMigrations(db) {
  migrateCards(db)
}
