import { DuckDBInstance } from '@duckdb/node-api';
import type { DuckDBConnection, DuckDBValue } from '@duckdb/node-api';
import type { InListFragment, SourceDataAdapter, SqlParam } from './adapter';
import { DERIVED_ID_COLUMN, LINEAGE_SCHEMA, SOURCES_COLUMN } from '../../domain/lineage';

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

const REQUIRED_TABLES = ['entities', 'entity_metadata'];
const TABLE_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** The raw folder of a pipeline run, given its `tables/` folder: `<run>/raw`. */
export function rawLocationFor(location: string): string {
  return location.replace(/\/[^/]*$/, '') + '/raw';
}

/** Table names from Parquet paths: `<dir>/<name>.parquet`, or `<dir>/<name>/<file>` for raw. */
export function tableNamesFromPaths(paths: string[], nested: boolean): string[] {
  const names = paths.map(path => {
    const parts = path.split('/');
    return nested ? (parts.at(-2) ?? '') : (parts.at(-1) ?? '').replace(/\.parquet$/, '');
  });
  // dlt's own bookkeeping tables start with `_dlt`; names that would need
  // quoting are skipped so every registered name is a safe identifier.
  return [...new Set(names)]
    .filter(name => TABLE_NAME.test(name) && !name.startsWith('_dlt'))
    .sort();
}

async function globPaths(connection: DuckDBConnection, pattern: string): Promise<string[]> {
  const reader = await connection.runAndReadAll(
    `SELECT file FROM glob('${escapeSqlString(pattern)}')`
  );
  return reader.getRowObjectsJS().map(row => String(row.file));
}

// The key runner.py writes each job's column map under, in the Parquet file's own metadata.
const COLUMNS_METADATA_KEY = 'waymark_columns';

type Registered = { tables: string[]; columnMaps: Record<string, string> };

async function readColumnMap(connection: DuckDBConnection, path: string): Promise<string | null> {
  const reader = await connection.runAndReadAll(
    `SELECT decode(value) AS value FROM parquet_kv_metadata('${path}')
     WHERE decode(key) = '${COLUMNS_METADATA_KEY}'`
  );
  const value = reader.getRowObjectsJS()[0]?.value;
  return typeof value === 'string' ? value : null;
}

async function registerTables(connection: DuckDBConnection, location: string): Promise<Registered> {
  const tables = tableNamesFromPaths(await globPaths(connection, `${location}/*.parquet`), false);
  for (const table of REQUIRED_TABLES) {
    if (!tables.includes(table)) throw new Error(`Missing ${location}/${table}.parquet`);
  }
  const columnMaps: Record<string, string> = {};
  await connection.run(`CREATE SCHEMA ${LINEAGE_SCHEMA}`);
  for (const table of tables) {
    const path = escapeSqlString(`${location}/${table}.parquet`);
    const source = `read_parquet('${path}')`;
    const described = await connection.runAndReadAll(`DESCRIBE SELECT * FROM ${source}`);
    const contract = described
      .getRowObjectsJS()
      .map(row => String(row.column_name))
      .filter(name => name === DERIVED_ID_COLUMN || name === SOURCES_COLUMN);
    const exclude = contract.length > 0 ? ` EXCLUDE (${contract.join(', ')})` : '';
    await connection.run(`CREATE VIEW "${table}" AS SELECT *${exclude} FROM ${source}`);
    await connection.run(`CREATE VIEW ${LINEAGE_SCHEMA}."${table}" AS SELECT * FROM ${source}`);
    const columnMap = await readColumnMap(connection, path);
    if (columnMap !== null) columnMaps[table] = columnMap;
  }

  const rawLocation = rawLocationFor(location);
  const rawTables = tableNamesFromPaths(
    await globPaths(connection, `${rawLocation}/*/*.parquet`),
    true
  );
  if (rawTables.length > 0) await connection.run('CREATE SCHEMA raw');
  for (const table of rawTables) {
    const files = escapeSqlString(`${rawLocation}/${table}/*.parquet`);
    await connection.run(
      `CREATE VIEW raw."${table}" AS SELECT * FROM read_parquet('${files}', union_by_name = true)`
    );
  }
  return { tables: [...tables, ...rawTables.map(table => `raw.${table}`)], columnMaps };
}

/**
 * Reads a pipeline run's Parquet tables, exposed as views so the repository's
 * SQL runs unchanged. Every `<name>.parquet` in the folder becomes a view
 * `<name>`, and every raw table in the run's sibling `raw/` folder becomes
 * `raw.<name>`, so lineage can follow `_sources` down to raw records (see
 * pipeline/CONTRACT.md). Strictly read-only.
 */
export class DuckdbSourceAdapter implements SourceDataAdapter {
  private constructor(
    private instance: DuckDBInstance,
    private registered: Registered
  ) {}

  static async create(url: string): Promise<DuckdbSourceAdapter> {
    const location = parseParquetLocation(url);
    const instance = await DuckDBInstance.create(':memory:');
    const connection = await instance.connect();
    let registered: Registered;
    try {
      // Pipeline dates are UTC; show timestamps the same way whatever the host zone.
      await connection.run("SET GLOBAL TimeZone = 'UTC'");
      registered = await registerTables(connection, location);
    } catch (err) {
      connection.closeSync();
      instance.closeSync();
      throw err;
    }
    connection.closeSync();
    return new DuckdbSourceAdapter(instance, registered);
  }

  /** Every table registered, raw ones as `raw.<name>`. */
  listLineageTables(): string[] {
    return [...this.registered.tables];
  }

  /** Each table's column map as the pipeline wrote it (JSON text), for tables that have one. */
  listColumnMaps(): Record<string, string> {
    return { ...this.registered.columnMaps };
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
