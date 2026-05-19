/**
 * @deprecated Use createSourceAdapter() from src/db/source/factory.ts instead.
 *
 * This module is kept temporarily for any tooling that may reference it,
 * but nothing in the main application or tests should use it.
 * It will be removed in a future cleanup.
 */
import { Database } from 'bun:sqlite';

let _db: Database | null = null;

/** @deprecated */
export function getDb(): Database {
  if (!_db) {
    const path = process.env.DATABASE_PATH ?? 'step-engine.sqlite';
    _db = new Database(path);
    _db.query('PRAGMA journal_mode = WAL').run();
    _db.query('PRAGMA foreign_keys = ON').run();
  }
  return _db;
}
