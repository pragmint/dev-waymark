/**
 * Add waymarks — goal-line overlays for a line-chart visualization.
 *
 * A waymark draws a line from (start_date, the visualization's actual value
 * at that date) to (end_date, target_value). The start value is never stored
 * here — it's derived at render time from the visualization's real data.
 * Multiple waymarks can exist per visualization (e.g. one set every planning
 * cycle).
 *
 * waymarks
 *   id               — surrogate primary key
 *   visualization_id — FK to visualizations, cascades on delete
 *   start_date       — ISO date the goal was set
 *   end_date         — ISO date the goal targets
 *   target_value     — the goal's value, in the chart's displayed unit
 *   applies_to       — which line this waymark tracks: 'main' or 'smoothing'
 *   label            — optional user-facing label
 *   created_at       — ISO timestamp of creation
 *   updated_at       — ISO timestamp of last update
 */

export const sqlite = {
  up: `
    CREATE TABLE waymarks (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      visualization_id INTEGER NOT NULL REFERENCES visualizations(id) ON DELETE CASCADE,
      start_date       TEXT    NOT NULL,
      end_date         TEXT    NOT NULL,
      target_value     REAL    NOT NULL,
      applies_to       TEXT    NOT NULL DEFAULT 'main' CHECK (applies_to IN ('main', 'smoothing')),
      label            TEXT,
      created_at       TEXT    NOT NULL,
      updated_at       TEXT    NOT NULL
    );

    CREATE INDEX idx_waymarks_visualization ON waymarks(visualization_id);
  `,
  down: `
    DROP TABLE IF EXISTS waymarks;
  `,
};

export const postgres = {
  up: `
    CREATE TABLE waymarks (
      id               SERIAL          PRIMARY KEY,
      visualization_id INTEGER         NOT NULL REFERENCES visualizations(id) ON DELETE CASCADE,
      start_date       TEXT            NOT NULL,
      end_date         TEXT            NOT NULL,
      target_value     DOUBLE PRECISION NOT NULL,
      applies_to       TEXT            NOT NULL DEFAULT 'main' CHECK (applies_to IN ('main', 'smoothing')),
      label            TEXT,
      created_at       TIMESTAMPTZ     NOT NULL DEFAULT now(),
      updated_at       TIMESTAMPTZ     NOT NULL DEFAULT now()
    );

    CREATE INDEX idx_waymarks_visualization ON waymarks(visualization_id);
  `,
  down: `
    DROP TABLE IF EXISTS waymarks;
  `,
};
