/**
 * Add filter_order column to dataset_filters if it doesn't already exist.
 *
 * SQLite does not support ALTER TABLE ... ADD COLUMN IF NOT EXISTS, so this
 * migration uses a function to check PRAGMA table_info before altering.
 *
 * Handles databases where migration-20260519T000000Z ran as a no-op (the
 * CREATE TABLE IF NOT EXISTS was skipped because the table existed without
 * the filter_order column from an earlier version of the schema).
 */

import type { Database } from 'bun:sqlite';

export const sqlite = {
  up: (db: Database) => {
    const cols = db.query(`PRAGMA table_info(dataset_filters)`).all() as { name: string }[];
    if (!cols.some(c => c.name === 'filter_order')) {
      db.query(
        'ALTER TABLE dataset_filters ADD COLUMN filter_order INTEGER NOT NULL DEFAULT 0'
      ).run();
    }
  },
  // Dropping a column in SQLite requires table reconstruction; not worth the
  // complexity for a fixup migration — leave the column in place on rollback.
  down: `SELECT 1`,
};

export const postgres = {
  up: `ALTER TABLE dataset_filters ADD COLUMN IF NOT EXISTS filter_order INTEGER NOT NULL DEFAULT 0`,
  down: `SELECT 1`,
};
