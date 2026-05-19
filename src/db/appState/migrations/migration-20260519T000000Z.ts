/**
 * Create dataset_filters table if it doesn't already exist.
 *
 * Handles databases where the initial migration ran before dataset_filters
 * was part of the schema.
 */

export const sqlite = {
  up: `
    CREATE TABLE IF NOT EXISTS dataset_filters (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      dataset_id   INTEGER NOT NULL REFERENCES datasets(id) ON DELETE CASCADE,
      key          TEXT    NOT NULL,
      op           TEXT    NOT NULL,
      value        TEXT    NOT NULL,
      filter_order INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_dataset_filters_dataset_id ON dataset_filters(dataset_id)
  `,
  down: `
    DROP TABLE IF EXISTS dataset_filters
  `,
};

export const postgres = {
  up: `
    CREATE TABLE IF NOT EXISTS dataset_filters (
      id           SERIAL  PRIMARY KEY,
      dataset_id   INTEGER NOT NULL REFERENCES datasets(id) ON DELETE CASCADE,
      key          TEXT    NOT NULL,
      op           TEXT    NOT NULL,
      value        TEXT    NOT NULL,
      filter_order INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_dataset_filters_dataset_id ON dataset_filters(dataset_id)
  `,
  down: `
    DROP TABLE IF EXISTS dataset_filters
  `,
};
