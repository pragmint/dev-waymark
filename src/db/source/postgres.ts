import { Pool } from 'pg';
import type { SourceDataAdapter, SqlParam } from './adapter';

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
    params: SqlParam[] = []
  ): Promise<T[]> {
    const pgSql = toPgPlaceholders(sql);
    const result = await this.pool.query(pgSql, params as (string | number | null)[]);
    return result.rows as T[];
  }

  async execute(sql: string, params: SqlParam[] = []): Promise<void> {
    const pgSql = toPgPlaceholders(sql);
    await this.pool.query(pgSql, params as (string | number | null)[]);
  }

  async validateConnection(): Promise<void> {
    await this.pool.query('SELECT 1');
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}
