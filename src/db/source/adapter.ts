/**
 * SourceDataAdapter — read-oriented adapter for client/analytical source data.
 *
 * Dev Waymark never owns source data and never creates or migrates its schema.
 * The expected schema is documented in src/db/source/schema.ts.
 *
 * The `execute` method is provided so the SQLite adapter can support the
 * Parquet seed pipeline during local development. External adapters treat
 * source data as strictly read-only.
 */

export type SqlParam = string | number | null;

// params may include adapter-specific types (e.g., a number[] for the Postgres
// ANY(?) path) so the array is typed as unknown[].
export type InListFragment = { sql: string; params: unknown[] };

export interface SourceDataAdapter {
  /**
   * Execute a SELECT query and return all matching rows.
   * SQL must use `?` positional placeholders; the adapter translates to the
   * driver's native format (e.g., $1/$2 for Postgres).
   *
   * `params` is typed as `unknown[]` to allow adapter-specific values such as
   * a `number[]` passed through from `inList()` for the Postgres ANY(?) path.
   * Each adapter casts internally to its driver's expected type.
   */
  query<T extends Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;

  /**
   * Return a SQL fragment and bound params for testing whether a column value
   * is contained in the given id list, using a single bound parameter so that
   * lists of any length (including >65 535) are safe on all adapters.
   *
   * - SQLite:  `column IN (SELECT value FROM json_each(?))` with JSON.stringify(ids)
   * - Postgres/Redshift: `column = ANY(?)` with the raw number[] (node-pg
   *   serialises JS arrays natively, one parameter regardless of list length)
   */
  inList(column: string, ids: number[]): InListFragment;

  /**
   * Execute a data-modification statement (INSERT / UPDATE / DELETE).
   * Only meaningful for local SQLite source databases used during development
   * or seeding. External adapters may reject or no-op this call.
   *
   * `params` is typed as `unknown[]` for the same reason as `query` above.
   */
  execute(sql: string, params?: unknown[]): Promise<void>;

  /** Verify the adapter can reach the underlying database. */
  validateConnection(): Promise<void>;

  /** Release any held connections/resources. */
  close(): Promise<void>;
}
