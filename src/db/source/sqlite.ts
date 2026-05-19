import { Database } from 'bun:sqlite';
import { applySourceSchema } from './schema';
import type { SourceDataAdapter, SqlParam } from './adapter';

export class SqliteSourceAdapter implements SourceDataAdapter {
  private db: Database;

  /**
   * @param path   File path or `:memory:` for an in-memory database.
   * @param applySchema  If true, apply the expected source schema immediately.
   *                     Use this only for in-memory databases — configured
   *                     source databases are assumed to have the schema already.
   */
  constructor(path: string, applySchema = false) {
    this.db = new Database(path);
    this.db.query('PRAGMA journal_mode = WAL').run();
    this.db.query('PRAGMA foreign_keys = ON').run();
    if (applySchema) {
      applySourceSchema(this.db);
    }
  }

  async query<T extends Record<string, unknown>>(
    sql: string,
    params: SqlParam[] = []
  ): Promise<T[]> {
    return this.db.query(sql).all(...params) as T[];
  }

  async execute(sql: string, params: SqlParam[] = []): Promise<void> {
    this.db.query(sql).run(...params);
  }

  async validateConnection(): Promise<void> {
    this.db.query('SELECT 1').get();
  }

  async close(): Promise<void> {
    this.db.close();
  }

  /** Expose the raw Database for tests and the seed pipeline. */
  getDb(): Database {
    return this.db;
  }
}
