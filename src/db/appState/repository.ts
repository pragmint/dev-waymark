import type { Dataset, DatasetWithFilters } from '../../schemas/dataset';
import type { MetaFilter } from '../../schemas/entity';
import type {
  Visualization,
  VisualizationConfig,
  VisualizationSummary,
} from '../../schemas/visualization';

/**
 * AppStateRepository — interface for Step Engine-owned application state.
 *
 * All Step Engine state is stored exclusively through this interface. Source
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

  // ── Datasets ──────────────────────────────────────────────────────────────

  /** Create a new dataset. Returns the new dataset's id. */
  saveDataset(name: string, filters: MetaFilter[]): Promise<number>;

  /** Fetch a dataset and its filters by id. Returns null if not found. */
  getDataset(id: number): Promise<DatasetWithFilters | null>;

  /** List all datasets (without filters). */
  listDatasets(): Promise<Dataset[]>;

  /** Delete a dataset and its filters. No-op if the id does not exist. */
  deleteDataset(id: number): Promise<void>;

  // ── Visualizations ────────────────────────────────────────────────────────

  /** Create a new visualization. Returns the new visualization's id. */
  saveVisualization(
    name: string,
    description: string | null,
    datasetId: number,
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
