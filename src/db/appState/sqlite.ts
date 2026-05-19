import { Database } from 'bun:sqlite';
import { runSql } from '../sqliteUtils';
import { DatasetSchema, DatasetWithFiltersSchema } from '../../schemas/dataset';
import { MetaFilterOpSchema } from '../../schemas/entity';
import type { Dataset, DatasetWithFilters } from '../../schemas/dataset';
import type { MetaFilter } from '../../schemas/entity';
import type { AppStateRepository } from './repository';
import { migrations } from './migrations/index';

function runMigrations(db: Database): void {
  runSql(
    db,
    `CREATE TABLE IF NOT EXISTS _app_migrations (
      name       TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL
    )`
  );

  for (const migration of migrations) {
    const already = db
      .query<{ name: string }, [string]>('SELECT name FROM _app_migrations WHERE name = ?')
      .get(migration.name);

    if (!already) {
      const up = migration.sqlite.up;
      if (typeof up === 'function') {
        up(db);
      } else {
        runSql(db, up);
      }
      db.query('INSERT INTO _app_migrations (name, applied_at) VALUES (?, ?)').run(
        migration.name,
        new Date().toISOString()
      );
      console.log(`[app-state] Applied: ${migration.name}`);
    }
  }
}

export class SqliteAppStateRepository implements AppStateRepository {
  private db: Database;

  constructor(path: string) {
    this.db = new Database(path);
    this.db.query('PRAGMA journal_mode = WAL').run();
    this.db.query('PRAGMA foreign_keys = ON').run();
  }

  async migrate(): Promise<void> {
    runMigrations(this.db);
  }

  async rollbackLast(): Promise<void> {
    const row = this.db
      .query<
        { name: string },
        []
      >('SELECT name FROM _app_migrations ORDER BY applied_at DESC LIMIT 1')
      .get();
    if (!row) return;

    const migration = migrations.find(m => m.name === row.name);
    if (!migration) throw new Error(`Migration not found in registry: ${row.name}`);

    runSql(this.db, migration.sqlite.down);
    this.db.query('DELETE FROM _app_migrations WHERE name = ?').run(row.name);
    console.log(`[app-state] Rolled back: ${row.name}`);
  }

  // ── Datasets ──────────────────────────────────────────────────────────────

  async saveDataset(name: string, filters: MetaFilter[]): Promise<number> {
    const result = this.db
      .query<{ id: number }, [string]>('INSERT INTO datasets (name) VALUES (?) RETURNING id')
      .get(name);
    const id = result!.id;

    for (let i = 0; i < filters.length; i++) {
      const f = filters[i];
      this.db
        .query(
          'INSERT INTO dataset_filters (dataset_id, key, op, value, filter_order) VALUES (?, ?, ?, ?, ?)'
        )
        .run(id, f.key, f.op, f.value, i);
    }

    return id;
  }

  async getDataset(id: number): Promise<DatasetWithFilters | null> {
    const row = this.db.query('SELECT id, name FROM datasets WHERE id = ?').get(id);
    if (!row) return null;

    const filterRows = this.db
      .query(
        'SELECT key, op, value FROM dataset_filters WHERE dataset_id = ? ORDER BY filter_order'
      )
      .all(id) as { key: string; op: string; value: string }[];

    return DatasetWithFiltersSchema.parse({
      ...DatasetSchema.parse(row),
      filters: filterRows.map(r => ({
        key: r.key,
        op: MetaFilterOpSchema.parse(r.op),
        value: r.value,
      })),
    });
  }

  async listDatasets(): Promise<Dataset[]> {
    const rows = this.db.query('SELECT id, name FROM datasets ORDER BY id').all();
    return rows.map(r => DatasetSchema.parse(r));
  }

  async deleteDataset(id: number): Promise<void> {
    this.db.query('DELETE FROM datasets WHERE id = ?').run(id);
  }

  async close(): Promise<void> {
    this.db.close();
  }

  /** Expose the raw Database for tests. */
  getDb(): Database {
    return this.db;
  }
}
