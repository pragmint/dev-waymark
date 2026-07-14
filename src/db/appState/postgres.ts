import { Pool, types } from 'pg';
import { logger } from '../../logger';

// Parse TIMESTAMPTZ (OID 1184) and TIMESTAMP (OID 1114) as ISO strings rather
// than JS Date objects, so rows satisfy Zod schemas that expect `z.string()`
// and match the SQLite adapter's TEXT-column behavior.
types.setTypeParser(1184, val => new Date(val).toISOString());
types.setTypeParser(1114, val => new Date(val).toISOString());
import { PresetSchema, PresetWithTreeSchema } from '../../schemas/preset';
import { FilterTreeSchema, emptyTree } from '../../schemas/filterTree';
import { VisualizationSchema, VisualizationSummarySchema } from '../../schemas/visualization';
import { DashboardSchema, DashboardWithVizSchema } from '../../schemas/dashboard';
import type { Preset, PresetWithTree } from '../../schemas/preset';
import type { FilterTree } from '../../schemas/filterTree';
import type {
  Visualization,
  VisualizationConfig,
  VisualizationSummary,
} from '../../schemas/visualization';
import type { Dashboard, DashboardWithViz } from '../../schemas/dashboard';
import type { AppStateRepository } from './repository';
import { migrations } from './migrations/index';

type VisualizationRow = {
  id: number;
  name: string;
  description: string | null;
  preset_id: number;
  config: VisualizationConfig;
  created_at: string;
  updated_at: string;
};

function rowToVisualizationSummary(row: VisualizationRow): VisualizationSummary {
  return VisualizationSummarySchema.parse({
    id: row.id,
    name: row.name,
    description: row.description,
    presetId: row.preset_id,
    chartType: row.config.chartType,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

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
    const result = await this.pool.query<VisualizationRow>(
      'SELECT id, name, description, preset_id, config, created_at, updated_at FROM visualizations ORDER BY id'
    );
    return result.rows.map(rowToVisualizationSummary);
  }

  async listVisualizationsNotOnDashboard(dashboardId: number): Promise<VisualizationSummary[]> {
    const result = await this.pool.query<VisualizationRow>(
      `SELECT id, name, description, preset_id, config, created_at, updated_at
       FROM visualizations
       WHERE id NOT IN (
         SELECT visualization_id FROM dashboard_visualizations WHERE dashboard_id = $1
       )
       ORDER BY id`,
      [dashboardId]
    );
    return result.rows.map(rowToVisualizationSummary);
  }

  async updateVisualization(
    id: number,
    name: string,
    description: string | null,
    presetId: number,
    config: VisualizationConfig
  ): Promise<void> {
    const now = new Date().toISOString();
    await this.pool.query(
      'UPDATE visualizations SET name = $1, description = $2, preset_id = $3, config = $4, updated_at = $5 WHERE id = $6',
      [name, description, presetId, JSON.stringify(config), now, id]
    );
  }

  async deleteVisualization(id: number): Promise<void> {
    await this.pool.query('DELETE FROM visualizations WHERE id = $1', [id]);
  }

  // ── Dashboards ────────────────────────────────────────────────────────────

  async saveDashboard(name: string, visualizationIds: number[]): Promise<number> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await client.query<{ id: number }>(
        'INSERT INTO dashboards (name) VALUES ($1) RETURNING id',
        [name]
      );
      const dashboardId = result.rows[0].id;
      for (let i = 0; i < visualizationIds.length; i++) {
        await client.query(
          'INSERT INTO dashboard_visualizations (dashboard_id, visualization_id, position) VALUES ($1, $2, $3)',
          [dashboardId, visualizationIds[i], i]
        );
      }
      await client.query('COMMIT');
      return dashboardId;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  async getDashboard(id: number): Promise<DashboardWithViz | null> {
    const dash = await this.pool.query<{ id: number; name: string }>(
      'SELECT id, name FROM dashboards WHERE id = $1',
      [id]
    );
    if (dash.rows.length === 0) return null;
    const viz = await this.pool.query<{ visualization_id: number }>(
      'SELECT visualization_id FROM dashboard_visualizations WHERE dashboard_id = $1 ORDER BY position',
      [id]
    );
    return DashboardWithVizSchema.parse({
      ...DashboardSchema.parse({ id: dash.rows[0].id, name: dash.rows[0].name }),
      visualizationIds: viz.rows.map(v => v.visualization_id),
    });
  }

  async listDashboards(): Promise<Dashboard[]> {
    const result = await this.pool.query<{ id: number; name: string }>(
      'SELECT id, name FROM dashboards ORDER BY id'
    );
    return result.rows.map(r => DashboardSchema.parse(r));
  }

  async updateDashboard(id: number, name: string, visualizationIds: number[]): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const exists = await client.query<{ id: number }>('SELECT id FROM dashboards WHERE id = $1', [
        id,
      ]);
      if (exists.rows.length === 0) {
        await client.query('ROLLBACK');
        return;
      }
      await client.query('UPDATE dashboards SET name = $1 WHERE id = $2', [name, id]);
      await client.query('DELETE FROM dashboard_visualizations WHERE dashboard_id = $1', [id]);
      for (let i = 0; i < visualizationIds.length; i++) {
        await client.query(
          'INSERT INTO dashboard_visualizations (dashboard_id, visualization_id, position) VALUES ($1, $2, $3)',
          [id, visualizationIds[i], i]
        );
      }
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  async deleteDashboard(id: number): Promise<void> {
    await this.pool.query('DELETE FROM dashboards WHERE id = $1', [id]);
  }

  async deleteAllDashboards(): Promise<void> {
    await this.pool.query('DELETE FROM dashboards');
  }

  async addVisualizationToDashboard(dashboardId: number, visualizationId: number): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const existing = await client.query(
        'SELECT 1 FROM dashboard_visualizations WHERE dashboard_id = $1 AND visualization_id = $2',
        [dashboardId, visualizationId]
      );
      if (existing.rows.length > 0) {
        await client.query('ROLLBACK');
        return;
      }
      const maxRow = await client.query<{ max_pos: number | null }>(
        'SELECT MAX(position) AS max_pos FROM dashboard_visualizations WHERE dashboard_id = $1',
        [dashboardId]
      );
      const nextPos = maxRow.rows[0]?.max_pos !== null ? Number(maxRow.rows[0]?.max_pos) + 1 : 0;
      await client.query(
        'INSERT INTO dashboard_visualizations (dashboard_id, visualization_id, position) VALUES ($1, $2, $3)',
        [dashboardId, visualizationId, nextPos]
      );
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  async removeVisualizationFromDashboard(
    dashboardId: number,
    visualizationId: number
  ): Promise<void> {
    await this.pool.query(
      'DELETE FROM dashboard_visualizations WHERE dashboard_id = $1 AND visualization_id = $2',
      [dashboardId, visualizationId]
    );
  }

  async getDashboardCountsByViz(): Promise<Record<number, number>> {
    const result = await this.pool.query<{ visualization_id: number; n: string }>(
      'SELECT visualization_id, COUNT(*) AS n FROM dashboard_visualizations GROUP BY visualization_id'
    );
    const out: Record<number, number> = {};
    for (const r of result.rows) out[r.visualization_id] = Number(r.n);
    return out;
  }

  async listDashboardsForVisualization(visualizationId: number): Promise<Dashboard[]> {
    const result = await this.pool.query<{ id: number; name: string }>(
      `SELECT d.id, d.name
       FROM dashboards d
       JOIN dashboard_visualizations dv ON dv.dashboard_id = d.id
       WHERE dv.visualization_id = $1
       ORDER BY d.id`,
      [visualizationId]
    );
    return result.rows.map(r => DashboardSchema.parse(r));
  }

  async truncateData(): Promise<void> {
    // RESTART IDENTITY keeps IDs deterministic across e2e runs; CASCADE clears
    // the dashboard_visualizations junction rows even though the FK is
    // ON DELETE CASCADE on the parent side.
    await this.pool.query(
      'TRUNCATE dashboards, dashboard_visualizations, visualizations, presets RESTART IDENTITY CASCADE'
    );
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}
