import type { Database } from 'bun:sqlite';
import { migrations } from './migrations/index';

export function runMigrations(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS _migrations (
      name TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL
    )
  `);

  for (const migration of migrations) {
    const already = db
      .query<{ name: string }, [string]>('SELECT name FROM _migrations WHERE name = ?')
      .get(migration.name);

    if (!already) {
      migration.up(db);
      db.query('INSERT INTO _migrations (name, applied_at) VALUES (?, ?)').run(
        migration.name,
        new Date().toISOString()
      );
      console.log(`Applied: ${migration.name}`);
    }
  }
}

export function rollbackMigration(db: Database): void {
  const last = db
    .query<{ name: string }, []>('SELECT name FROM _migrations ORDER BY rowid DESC LIMIT 1')
    .get();

  if (!last) {
    console.log('No migrations to roll back');
    return;
  }

  const migration = migrations.find(m => m.name === last.name);
  if (!migration) {
    throw new Error(`Migration not found in registry: ${last.name}`);
  }

  migration.down(db);
  db.query('DELETE FROM _migrations WHERE name = ?').run(last.name);
  console.log(`Rolled back: ${last.name}`);
}
