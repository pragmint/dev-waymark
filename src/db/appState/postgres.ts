import { Pool } from 'pg';
import { logger } from '../../logger';
import { PresetSchema, PresetWithFiltersSchema } from '../../schemas/preset';
import { MetaFilterOpSchema } from '../../schemas/entity';
import { VisualizationSchema, VisualizationSummarySchema } from '../../schemas/visualization';
import type { Preset, PresetWithFilters } from '../../schemas/preset';
import type { MetaFilter } from '../../schemas/entity';
import type {
  Visualization,
  VisualizationConfig,
  VisualizationSummary,
} from '../../schemas/visualization';
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
      logger.info('[app-state] Applied migration', { name: migration.name });
    }
  }
}

export class PostgresAppStateRepository implements AppStateRepository {
  private pool: Pool;

  constructor(connectionString: string) {
    this.pool = new Pool({ connectionString });
  }

  async migrate(): Promise<void> {
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
    logger.info('[app-state] Rolled back migration', { name });
  }

  // ── Presets ──────────────────────────────────────────────────────────────

  async savePreset(name: string, filters: MetaFilter[]): Promise<number> {
    const result = await this.pool.query<{ id: number }>(
      'INSERT INTO presets (name) VALUES ($1) RETURNING id',
      [name]
    );
    const id = result.rows[0].id;

    for (let i = 0; i < filters.length; i++) {
      const f = filters[i];
      await this.pool.query(
        'INSERT INTO preset_filters (preset_id, key, op, value, filter_order) VALUES ($1, $2, $3, $4, $5)',
        [id, f.key, f.op, f.value, i]
      );
    }

    return id;
  }

  async getPreset(id: number): Promise<PresetWithFilters | null> {
    const presetResult = await this.pool.query<{ id: number; name: string }>(
      'SELECT id, name FROM presets WHERE id = $1',
      [id]
    );
    if (presetResult.rows.length === 0) return null;

    const filterResult = await this.pool.query<{ key: string; op: string; value: string }>(
      'SELECT key, op, value FROM preset_filters WHERE preset_id = $1 ORDER BY filter_order',
      [id]
    );

    return PresetWithFiltersSchema.parse({
      ...PresetSchema.parse(presetResult.rows[0]),
      filters: filterResult.rows.map(r => ({
        key: r.key,
        op: MetaFilterOpSchema.parse(r.op),
        value: r.value,
      })),
    });
  }

  async listPresets(): Promise<Preset[]> {
    const result = await this.pool.query<{ id: number; name: string }>(
      'SELECT id, name FROM presets ORDER BY id'
    );
    return result.rows.map(r => PresetSchema.parse(r));
  }

  async deletePreset(id: number): Promise<void> {
    await this.pool.query('DELETE FROM presets WHERE id = $1', [id]);
  }

  // ── Visualizations ────────────────────────────────────────────────────────

  async saveVisualization(
    name: string,
    description: string | null,
    presetId: number,
    config: VisualizationConfig
  ): Promise<number> {
    const now = new Date().toISOString();
    const result = await this.pool.query<{ id: number }>(
      'INSERT INTO visualizations (name, description, preset_id, config, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id',
      [name, description, presetId, JSON.stringify(config), now, now]
    );
    return result.rows[0].id;
  }

  async getVisualization(id: number): Promise<Visualization | null> {
    const result = await this.pool.query<{
      id: number;
      name: string;
      description: string | null;
      preset_id: number;
      config: VisualizationConfig;
      created_at: string;
      updated_at: string;
    }>(
      'SELECT id, name, description, preset_id, config, created_at, updated_at FROM visualizations WHERE id = $1',
      [id]
    );
    if (result.rows.length === 0) return null;
    const row = result.rows[0];
    return VisualizationSchema.parse({
      id: row.id,
      name: row.name,
      description: row.description,
      presetId: row.preset_id,
      config: row.config,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    });
  }

  async listVisualizations(): Promise<VisualizationSummary[]> {
    const result = await this.pool.query<{
      id: number;
      name: string;
      description: string | null;
      preset_id: number;
      config: VisualizationConfig;
      created_at: string;
      updated_at: string;
    }>(
      'SELECT id, name, description, preset_id, config, created_at, updated_at FROM visualizations ORDER BY id'
    );
    return result.rows.map(r =>
      VisualizationSummarySchema.parse({
        id: r.id,
        name: r.name,
        description: r.description,
        presetId: r.preset_id,
        chartType: r.config.chartType,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
      })
    );
  }

  async updateVisualization(
    id: number,
    name: string,
    description: string | null,
    config: VisualizationConfig
  ): Promise<void> {
    const now = new Date().toISOString();
    await this.pool.query(
      'UPDATE visualizations SET name = $1, description = $2, config = $3, updated_at = $4 WHERE id = $5',
      [name, description, JSON.stringify(config), now, id]
    );
  }

  async deleteVisualization(id: number): Promise<void> {
    await this.pool.query('DELETE FROM visualizations WHERE id = $1', [id]);
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}
