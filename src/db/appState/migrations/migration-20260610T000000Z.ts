/**
 * Rename datasets → presets, dataset_filters → preset_filters, and the
 * dataset_id columns on preset_filters and visualizations → preset_id.
 *
 * The "dataset" naming was renamed across the application to "preset"; this
 * migration brings the database schema in line.
 */

export const sqlite = {
  up: `
    ALTER TABLE datasets RENAME TO presets;
    ALTER TABLE dataset_filters RENAME TO preset_filters;
    ALTER TABLE preset_filters RENAME COLUMN dataset_id TO preset_id;
    ALTER TABLE visualizations RENAME COLUMN dataset_id TO preset_id;
    DROP INDEX IF EXISTS idx_dataset_filters_dataset_id;
    CREATE INDEX IF NOT EXISTS idx_preset_filters_preset_id ON preset_filters(preset_id);
    DROP INDEX IF EXISTS idx_visualizations_dataset_id;
    CREATE INDEX IF NOT EXISTS idx_visualizations_preset_id ON visualizations(preset_id);
  `,
  down: `
    DROP INDEX IF EXISTS idx_visualizations_preset_id;
    CREATE INDEX IF NOT EXISTS idx_visualizations_dataset_id ON visualizations(preset_id);
    DROP INDEX IF EXISTS idx_preset_filters_preset_id;
    CREATE INDEX IF NOT EXISTS idx_dataset_filters_dataset_id ON preset_filters(preset_id);
    ALTER TABLE visualizations RENAME COLUMN preset_id TO dataset_id;
    ALTER TABLE preset_filters RENAME COLUMN preset_id TO dataset_id;
    ALTER TABLE preset_filters RENAME TO dataset_filters;
    ALTER TABLE presets RENAME TO datasets;
  `,
};

export const postgres = {
  up: `
    ALTER TABLE datasets RENAME TO presets;
    ALTER TABLE dataset_filters RENAME TO preset_filters;
    ALTER TABLE preset_filters RENAME COLUMN dataset_id TO preset_id;
    ALTER TABLE visualizations RENAME COLUMN dataset_id TO preset_id;
    ALTER INDEX IF EXISTS idx_dataset_filters_dataset_id RENAME TO idx_preset_filters_preset_id;
    ALTER INDEX IF EXISTS idx_visualizations_dataset_id RENAME TO idx_visualizations_preset_id;
  `,
  down: `
    ALTER INDEX IF EXISTS idx_visualizations_preset_id RENAME TO idx_visualizations_dataset_id;
    ALTER INDEX IF EXISTS idx_preset_filters_preset_id RENAME TO idx_dataset_filters_dataset_id;
    ALTER TABLE visualizations RENAME COLUMN preset_id TO dataset_id;
    ALTER TABLE preset_filters RENAME COLUMN preset_id TO dataset_id;
    ALTER TABLE preset_filters RENAME TO dataset_filters;
    ALTER TABLE presets RENAME TO datasets;
  `,
};
