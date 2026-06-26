/**
 * Add dashboards and the dashboard_visualizations junction.
 *
 * dashboards
 *   id   — surrogate primary key
 *   name — human-readable label chosen by the user
 *
 * dashboard_visualizations
 *   dashboard_id     — FK to dashboards, cascades on delete
 *   visualization_id — FK to visualizations, cascades on delete
 *   position         — ordering within the dashboard (0-based, gapless after save)
 *
 * Existing visualization rows are left orphaned (not on any dashboard); they
 * become discoverable via the "add existing visualization" picker on the new
 * dashboard page.
 */

export const sqlite = {
  up: `
    CREATE TABLE dashboards (
      id   INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT    NOT NULL
    );

    CREATE TABLE dashboard_visualizations (
      dashboard_id     INTEGER NOT NULL REFERENCES dashboards(id) ON DELETE CASCADE,
      visualization_id INTEGER NOT NULL REFERENCES visualizations(id) ON DELETE CASCADE,
      position         INTEGER NOT NULL,
      PRIMARY KEY (dashboard_id, visualization_id)
    );

    CREATE INDEX idx_dash_viz_dashboard     ON dashboard_visualizations(dashboard_id);
    CREATE INDEX idx_dash_viz_visualization ON dashboard_visualizations(visualization_id);
  `,
  down: `
    DROP TABLE IF EXISTS dashboard_visualizations;
    DROP TABLE IF EXISTS dashboards;
  `,
};

export const postgres = {
  up: `
    CREATE TABLE dashboards (
      id   SERIAL PRIMARY KEY,
      name TEXT   NOT NULL
    );

    CREATE TABLE dashboard_visualizations (
      dashboard_id     INTEGER NOT NULL REFERENCES dashboards(id) ON DELETE CASCADE,
      visualization_id INTEGER NOT NULL REFERENCES visualizations(id) ON DELETE CASCADE,
      position         INTEGER NOT NULL,
      PRIMARY KEY (dashboard_id, visualization_id)
    );

    CREATE INDEX idx_dash_viz_dashboard     ON dashboard_visualizations(dashboard_id);
    CREATE INDEX idx_dash_viz_visualization ON dashboard_visualizations(visualization_id);
  `,
  down: `
    DROP TABLE IF EXISTS dashboard_visualizations;
    DROP TABLE IF EXISTS dashboards;
  `,
};
