import { Database } from 'bun:sqlite';
import { runSql } from '../sqliteUtils';

/**
 * Expected source database schema.
 *
 * Step Engine never creates or migrates the schema in a configured source
 * database — it assumes the tables below already exist. This DDL serves two
 * purposes:
 *
 *   1. Documentation: the exact schema Step Engine queries.
 *   2. In-memory bootstrap: when no source database is configured (the default),
 *      Step Engine boots an empty in-memory SQLite using this schema so the app
 *      starts without any external dependencies.
 *
 * If you are connecting Step Engine to an existing database, ensure it matches
 * this schema. The Parquet seed pipeline (`bun seed`) can populate a local
 * SQLite file with fixture data.
 *
 * ┌────────────────────────────────────────────────────────────────────────────┐
 * │  entities                                                                  │
 * │  ────────────────────────────────────────────────────────────────────────  │
 * │  id          INTEGER  PRIMARY KEY                                          │
 * │  name        TEXT     NOT NULL                                             │
 * │  type        TEXT     NOT NULL                                             │
 * │  created_at  TEXT     NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')) │
 * └────────────────────────────────────────────────────────────────────────────┘
 *
 * ┌──────────────────────────────────────────────────────────────────────────────┐
 * │  entity_metadata                                                             │
 * │  ──────────────────────────────────────────────────────────────────────────  │
 * │  id           INTEGER   PRIMARY KEY AUTOINCREMENT                            │
 * │  entity_id    INTEGER   NOT NULL  REFERENCES entities(id) ON DELETE CASCADE  │
 * │  key          TEXT      NOT NULL                                             │
 * │  value        TEXT      (nullable)                                           │
 * │  value_type   TEXT      NOT NULL  ('string' | 'number' | 'date' | 'boolean') │
 * │  created_at   TEXT      NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')) │
 * │  updated_at   TEXT      NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')) │
 * │  UNIQUE(entity_id, key)                                                      │
 * └──────────────────────────────────────────────────────────────────────────────┘
 *
 * Indexes: idx_metadata_entity_id (entity_id), idx_metadata_key_value (key, value)
 */
export const SOURCE_SCHEMA_DDL = `
  CREATE TABLE IF NOT EXISTS entities (
    id         INTEGER PRIMARY KEY,
    name       TEXT    NOT NULL,
    type       TEXT    NOT NULL,
    created_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
  );

  CREATE TABLE IF NOT EXISTS entity_metadata (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    entity_id   INTEGER NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
    key         TEXT    NOT NULL,
    value       TEXT,
    value_type  TEXT    NOT NULL,
    created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    updated_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    UNIQUE(entity_id, key)
  );

  CREATE INDEX IF NOT EXISTS idx_metadata_entity_id ON entity_metadata(entity_id);
  CREATE INDEX IF NOT EXISTS idx_metadata_key_value  ON entity_metadata(key, value);
`;

/** Apply the source schema to a SQLite database (used for in-memory bootstrap only). */
export function applySourceSchema(db: Database): void {
  runSql(db, SOURCE_SCHEMA_DDL);
}
