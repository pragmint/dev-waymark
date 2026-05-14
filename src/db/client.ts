import { Database } from 'bun:sqlite';

let _db: Database | null = null;

export function getDb(): Database {
  if (!_db) {
    const path = process.env.DATABASE_PATH ?? 'step-engine.sqlite';
    _db = new Database(path);
    _db.exec('PRAGMA journal_mode = WAL;');
    _db.exec('PRAGMA foreign_keys = ON;');
  }
  return _db;
}
