/**
 * Create datasets and dataset_filters tables.
 *
 * A dataset is a named collection of entity/metadata filters (key + op + value)
 * that narrows down the entity result set. Datasets are the foundation for
 * saved views and graphs.
 *
 * datasets
 *   id    — surrogate primary key
 *   name  — human-readable label chosen by the user
 *
 * dataset_filters
 *   id         — surrogate primary key
 *   dataset_id — FK to datasets, cascades on delete
 *   key        — metadata key (or 'entity_name')
 *   op         — filter operation: 'eq' | 'contains' | 'gte' | 'lte' | 're'
 *   value      — filter value
 *   filter_order — preserves the order in which filters were added
 */

export const sqlite = {
  up: `
    CREATE TABLE datasets (
      id   INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL
    );

    CREATE TABLE dataset_filters (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      dataset_id INTEGER NOT NULL REFERENCES datasets(id) ON DELETE CASCADE,
      key        TEXT    NOT NULL,
      op         TEXT    NOT NULL,
      value      TEXT    NOT NULL,
      filter_order INTEGER NOT NULL DEFAULT 0
    );

    CREATE INDEX idx_dataset_filters_dataset_id ON dataset_filters(dataset_id);
  `,
  down: `
    DROP TABLE IF EXISTS dataset_filters;
    DROP TABLE IF EXISTS datasets;
  `,
};

export const postgres = {
  up: `
    CREATE TABLE datasets (
      id   SERIAL PRIMARY KEY,
      name TEXT NOT NULL
    );

    CREATE TABLE dataset_filters (
      id         SERIAL  PRIMARY KEY,
      dataset_id INTEGER NOT NULL REFERENCES datasets(id) ON DELETE CASCADE,
      key        TEXT    NOT NULL,
      op         TEXT    NOT NULL,
      value      TEXT    NOT NULL,
      filter_order INTEGER NOT NULL DEFAULT 0
    );

    CREATE INDEX idx_dataset_filters_dataset_id ON dataset_filters(dataset_id);
  `,
  down: `
    DROP TABLE IF EXISTS dataset_filters;
    DROP TABLE IF EXISTS datasets;
  `,
};
