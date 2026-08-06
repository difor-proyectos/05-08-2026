-- Difor Comercial V16.57 · Esquema centralizado para Cloudflare D1
CREATE TABLE IF NOT EXISTS central_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  initialized INTEGER NOT NULL DEFAULT 0,
  revision INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT OR IGNORE INTO central_state (id, initialized, revision) VALUES (1, 0, 0);

CREATE TABLE IF NOT EXISTS central_records (
  store_name TEXT NOT NULL,
  record_id TEXT NOT NULL,
  payload TEXT,
  deleted INTEGER NOT NULL DEFAULT 0,
  revision INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  updated_by TEXT,
  PRIMARY KEY (store_name, record_id)
);
CREATE INDEX IF NOT EXISTS ix_central_records_revision ON central_records(revision);

CREATE TABLE IF NOT EXISTS central_changes (
  revision INTEGER PRIMARY KEY,
  store_name TEXT NOT NULL,
  record_id TEXT NOT NULL,
  payload TEXT,
  deleted INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL,
  updated_by TEXT
);
CREATE INDEX IF NOT EXISTS ix_central_changes_record ON central_changes(store_name, record_id, revision DESC);
