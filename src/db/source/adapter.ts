/**
 * SourceDataAdapter — read-oriented adapter for client/analytical source data.
 *
 * Step Engine never owns source data and never creates or migrates its schema.
 * The expected schema is documented in src/db/source/schema.ts.
 *
 * The `execute` method is provided so the SQLite adapter can support the
 * Parquet seed pipeline during local development. External adapters treat
 * source data as strictly read-only.
 */

export type SqlParam = string | number | null;

export interface SourceDataAdapter {
  /**
   * Execute a SELECT query and return all matching rows.
   * SQL must use `?` positional placeholders; the adapter translates to the
   * driver's native format (e.g., $1/$2 for Postgres).
   */
  query<T extends Record<string, unknown>>(sql: string, params?: SqlParam[]): Promise<T[]>;

  /**
   * Execute a data-modification statement (INSERT / UPDATE / DELETE).
   * Only meaningful for local SQLite source databases used during development
   * or seeding. External adapters may reject or no-op this call.
   */
  execute(sql: string, params?: SqlParam[]): Promise<void>;

  /** Verify the adapter can reach the underlying database. */
  validateConnection(): Promise<void>;

  /** Release any held connections/resources. */
  close(): Promise<void>;
}
