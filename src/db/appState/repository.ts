import type { Dataset, DatasetWithFilters } from '../../schemas/dataset';
import type { MetaFilter } from '../../schemas/entity';

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

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  /** Release held connections/resources. */
  close(): Promise<void>;
}
