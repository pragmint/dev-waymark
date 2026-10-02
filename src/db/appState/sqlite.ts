import { Database } from 'bun:sqlite';
import { runSql } from '../sqliteUtils';
import { logger } from '../../logger';
import { PresetSchema, PresetWithTreeSchema } from '../../schemas/preset';
import { FilterTreeSchema, emptyTree } from '../../schemas/filterTree';
import { VisualizationSchema, VisualizationSummarySchema } from '../../schemas/visualization';
import { DashboardSchema, DashboardWithVizSchema } from '../../schemas/dashboard';
import { WaymarkSchema } from '../../schemas/waymark';
import type { Preset, PresetWithTree } from '../../schemas/preset';
import type { FilterTree } from '../../schemas/filterTree';
import type {
  Visualization,
  VisualizationConfig,
  VisualizationSummary,
} from '../../schemas/visualization';
import type { Dashboard, DashboardWithViz } from '../../schemas/dashboard';
import type { Waymark, WaymarkInput } from '../../schemas/waymark';
import type { AppStateRepository } from './repository';
import { migrations } from './migrations/index';

type VisualizationRow = {
  id: number;
  name: string;
  description: string | null;
  preset_id: number;
  config: string;
  created_at: string;
  updated_at: string;
};

function rowToVisualizationSummary(row: VisualizationRow): VisualizationSummary {
  const config = JSON.parse(row.config) as VisualizationConfig;
  return VisualizationSummarySchema.parse({
    id: row.id,
    name: row.name,
    description: row.description,
    presetId: row.preset_id,
    chartType: config.chartType,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

type WaymarkRow = {
  id: number;
  visualization_id: number;
  start_date: string;
  end_date: string;
  target_value: number;
  applies_to: string;
  label: string | null;
  created_at: string;
  updated_at: string;
};

function rowToWaymark(row: WaymarkRow): Waymark {
  return WaymarkSchema.parse({
    id: row.id,
    visualizationId: row.visualization_id,
    startDate: row.start_date,
    endDate: row.end_date,
    targetValue: row.target_value,
    appliesTo: row.applies_to,
    label: row.label,
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
      logger.info('[app-state] Applied migration', { name: migration.name });
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
    logger.info('[app-state] Rolled back migration', { name: row.name });
  }

  // ── Presets ──────────────────────────────────────────────────────────────

  async savePreset(name: string, tree: FilterTree): Promise<number> {
    const result = this.db
      .query<
        { id: number },
        [string, string]
      >('INSERT INTO presets (name, filter_tree) VALUES (?, ?) RETURNING id')
      .get(name, JSON.stringify(tree));
    return result!.id;
  }

  async getPreset(id: number): Promise<PresetWithTree | null> {
    const row = this.db
      .query<
        { id: number; name: string; filter_tree: string | null },
        [number]
      >('SELECT id, name, filter_tree FROM presets WHERE id = ?')
      .get(id);
    if (!row) return null;

    return PresetWithTreeSchema.parse({
      ...PresetSchema.parse({ id: row.id, name: row.name }),
      tree: decodeFilterTree(row.filter_tree),
    });
  }

  async listPresets(): Promise<Preset[]> {
    const rows = this.db.query('SELECT id, name FROM presets ORDER BY id').all();
    return rows.map(r => PresetSchema.parse(r));
  }

  async listPresetsWithTree(): Promise<PresetWithTree[]> {
    const rows = this.db.query('SELECT id, name, filter_tree FROM presets ORDER BY id').all() as {
      id: number;
      name: string;
      filter_tree: string | null;
    }[];

    return rows.map(r =>
      PresetWithTreeSchema.parse({
        ...PresetSchema.parse({ id: r.id, name: r.name }),
        tree: decodeFilterTree(r.filter_tree),
      })
    );
  }

  async updatePreset(id: number, name: string, tree: FilterTree): Promise<void> {
    this.db
      .query('UPDATE presets SET name = ?, filter_tree = ? WHERE id = ?')
      .run(name, JSON.stringify(tree), id);
  }

  async deletePreset(id: number): Promise<void> {
    this.db.query('DELETE FROM presets WHERE id = ?').run(id);
  }

  async deleteAllPresets(): Promise<void> {
    this.db.query('DELETE FROM presets').run();
  }

  // ── Visualizations ────────────────────────────────────────────────────────

  async saveVisualization(
    name: string,
    description: string | null,
    presetId: number,
    config: VisualizationConfig
  ): Promise<number> {
    const now = new Date().toISOString();
    const result = this.db
      .query<
        { id: number },
        [string, string | null, number, string, string, string]
      >('INSERT INTO visualizations (name, description, preset_id, config, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?) RETURNING id')
      .get(name, description, presetId, JSON.stringify(config), now, now);
    return result!.id;
  }

  async getVisualization(id: number): Promise<Visualization | null> {
    type Row = {
      id: number;
      name: string;
      description: string | null;
      preset_id: number;
      config: string;
      created_at: string;
      updated_at: string;
    };
    const row = this.db
      .query<
        Row,
        [number]
      >('SELECT id, name, description, preset_id, config, created_at, updated_at FROM visualizations WHERE id = ?')
      .get(id);
    if (!row) return null;
    return VisualizationSchema.parse({
      id: row.id,
      name: row.name,
      description: row.description,
      presetId: row.preset_id,
      config: JSON.parse(row.config),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    });
  }

  async listVisualizations(): Promise<VisualizationSummary[]> {
    const rows = this.db
      .query<
        VisualizationRow,
        []
      >('SELECT id, name, description, preset_id, config, created_at, updated_at FROM visualizations ORDER BY id')
      .all();
    return rows.map(rowToVisualizationSummary);
  }

  async listVisualizationsNotOnDashboard(dashboardId: number): Promise<VisualizationSummary[]> {
    const rows = this.db
      .query<VisualizationRow, [number]>(
        `SELECT id, name, description, preset_id, config, created_at, updated_at
         FROM visualizations
         WHERE id NOT IN (
           SELECT visualization_id FROM dashboard_visualizations WHERE dashboard_id = ?
         )
         ORDER BY id`
      )
      .all(dashboardId);
    return rows.map(rowToVisualizationSummary);
  }

  async updateVisualization(
    id: number,
    name: string,
    description: string | null,
    presetId: number,
    config: VisualizationConfig
  ): Promise<void> {
    const now = new Date().toISOString();
    this.db
      .query(
        'UPDATE visualizations SET name = ?, description = ?, preset_id = ?, config = ?, updated_at = ? WHERE id = ?'
      )
      .run(name, description, presetId, JSON.stringify(config), now, id);
  }

  async deleteVisualization(id: number): Promise<void> {
    this.db.query('DELETE FROM visualizations WHERE id = ?').run(id);
  }

  // ── Waymarks ─────────────────────────────────────────────────────────────

  async createWaymark(visualizationId: number, input: WaymarkInput): Promise<number> {
    const now = new Date().toISOString();
    const result = this.db
      .query<
        { id: number },
        [number, string, string, number, string, string | null, string, string]
      >(
        `INSERT INTO waymarks
           (visualization_id, start_date, end_date, target_value, applies_to, label, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         RETURNING id`
      )
      .get(
        visualizationId,
        input.startDate,
        input.endDate,
        input.targetValue,
        input.appliesTo,
        input.label,
        now,
        now
      );
    return result!.id;
  }

  async listWaymarksForVisualization(visualizationId: number): Promise<Waymark[]> {
    const rows = this.db
      .query<
        WaymarkRow,
        [number]
      >('SELECT id, visualization_id, start_date, end_date, target_value, applies_to, label, created_at, updated_at FROM waymarks WHERE visualization_id = ? ORDER BY start_date')
      .all(visualizationId);
    return rows.map(rowToWaymark);
  }

  async updateWaymark(id: number, input: WaymarkInput): Promise<void> {
    const now = new Date().toISOString();
    this.db
      .query(
        `UPDATE waymarks
         SET start_date = ?, end_date = ?, target_value = ?, applies_to = ?, label = ?, updated_at = ?
         WHERE id = ?`
      )
      .run(
        input.startDate,
        input.endDate,
        input.targetValue,
        input.appliesTo,
        input.label,
        now,
        id
      );
  }

  async deleteWaymark(id: number): Promise<void> {
    this.db.query('DELETE FROM waymarks WHERE id = ?').run(id);
  }

  async deleteAllWaymarks(): Promise<void> {
    this.db.query('DELETE FROM waymarks').run();
  }

  // ── Dashboards ────────────────────────────────────────────────────────────

  async saveDashboard(name: string, visualizationIds: number[]): Promise<number> {
    const tx = this.db.transaction(() => {
      const result = this.db
        .query<{ id: number }, [string]>('INSERT INTO dashboards (name) VALUES (?) RETURNING id')
        .get(name);
      const dashboardId = result!.id;
      const insert = this.db.query<unknown, [number, number, number]>(
        'INSERT INTO dashboard_visualizations (dashboard_id, visualization_id, position) VALUES (?, ?, ?)'
      );
      visualizationIds.forEach((vizId, i) => {
        insert.run(dashboardId, vizId, i);
      });
      return dashboardId;
    });
    return tx();
  }

  async getDashboard(id: number): Promise<DashboardWithViz | null> {
    const row = this.db
      .query<{ id: number; name: string }, [number]>('SELECT id, name FROM dashboards WHERE id = ?')
      .get(id);
    if (!row) return null;
    const vizRows = this.db
      .query<
        { visualization_id: number },
        [number]
      >('SELECT visualization_id FROM dashboard_visualizations WHERE dashboard_id = ? ORDER BY position')
      .all(id);
    return DashboardWithVizSchema.parse({
      ...DashboardSchema.parse({ id: row.id, name: row.name }),
      visualizationIds: vizRows.map(v => v.visualization_id),
    });
  }

  async listDashboards(): Promise<Dashboard[]> {
    const rows = this.db.query('SELECT id, name FROM dashboards ORDER BY id').all();
    return rows.map(r => DashboardSchema.parse(r));
  }

  async updateDashboard(id: number, name: string, visualizationIds: number[]): Promise<void> {
    const tx = this.db.transaction(() => {
      const exists = this.db
        .query<{ id: number }, [number]>('SELECT id FROM dashboards WHERE id = ?')
        .get(id);
      if (!exists) return;
      this.db.query('UPDATE dashboards SET name = ? WHERE id = ?').run(name, id);
      this.db.query('DELETE FROM dashboard_visualizations WHERE dashboard_id = ?').run(id);
      const insert = this.db.query<unknown, [number, number, number]>(
        'INSERT INTO dashboard_visualizations (dashboard_id, visualization_id, position) VALUES (?, ?, ?)'
      );
      visualizationIds.forEach((vizId, i) => {
        insert.run(id, vizId, i);
      });
    });
    tx();
  }

  async deleteDashboard(id: number): Promise<void> {
    this.db.query('DELETE FROM dashboards WHERE id = ?').run(id);
  }

  async deleteAllDashboards(): Promise<void> {
    this.db.query('DELETE FROM dashboards').run();
  }

  async addVisualizationToDashboard(dashboardId: number, visualizationId: number): Promise<void> {
    const tx = this.db.transaction(() => {
      const existing = this.db
        .query<
          { dashboard_id: number },
          [number, number]
        >('SELECT dashboard_id FROM dashboard_visualizations WHERE dashboard_id = ? AND visualization_id = ?')
        .get(dashboardId, visualizationId);
      if (existing) return;
      const row = this.db
        .query<
          { max_pos: number | null },
          [number]
        >('SELECT MAX(position) AS max_pos FROM dashboard_visualizations WHERE dashboard_id = ?')
        .get(dashboardId);
      const nextPos = row && row.max_pos !== null ? row.max_pos + 1 : 0;
      this.db
        .query(
          'INSERT INTO dashboard_visualizations (dashboard_id, visualization_id, position) VALUES (?, ?, ?)'
        )
        .run(dashboardId, visualizationId, nextPos);
    });
    tx();
  }

  async removeVisualizationFromDashboard(
    dashboardId: number,
    visualizationId: number
  ): Promise<void> {
    this.db
      .query('DELETE FROM dashboard_visualizations WHERE dashboard_id = ? AND visualization_id = ?')
      .run(dashboardId, visualizationId);
  }

  async getDashboardCountsByViz(): Promise<Record<number, number>> {
    const rows = this.db
      .query<
        { visualization_id: number; n: number },
        []
      >('SELECT visualization_id, COUNT(*) AS n FROM dashboard_visualizations GROUP BY visualization_id')
      .all();
    const out: Record<number, number> = {};
    for (const r of rows) out[r.visualization_id] = r.n;
    return out;
  }

  async listDashboardsForVisualization(visualizationId: number): Promise<Dashboard[]> {
    const rows = this.db
      .query<{ id: number; name: string }, [number]>(
        `SELECT d.id, d.name
         FROM dashboards d
         JOIN dashboard_visualizations dv ON dv.dashboard_id = d.id
         WHERE dv.visualization_id = ?
         ORDER BY d.id`
      )
      .all(visualizationId);
    return rows.map(r => DashboardSchema.parse(r));
  }

  async truncateData(): Promise<void> {
    // Order matters: junction/child rows first, then parents. SQLite has no
    // TRUNCATE — DELETE is the idiom, and DELETE from an empty table is cheap.
    this.db.query('DELETE FROM dashboard_visualizations').run();
    this.db.query('DELETE FROM waymarks').run();
    this.db.query('DELETE FROM visualizations').run();
    this.db.query('DELETE FROM dashboards').run();
    this.db.query('DELETE FROM presets').run();
  }

  async close(): Promise<void> {
    this.db.close();
  }

  /** Expose the raw Database for tests. */
  getDb(): Database {
    return this.db;
  }
}
