import type { Database } from 'bun:sqlite';

export function up(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS entities (
      id TEXT PRIMARY KEY,
      source_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS entity_metadata (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      entity_id TEXT NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
      key TEXT NOT NULL,
      value TEXT,
      value_type TEXT NOT NULL,
      UNIQUE(entity_id, key)
    );

    CREATE INDEX IF NOT EXISTS idx_metadata_entity_id ON entity_metadata(entity_id);
    CREATE INDEX IF NOT EXISTS idx_metadata_key_value ON entity_metadata(key, value);
  `);
}

export function down(db: Database): void {
  db.exec(`
    DROP TABLE IF EXISTS entity_metadata;
    DROP TABLE IF EXISTS entities;
  `);
}
