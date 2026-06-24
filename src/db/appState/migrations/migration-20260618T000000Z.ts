/**
 * Move presets from a sidecar preset_filters table to a single filter_tree JSON
 * column. Filters became a recursive tree (AND/OR/grouping) and no longer fit
 * the flat row-per-filter model.
 *
 * This is a hard cut: existing preset filters are wiped and replaced with an
 * empty root AND group. Preset names survive so saved visualizations still
 * reference real preset rows; their underlying filters reset to nothing.
 */

const EMPTY_TREE = '{"type":"group","id":"root","op":"AND","children":[]}';

export const sqlite = {
  up: `
    ALTER TABLE presets ADD COLUMN filter_tree TEXT;
    UPDATE presets SET filter_tree = '${EMPTY_TREE}';
    DROP INDEX IF EXISTS idx_preset_filters_preset_id;
    DROP TABLE IF EXISTS preset_filters;
  `,
  // Rollback restores an empty preset_filters table; prior filter rows are not
  // reconstructable. Best-effort.
  down: `
    CREATE TABLE preset_filters (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      preset_id  INTEGER NOT NULL REFERENCES presets(id) ON DELETE CASCADE,
      key        TEXT    NOT NULL,
      op         TEXT    NOT NULL,
      value      TEXT    NOT NULL,
      filter_order INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX idx_preset_filters_preset_id ON preset_filters(preset_id);
  `,
};

export const postgres = {
  up: `
    ALTER TABLE presets ADD COLUMN filter_tree TEXT;
    UPDATE presets SET filter_tree = '${EMPTY_TREE}';
    DROP INDEX IF EXISTS idx_preset_filters_preset_id;
    DROP TABLE IF EXISTS preset_filters;
  `,
  down: `
    CREATE TABLE preset_filters (
      id         SERIAL  PRIMARY KEY,
      preset_id  INTEGER NOT NULL REFERENCES presets(id) ON DELETE CASCADE,
      key        TEXT    NOT NULL,
      op         TEXT    NOT NULL,
      value      TEXT    NOT NULL,
      filter_order INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX idx_preset_filters_preset_id ON preset_filters(preset_id);
  `,
};
