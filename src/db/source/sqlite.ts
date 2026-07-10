import { Database } from 'bun:sqlite';
import { applySourceSchema } from './schema';
import type { InListFragment, SourceDataAdapter, SqlParam, SqlScalar } from './adapter';

export class SqliteSourceAdapter implements SourceDataAdapter {
  private db: Database;

  /**
   * @param input  File path, `:memory:` for an in-memory database, or an
   *               already-open `Database` instance (e.g. one produced by
   *               `Database.deserialize()` from a snapshot).
   * @param applySchema  If true, apply the expected source schema immediately.
   *                     Use this only for in-memory or freshly-created databases
   *                     — configured source databases are assumed to have the
   *                     schema already.
   */
  constructor(input: string | Database, applySchema = false) {
    if (typeof input === 'string') {
      this.db = new Database(input);
      this.db.query('PRAGMA journal_mode = WAL').run();
    } else {
      this.db = input;
    }
    this.db.query('PRAGMA foreign_keys = ON').run();
    if (applySchema) {
      applySourceSchema(this.db);
    }
  }

  async query<T extends Record<string, unknown>>(
    sql: string,
    params: SqlParam[] = []
  ): Promise<T[]> {
    // bun:sqlite only binds scalars; the number[] shape of SqlParam is
    // exclusive to the Postgres = ANY(?) path and never reaches this adapter
    // (sqlite inList() stringifies ids into a single scalar bind).
    return this.db.query(sql).all(...(params as SqlScalar[])) as T[];
  }

  async execute(sql: string, params: SqlParam[] = []): Promise<void> {
    this.db.query(sql).run(...(params as SqlScalar[]));
  }

  async validateConnection(): Promise<void> {
    this.db.query('SELECT 1').get();
  }

  async close(): Promise<void> {
    this.db.close();
  }

  inList(column: string, ids: number[]): InListFragment {
    return {
      sql: `${column} IN (SELECT value FROM json_each(?))`,
      params: [JSON.stringify(ids)],
    };
  }

  /** Expose the raw Database for tests and the seed pipeline. */
  getDb(): Database {
    return this.db;
  }
}
