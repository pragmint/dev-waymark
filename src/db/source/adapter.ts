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

// Scalars accepted by every driver — the common shape for individual bind values.
export type SqlScalar = string | number | null;

// The full union of things the adapter may bind. `number[]` is only produced by
// the Postgres inList() path (bound as a single array parameter via = ANY(?));
// SQLite's inList() stringifies the ids and binds them as a single string.
export type SqlParam = SqlScalar | number[];

export type InListFragment = { sql: string; params: SqlParam[] };

export interface SourceDataAdapter {
  /**
   * Execute a SELECT query and return all matching rows.
   * SQL must use `?` positional placeholders; the adapter translates to the
   * driver's native format (e.g., $1/$2 for Postgres).
   */
  query<T extends Record<string, unknown>>(sql: string, params?: SqlParam[]): Promise<T[]>;

  /**
   * Membership test for an id list as a SINGLE bound parameter. Per-id
   * placeholders overflow the Postgres wire protocol's Int16 parameter count
   * (>65 535 ids) and bun:sqlite's binding layer at the same threshold. Id
   * lists on the attach-metadata path span whole filtered populations, so
   * they reach those sizes in production.
   */
  inList(column: string, ids: number[]): InListFragment;

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
