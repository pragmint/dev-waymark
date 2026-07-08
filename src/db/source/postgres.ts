import { Pool } from 'pg';
import type { InListFragment, SourceDataAdapter } from './adapter';

/**
 * Transform ? positional placeholders to Postgres-style $1, $2, ... placeholders.
 */
function toPgPlaceholders(sql: string): string {
  let i = 0;
  return sql.replace(/\?/g, () => `$${++i}`);
}

export class PostgresSourceAdapter implements SourceDataAdapter {
  protected pool: Pool;

  constructor(connectionString: string) {
    this.pool = new Pool({ connectionString });
  }

  async query<T extends Record<string, unknown>>(
    sql: string,
    params: unknown[] = []
  ): Promise<T[]> {
    const pgSql = toPgPlaceholders(sql);
    const result = await this.pool.query(pgSql, params as (string | number | null | number[])[]);
    return result.rows as T[];
  }

  async execute(sql: string, params: unknown[] = []): Promise<void> {
    const pgSql = toPgPlaceholders(sql);
    await this.pool.query(pgSql, params as (string | number | null | number[])[]);
  }

  async validateConnection(): Promise<void> {
    await this.pool.query('SELECT 1');
  }

  async close(): Promise<void> {
    await this.pool.end();
  }

  inList(column: string, ids: number[]): InListFragment {
    // node-pg serialises a JS number[] to a Postgres array literal natively,
    // so a single `= ANY(?)` parameter is safe for any list length.
    return { sql: `${column} = ANY(?)`, params: [ids] };
  }
}
