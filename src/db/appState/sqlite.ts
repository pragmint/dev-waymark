import { Database } from 'bun:sqlite';
import { runSql } from '../sqliteUtils';
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

  async savePreset(name: string, filters: MetaFilter[]): Promise<number> {
    const result = this.db
      .query<{ id: number }, [string]>('INSERT INTO presets (name) VALUES (?) RETURNING id')
      .get(name);
    const id = result!.id;

    for (let i = 0; i < filters.length; i++) {
      const f = filters[i];
      this.db
        .query(
          'INSERT INTO preset_filters (preset_id, key, op, value, filter_order) VALUES (?, ?, ?, ?, ?)'
        )
        .run(id, f.key, f.op, f.value, i);
    }

    return id;
  }

  async getPreset(id: number): Promise<PresetWithFilters | null> {
    const row = this.db.query('SELECT id, name FROM presets WHERE id = ?').get(id);
    if (!row) return null;

    const filterRows = this.db
      .query('SELECT key, op, value FROM preset_filters WHERE preset_id = ? ORDER BY filter_order')
      .all(id) as { key: string; op: string; value: string }[];

    return PresetWithFiltersSchema.parse({
      ...PresetSchema.parse(row),
      filters: filterRows.map(r => ({
        key: r.key,
        op: MetaFilterOpSchema.parse(r.op),
        value: r.value,
      })),
    });
  }

  async listPresets(): Promise<Preset[]> {
    const rows = this.db.query('SELECT id, name FROM presets ORDER BY id').all();
    return rows.map(r => PresetSchema.parse(r));
  }

  async deletePreset(id: number): Promise<void> {
    this.db.query('DELETE FROM presets WHERE id = ?').run(id);
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
    type Row = {
      id: number;
      name: string;
      description: string | null;
      preset_id: number;
      config: string;
      created_at: string;
      updated_at: string;
    };
    const rows = this.db
      .query<
        Row,
        []
      >('SELECT id, name, description, preset_id, config, created_at, updated_at FROM visualizations ORDER BY id')
      .all();
    return rows.map(r => {
      const config = JSON.parse(r.config) as VisualizationConfig;
      return VisualizationSummarySchema.parse({
        id: r.id,
        name: r.name,
        description: r.description,
        presetId: r.preset_id,
        chartType: config.chartType,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
      });
    });
  }

  async updateVisualization(
    id: number,
    name: string,
    description: string | null,
    config: VisualizationConfig
  ): Promise<void> {
    const now = new Date().toISOString();
    this.db
      .query(
        'UPDATE visualizations SET name = ?, description = ?, config = ?, updated_at = ? WHERE id = ?'
      )
      .run(name, description, JSON.stringify(config), now, id);
  }

  async deleteVisualization(id: number): Promise<void> {
    this.db.query('DELETE FROM visualizations WHERE id = ?').run(id);
  }

  async close(): Promise<void> {
    this.db.close();
  }

  /** Expose the raw Database for tests. */
  getDb(): Database {
    return this.db;
  }
}
