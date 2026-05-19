import { Pool } from 'pg';
import { DatasetSchema, DatasetWithFiltersSchema } from '../../schemas/dataset';
import { MetaFilterOpSchema } from '../../schemas/entity';
import type { Dataset, DatasetWithFilters } from '../../schemas/dataset';
import type { MetaFilter } from '../../schemas/entity';
import type { AppStateRepository } from './repository';
import { migrations } from './migrations/index';

async function runMigrations(pool: Pool): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS _app_migrations (
      name       TEXT        PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  for (const migration of migrations) {
    const result = await pool.query<{ name: string }>(
      'SELECT name FROM _app_migrations WHERE name = $1',
      [migration.name]
    );
    if (result.rows.length === 0) {
      await pool.query(migration.postgres.up);
      await pool.query('INSERT INTO _app_migrations (name) VALUES ($1)', [migration.name]);
      console.log(`[app-state] Applied: ${migration.name}`);
    }
  }
}

export class PostgresAppStateRepository implements AppStateRepository {
  private pool: Pool;

  constructor(connectionString: string) {
    this.pool = new Pool({ connectionString });
  }

  async initialize(): Promise<void> {
    await runMigrations(this.pool);
  }

  async rollbackLast(): Promise<void> {
    const result = await this.pool.query<{ name: string }>(
      'SELECT name FROM _app_migrations ORDER BY applied_at DESC LIMIT 1'
    );
    if (result.rows.length === 0) return;

    const { name } = result.rows[0];
    const migration = migrations.find(m => m.name === name);
    if (!migration) throw new Error(`Migration not found in registry: ${name}`);

    await this.pool.query(migration.postgres.down);
    await this.pool.query('DELETE FROM _app_migrations WHERE name = $1', [name]);
    console.log(`[app-state] Rolled back: ${name}`);
  }

  // ── Datasets ──────────────────────────────────────────────────────────────

  async saveDataset(name: string, filters: MetaFilter[]): Promise<number> {
    const result = await this.pool.query<{ id: number }>(
      'INSERT INTO datasets (name) VALUES ($1) RETURNING id',
      [name]
    );
    const id = result.rows[0].id;

    for (let i = 0; i < filters.length; i++) {
      const f = filters[i];
      await this.pool.query(
        'INSERT INTO dataset_filters (dataset_id, key, op, value, filter_order) VALUES ($1, $2, $3, $4, $5)',
        [id, f.key, f.op, f.value, i]
      );
    }

    return id;
  }

  async getDataset(id: number): Promise<DatasetWithFilters | null> {
    const datasetResult = await this.pool.query<{ id: number; name: string }>(
      'SELECT id, name FROM datasets WHERE id = $1',
      [id]
    );
    if (datasetResult.rows.length === 0) return null;

    const filterResult = await this.pool.query<{ key: string; op: string; value: string }>(
      'SELECT key, op, value FROM dataset_filters WHERE dataset_id = $1 ORDER BY filter_order',
      [id]
    );

    return DatasetWithFiltersSchema.parse({
      ...DatasetSchema.parse(datasetResult.rows[0]),
      filters: filterResult.rows.map(r => ({
        key: r.key,
        op: MetaFilterOpSchema.parse(r.op),
        value: r.value,
      })),
    });
  }

  async listDatasets(): Promise<Dataset[]> {
    const result = await this.pool.query<{ id: number; name: string }>(
      'SELECT id, name FROM datasets ORDER BY id'
    );
    return result.rows.map(r => DatasetSchema.parse(r));
  }

  async deleteDataset(id: number): Promise<void> {
    await this.pool.query('DELETE FROM datasets WHERE id = $1', [id]);
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}
