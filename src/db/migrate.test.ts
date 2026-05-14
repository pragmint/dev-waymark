import { describe, expect, it, beforeEach } from 'bun:test';
import { Database } from 'bun:sqlite';
import { runMigrations, rollbackMigration } from './migrate';

describe('runMigrations', () => {
  it('creates the _migrations table', () => {
    const db = new Database(':memory:');
    runMigrations(db);
    const row = db
      .query("SELECT name FROM sqlite_master WHERE type='table' AND name='_migrations'")
      .get();
    expect(row).not.toBeNull();
  });

  it('creates entity tables on first run', () => {
    const db = new Database(':memory:');
    runMigrations(db);
    const entities = db
      .query("SELECT name FROM sqlite_master WHERE type='table' AND name='entities'")
      .get();
    const metadata = db
      .query("SELECT name FROM sqlite_master WHERE type='table' AND name='entity_metadata'")
      .get();
    expect(entities).not.toBeNull();
    expect(metadata).not.toBeNull();
  });

  it('records applied migrations', () => {
    const db = new Database(':memory:');
    runMigrations(db);
    const rows = db.query<{ name: string }, []>('SELECT name FROM _migrations').all();
    expect(rows).toHaveLength(1);
    const names = rows.map(r => r.name);
    expect(names).toContain('migration-20260514T000000Z.ts');
  });

  it('is idempotent — does not re-apply on second run', () => {
    const db = new Database(':memory:');
    runMigrations(db);
    runMigrations(db);
    const rows = db.query('SELECT * FROM _migrations').all();
    expect(rows).toHaveLength(1);
  });
});

describe('rollbackMigration', () => {
  let db: Database;

  beforeEach(() => {
    db = new Database(':memory:');
    db.exec('PRAGMA foreign_keys = ON;');
    runMigrations(db);
  });

  it('drops entity tables after rolling back all migrations', () => {
    rollbackMigration(db); // rolls back migration-20260514T000000Z — drops tables
    const entities = db
      .query("SELECT name FROM sqlite_master WHERE type='table' AND name='entities'")
      .get();
    expect(entities).toBeNull();
  });

  it('removes all migration records after rolling back all migrations', () => {
    rollbackMigration(db);
    const rows = db.query('SELECT * FROM _migrations').all();
    expect(rows).toHaveLength(0);
  });

  it('does nothing when no migrations have been applied', () => {
    rollbackMigration(db);
    rollbackMigration(db); // no-op
    const rows = db.query('SELECT * FROM _migrations').all();
    expect(rows).toHaveLength(0);
  });
});
