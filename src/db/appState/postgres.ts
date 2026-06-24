import { Pool } from 'pg';
import { logger } from '../../logger';
import { PresetSchema, PresetWithTreeSchema } from '../../schemas/preset';
import { FilterTreeSchema, emptyTree } from '../../schemas/filterTree';
import { VisualizationSchema, VisualizationSummarySchema } from '../../schemas/visualization';
import type { Preset, PresetWithTree } from '../../schemas/preset';
import type { FilterTree } from '../../schemas/filterTree';
import type {
  Visualization,
  VisualizationConfig,
  VisualizationSummary,
} from '../../schemas/visualization';
import type { AppStateRepository } from './repository';
import { migrations } from './migrations/index';

function decodeFilterTree(raw: string | null): FilterTree {
  if (!raw) return emptyTree();
  try {
    return FilterTreeSchema.parse(JSON.parse(raw));
  } catch {
    return emptyTree();
  }
}

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

  async savePreset(name: string, tree: FilterTree): Promise<number> {
    const result = await this.pool.query<{ id: number }>(
      'INSERT INTO presets (name, filter_tree) VALUES ($1, $2) RETURNING id',
      [name, JSON.stringify(tree)]
    );
    return result.rows[0].id;
  }

  async getPreset(id: number): Promise<PresetWithTree | null> {
    const result = await this.pool.query<{
      id: number;
      name: string;
      filter_tree: string | null;
    }>('SELECT id, name, filter_tree FROM presets WHERE id = $1', [id]);
    if (result.rows.length === 0) return null;

    const row = result.rows[0];
    return PresetWithTreeSchema.parse({
      ...PresetSchema.parse({ id: row.id, name: row.name }),
      tree: decodeFilterTree(row.filter_tree),
    });
  }

  async listPresets(): Promise<Preset[]> {
    const result = await this.pool.query<{ id: number; name: string }>(
      'SELECT id, name FROM presets ORDER BY id'
    );
    return result.rows.map(r => PresetSchema.parse(r));
  }

  async listPresetsWithTree(): Promise<PresetWithTree[]> {
    const result = await this.pool.query<{
      id: number;
      name: string;
      filter_tree: string | null;
    }>('SELECT id, name, filter_tree FROM presets ORDER BY id');

    return result.rows.map(r =>
      PresetWithTreeSchema.parse({
        ...PresetSchema.parse({ id: r.id, name: r.name }),
        tree: decodeFilterTree(r.filter_tree),
      })
    );
  }

  async updatePreset(id: number, name: string, tree: FilterTree): Promise<void> {
    await this.pool.query('UPDATE presets SET name = $1, filter_tree = $2 WHERE id = $3', [
      name,
      JSON.stringify(tree),
      id,
    ]);
  }

  async deletePreset(id: number): Promise<void> {
    await this.pool.query('DELETE FROM presets WHERE id = $1', [id]);
  }

  async deleteAllPresets(): Promise<void> {
    await this.pool.query('DELETE FROM presets');
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
