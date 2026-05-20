/**
 * Create visualizations table.
 *
 * A visualization is a saved chart configuration that references a dataset and
 * describes how to aggregate and display entity metadata as a Chart.js chart.
 *
 * visualizations
 *   id          — surrogate primary key
 *   name        — human-readable label chosen by the user
 *   description — optional description
 *   dataset_id  — FK to datasets, cascades on delete
 *   config      — JSON-serialized VisualizationConfig
 *   created_at  — ISO timestamp of creation
 *   updated_at  — ISO timestamp of last update
 */

export const sqlite = {
  up: `
    CREATE TABLE visualizations (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      name        TEXT    NOT NULL,
      description TEXT,
      dataset_id  INTEGER NOT NULL REFERENCES datasets(id) ON DELETE CASCADE,
      config      TEXT    NOT NULL,
      created_at  TEXT    NOT NULL,
      updated_at  TEXT    NOT NULL
    );

    CREATE INDEX idx_visualizations_dataset_id ON visualizations(dataset_id);
  `,
  down: `
    DROP TABLE IF EXISTS visualizations;
  `,
};

export const postgres = {
  up: `
    CREATE TABLE visualizations (
      id          SERIAL      PRIMARY KEY,
      name        TEXT        NOT NULL,
      description TEXT,
      dataset_id  INTEGER     NOT NULL REFERENCES datasets(id) ON DELETE CASCADE,
      config      JSONB       NOT NULL,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE INDEX idx_visualizations_dataset_id ON visualizations(dataset_id);
  `,
  down: `
    DROP TABLE IF EXISTS visualizations;
  `,
};
