import type { Preset, PresetWithFilters } from '../../schemas/preset';
import type { MetaFilter } from '../../schemas/entity';
import type {
  Visualization,
  VisualizationConfig,
  VisualizationSummary,
} from '../../schemas/visualization';

/**
 * AppStateRepository — interface for Dev Waymark-owned application state.
 *
 * All Dev Waymark state is stored exclusively through this interface. Source
 * data never flows through here — that lives in the SourceDataAdapter.
 */
export interface AppStateRepository {
  /**
   * Run any pending app-state schema migrations. It's good practice to run
   * at startup before any other method to ensure the db is in sync with
   * the expectations of the codebase.
   */
  migrate(): Promise<void>;

  /**
   * Roll back the most recently applied migration. No-op if no migrations
   * have been applied.
   */
  rollbackLast(): Promise<void>;

  // ── Presets ──────────────────────────────────────────────────────────────

  /** Create a new preset. Returns the new preset's id. */
  savePreset(name: string, filters: MetaFilter[]): Promise<number>;

  /** Fetch a preset and its filters by id. Returns null if not found. */
  getPreset(id: number): Promise<PresetWithFilters | null>;

  /** List all presets (without filters). */
  listPresets(): Promise<Preset[]>;

  /**
   * List all presets with their filters in one round trip. Used when the
   * caller needs to compare current filters against every preset.
   */
  listPresetsWithFilters(): Promise<PresetWithFilters[]>;

  /**
   * Update a preset's name and replace its filters atomically. No-op if the
   * id does not exist.
   */
  updatePreset(id: number, name: string, filters: MetaFilter[]): Promise<void>;

  /** Delete a preset and its filters. No-op if the id does not exist. */
  deletePreset(id: number): Promise<void>;

  /** Test-mode only: delete every preset. */
  deleteAllPresets(): Promise<void>;

  // ── Visualizations ────────────────────────────────────────────────────────

  /** Create a new visualization. Returns the new visualization's id. */
  saveVisualization(
    name: string,
    description: string | null,
    presetId: number,
    config: VisualizationConfig
  ): Promise<number>;

  /** Fetch a visualization by id. Returns null if not found. */
  getVisualization(id: number): Promise<Visualization | null>;

  /** List all visualizations (summary only, config excluded). */
  listVisualizations(): Promise<VisualizationSummary[]>;

  /** Update an existing visualization's name, description, and config. */
  updateVisualization(
    id: number,
    name: string,
    description: string | null,
    config: VisualizationConfig
  ): Promise<void>;

  /** Delete a visualization. No-op if the id does not exist. */
  deleteVisualization(id: number): Promise<void>;

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  /** Release held connections/resources. */
  close(): Promise<void>;
}
