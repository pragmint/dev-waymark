import type { Preset, PresetWithTree } from '../../schemas/preset';
import type { FilterTree } from '../../schemas/filterTree';
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
  savePreset(name: string, tree: FilterTree): Promise<number>;

  /** Fetch a preset and its filter tree by id. Returns null if not found. */
  getPreset(id: number): Promise<PresetWithTree | null>;

  /** List all presets (without their filter trees). */
  listPresets(): Promise<Preset[]>;

  /**
   * List all presets with their filter trees in one round trip. Used when the
   * caller needs to compare current filters against every preset.
   */
  listPresetsWithTree(): Promise<PresetWithTree[]>;

  /**
   * Update a preset's name and replace its filter tree atomically. No-op if the
   * id does not exist.
   */
  updatePreset(id: number, name: string, tree: FilterTree): Promise<void>;

  /** Delete a preset and its filter tree. No-op if the id does not exist. */
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
