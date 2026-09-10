-- Keystone database schema
-- SQLite, designed for sql.js in the browser (same pattern as hunt-garcia-tracker),
-- with the .db file itself living in Google Drive (synced via Drive Desktop today,
-- Drive API OAuth in-app later) rather than any hosted database service.
--
-- Generic across domains (history, science, current events, ...) per project decision
-- on 2026-09-09 — domain is a first-class table, not hardcoded to history.

PRAGMA foreign_keys = ON;

-- ---------------------------------------------------------------------------
-- Meta / schema versioning (mirrors the migration-tracking pattern used in
-- hunt-garcia-tracker) so future app code can detect and migrate old DB files.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS schema_meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- ---------------------------------------------------------------------------
-- Domains — top-level subject areas (History, Science, Current Events, ...).
-- Keeps the schema generic instead of history-specific.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS domains (
  id          INTEGER PRIMARY KEY,
  slug        TEXT UNIQUE NOT NULL,
  name        TEXT NOT NULL,
  description TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ---------------------------------------------------------------------------
-- Topics — a single learnable subject within a domain (e.g. "Rosa Parks",
-- "The Krebs Cycle"). This is the unit the search-grounding pipeline runs on.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS topics (
  id                INTEGER PRIMARY KEY,
  domain_id         INTEGER NOT NULL REFERENCES domains(id) ON DELETE RESTRICT,
  slug              TEXT UNIQUE NOT NULL,
  title             TEXT NOT NULL,
  one_line_summary  TEXT,
  status            TEXT NOT NULL DEFAULT 'draft'
                       CHECK (status IN ('draft', 'ready', 'archived')),
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at        TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_topics_domain ON topics(domain_id);

-- ---------------------------------------------------------------------------
-- Paths — themed, ordered sequences of topics (e.g. "Civil Rights Movement").
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS paths (
  id          INTEGER PRIMARY KEY,
  domain_id   INTEGER REFERENCES domains(id) ON DELETE SET NULL,
  slug        TEXT UNIQUE NOT NULL,
  title       TEXT NOT NULL,
  description TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS path_topics (
  path_id   INTEGER NOT NULL REFERENCES paths(id) ON DELETE CASCADE,
  topic_id  INTEGER NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
  position  INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (path_id, topic_id)
);

-- ---------------------------------------------------------------------------
-- Images — real attributed photos/art only; never photorealistic AI renders
-- of a named real person (guardrail from the project brief, enforced here
-- with a CHECK rather than just left to app-layer discipline).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS images (
  id                          INTEGER PRIMARY KEY,
  url                         TEXT NOT NULL,
  alt_text                    TEXT,
  attribution                 TEXT,
  source_url                  TEXT,
  license                     TEXT,
  is_photo                    INTEGER NOT NULL DEFAULT 1 CHECK (is_photo IN (0, 1)),
  depicts_named_real_person   INTEGER NOT NULL DEFAULT 0 CHECK (depicts_named_real_person IN (0, 1)),
  created_at                  TEXT NOT NULL DEFAULT (datetime('now')),
  -- Guardrail: a named real person may only be shown via a real photo/art,
  -- never a photorealistic AI-generated image standing in as if a photo.
  CHECK (depicts_named_real_person = 0 OR is_photo = 1)
);

-- ---------------------------------------------------------------------------
-- Lessons — one topic can have an overview plus optional deep dives.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS lessons (
  id          INTEGER PRIMARY KEY,
  topic_id    INTEGER NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
  kind        TEXT NOT NULL DEFAULT 'overview'
                 CHECK (kind IN ('overview', 'deep_dive')),
  title       TEXT NOT NULL,
  position    INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_lessons_topic ON lessons(topic_id);

-- ---------------------------------------------------------------------------
-- Cards — the short-form swipeable content unit within a lesson.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS cards (
  id           INTEGER PRIMARY KEY,
  lesson_id    INTEGER NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
  position     INTEGER NOT NULL DEFAULT 0,
  card_type    TEXT NOT NULL DEFAULT 'text'
                  CHECK (card_type IN ('text', 'image', 'quote', 'stat', 'visual')),
  headline     TEXT,
  body         TEXT,
  image_id     INTEGER REFERENCES images(id) ON DELETE SET NULL,
  -- Optional motion-graphic spec (JSON) for cards that visualise sourced data
  -- rather than showing a photo — e.g. an animated spread map or a count-up.
  visual_spec  TEXT,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Idempotent add for DBs created before visual_spec existed.
-- (sql.js/SQLite raises if the column is already there — callers ignore that.)

CREATE INDEX IF NOT EXISTS idx_cards_lesson ON cards(lesson_id);

-- ---------------------------------------------------------------------------
-- Sources — every retrieved reference a card/fact can point back to.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sources (
  id            INTEGER PRIMARY KEY,
  url           TEXT UNIQUE NOT NULL,
  title         TEXT,
  publisher     TEXT,
  source_type   TEXT NOT NULL DEFAULT 'other'
                   CHECK (source_type IN ('primary', 'encyclopedic', 'academic', 'news', 'reference', 'other')),
  retrieved_at  TEXT NOT NULL DEFAULT (datetime('now')),
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Many-to-many: a card can cite multiple sources; a source can back many cards.
CREATE TABLE IF NOT EXISTS card_sources (
  card_id    INTEGER NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
  source_id  INTEGER NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
  PRIMARY KEY (card_id, source_id)
);

-- ---------------------------------------------------------------------------
-- Quizzes — retention checks per lesson.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS quiz_questions (
  id           INTEGER PRIMARY KEY,
  lesson_id    INTEGER NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
  position     INTEGER NOT NULL DEFAULT 0,
  question     TEXT NOT NULL,
  explanation  TEXT,
  source_id    INTEGER REFERENCES sources(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS quiz_options (
  id            INTEGER PRIMARY KEY,
  question_id   INTEGER NOT NULL REFERENCES quiz_questions(id) ON DELETE CASCADE,
  option_text   TEXT NOT NULL,
  is_correct    INTEGER NOT NULL DEFAULT 0 CHECK (is_correct IN (0, 1)),
  position      INTEGER NOT NULL DEFAULT 0
);

-- ---------------------------------------------------------------------------
-- Search cache — raw grounding results per topic, so the same topic isn't
-- re-searched/re-generated repeatedly (cost + consistency, per brief).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS search_cache (
  id             INTEGER PRIMARY KEY,
  topic_id       INTEGER NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
  query          TEXT NOT NULL,
  provider       TEXT NOT NULL,
  raw_response   TEXT NOT NULL,
  retrieved_at   TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at     TEXT
);

CREATE INDEX IF NOT EXISTS idx_search_cache_topic ON search_cache(topic_id);

-- ---------------------------------------------------------------------------
-- Progress — solo-use tracking, no user table needed (single Google account
-- owns this DB via Drive).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS progress (
  id               INTEGER PRIMARY KEY,
  topic_id         INTEGER NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
  lesson_id        INTEGER REFERENCES lessons(id) ON DELETE CASCADE,
  status           TEXT NOT NULL DEFAULT 'not_started'
                      CHECK (status IN ('not_started', 'in_progress', 'completed')),
  last_viewed_at   TEXT,
  quiz_best_score  REAL
);

CREATE INDEX IF NOT EXISTS idx_progress_topic ON progress(topic_id);

-- ---------------------------------------------------------------------------
-- Seed data
-- ---------------------------------------------------------------------------
INSERT OR IGNORE INTO schema_meta (key, value) VALUES ('schema_version', '1');
INSERT OR IGNORE INTO schema_meta (key, value) VALUES ('created_at', datetime('now'));

INSERT OR IGNORE INTO domains (slug, name, description) VALUES
  ('history',        'History',        'People, events, and eras'),
  ('science',        'Science',        'Concepts, discoveries, and how things work'),
  ('current-events',  'Current Events', 'Recent and ongoing developments'),
  ('arts-culture',   'Arts & Culture', 'Art, literature, music, and cultural movements');
