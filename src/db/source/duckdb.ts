import { DuckDBInstance } from '@duckdb/node-api';
import type { DuckDBConnection, DuckDBValue } from '@duckdb/node-api';
import type { InListFragment, SourceDataAdapter, SqlParam } from './adapter';

/** Parse a duckdb source URL to the folder DuckDB reads Parquet from. */
export function parseParquetLocation(url: string): string {
  return url.replace(/^file:\/\//, '').replace(/\/+$/, '');
}

function escapeSqlString(value: string): string {
  return value.replace(/'/g, "''");
}

// DuckDB returns BIGINT as a JS bigint, which Zod and JSON both reject. Entity
// ids are 53-bit by construction and counts fit, so Number is lossless here.
function toPlainRow<T>(row: Record<string, unknown>): T {
  const plain: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    plain[key] = typeof value === 'bigint' ? Number(value) : value;
  }
  return plain as T;
}

/**
 * Reads entities and entity_metadata from Parquet files in one folder, exposed
 * as views so the repository's SQL runs unchanged. Strictly read-only.
 */
export class DuckdbSourceAdapter implements SourceDataAdapter {
  private constructor(private instance: DuckDBInstance) {}

  static async create(url: string): Promise<DuckdbSourceAdapter> {
    const location = escapeSqlString(parseParquetLocation(url));
    const instance = await DuckDBInstance.create(':memory:');
    const connection = await instance.connect();
    try {
      for (const table of ['entities', 'entity_metadata']) {
        await connection.run(
          `CREATE VIEW ${table} AS SELECT * FROM read_parquet('${location}/${table}.parquet')`
        );
      }
    } finally {
      connection.closeSync();
    }
    return new DuckdbSourceAdapter(instance);
  }

  // One connection per call: a DuckDB connection runs one statement at a time,
  // and the repository issues queries concurrently.
  private async withConnection<T>(run: (connection: DuckDBConnection) => Promise<T>): Promise<T> {
    const connection = await this.instance.connect();
    try {
      return await run(connection);
    } finally {
      connection.closeSync();
    }
  }

  async query<T extends Record<string, unknown>>(
    sql: string,
    params: SqlParam[] = []
  ): Promise<T[]> {
    return this.withConnection(async connection => {
      const reader = await connection.runAndReadAll(sql, params as DuckDBValue[]);
      return reader.getRowObjectsJS().map(row => toPlainRow<T>(row));
    });
  }

  async execute(): Promise<void> {
    throw new Error('DuckDB source is read-only');
  }

  async validateConnection(): Promise<void> {
    await this.query('SELECT 1 FROM entities LIMIT 1');
  }

  async close(): Promise<void> {
    this.instance.closeSync();
  }

  inList(column: string, ids: number[]): InListFragment {
    return {
      sql: `${column} IN (SELECT unnest(from_json(?, '["BIGINT"]')))`,
      params: [JSON.stringify(ids)],
    };
  }
}
