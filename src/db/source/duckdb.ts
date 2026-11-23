import { DuckDBInstance } from '@duckdb/node-api';
import type { DuckDBConnection, DuckDBValue } from '@duckdb/node-api';
import type { InListFragment, SourceDataAdapter, SqlParam } from './adapter';
import { CONTRACT_COLUMNS, LINEAGE_SCHEMA } from '../../domain/lineage';
import { LatestSnapshotSchema, SnapshotManifestSchema } from '../../schemas/pipelineSnapshot';
import { secretStatements } from './duckdbStorage';

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

// Each table's files, derived tables by name and raw ones as `raw.<name>`.
type TableFiles = Map<string, string[]>;

const RAW_PREFIX = 'raw.';

async function readColumnMap(connection: DuckDBConnection, path: string): Promise<string | null> {
  const reader = await connection.runAndReadAll(
    `SELECT decode(value) AS value FROM parquet_kv_metadata('${escapeSqlString(path)}')
     WHERE decode(key) = '${COLUMNS_METADATA_KEY}'`
  );
  const value = reader.getRowObjectsJS()[0]?.value;
  return typeof value === 'string' ? value : null;
}

/**
 * A table's column map: the union of its files' maps, since each file is one job's part of it.
 * A map that isn't column → references is returned as is, for the repository to reject.
 */
async function tableColumnMap(
  connection: DuckDBConnection,
  paths: string[]
): Promise<string | null> {
  const merged = new Map<string, Set<string>>();
  for (const path of paths) {
    const text = await readColumnMap(connection, path);
    if (text === null) continue;
    const parsed: unknown = JSON.parse(text);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return text;
    for (const [column, refs] of Object.entries(parsed)) {
      if (!Array.isArray(refs) || !refs.every(ref => typeof ref === 'string')) return text;
      const known = merged.get(column) ?? new Set<string>();
      for (const ref of refs) known.add(ref);
      merged.set(column, known);
    }
  }
  if (merged.size === 0) return null;
  const columns = [...merged.keys()].sort();
  return JSON.stringify(
    Object.fromEntries(columns.map(c => [c, [...(merged.get(c) ?? [])].sort()]))
  );
}

async function readJson(connection: DuckDBConnection, url: string): Promise<unknown> {
  const reader = await connection.runAndReadAll(
    `SELECT content FROM read_text('${escapeSqlString(url)}')`
  );
  return JSON.parse(String(reader.getRowObjectsJS()[0]?.content));
}

/** A plain folder: `<name>.parquet` tables, and raw tables in the sibling `raw/<name>/`. */
async function folderFiles(connection: DuckDBConnection, location: string): Promise<TableFiles> {
  const files: TableFiles = new Map();
  const tables = tableNamesFromPaths(await globPaths(connection, `${location}/*.parquet`), false);
  for (const table of tables) files.set(table, [`${location}/${table}.parquet`]);
  const rawLocation = rawLocationFor(location);
  const rawPaths = await globPaths(connection, `${rawLocation}/*/*.parquet`);
  for (const table of tableNamesFromPaths(rawPaths, true)) {
    files.set(`${RAW_PREFIX}${table}`, [`${rawLocation}/${table}/*.parquet`]);
  }
  return files;
}

const PINNED_MANIFEST = /^(.*)\/snapshots\/[^/]+\.json$/;

/**
 * The manifest a source URL names: a manifest URL itself (`<root>/snapshots/<id>.json`, to pin
 * a snapshot), or the one `<root>/latest.json` publishes. Null for a plain folder.
 */
async function findManifest(
  connection: DuckDBConnection,
  location: string
): Promise<{ root: string; url: string } | null> {
  const pinned = PINNED_MANIFEST.exec(location);
  if (pinned) return { root: pinned[1] ?? '', url: location };
  const latestUrl = `${location}/latest.json`;
  if ((await globPaths(connection, latestUrl)).length === 0) return null;
  const latest = LatestSnapshotSchema.parse(await readJson(connection, latestUrl));
  return { root: location, url: `${location}/${latest.manifest}` };
}

/** A snapshot's tables, each resolved to exactly the files its manifest lists. */
async function snapshotFiles(
  connection: DuckDBConnection,
  manifest: { root: string; url: string }
): Promise<TableFiles> {
  const parsed = SnapshotManifestSchema.parse(await readJson(connection, manifest.url));
  const files: TableFiles = new Map();
  for (const [table, entry] of Object.entries(parsed.tables)) {
    const name = table.startsWith(RAW_PREFIX) ? table.slice(RAW_PREFIX.length) : table;
    if (!TABLE_NAME.test(name)) throw new Error(`Invalid table name in manifest: ${table}`);
    if (name.startsWith('_dlt')) continue;
    files.set(
      table,
      entry.files.map(key => `${manifest.root}/${key}`)
    );
  }
  return files;
}

function readParquet(paths: string[]): string {
  const list = paths.map(path => `'${escapeSqlString(path)}'`).join(', ');
  return `read_parquet([${list}], union_by_name = true)`;
}

/** Views over the derived tables, plain and with contract columns; returns their column maps. */
async function registerDerived(
  connection: DuckDBConnection,
  files: TableFiles,
  tables: string[]
): Promise<Record<string, string>> {
  const columnMaps: Record<string, string> = {};
  await connection.run(`CREATE SCHEMA ${LINEAGE_SCHEMA}`);
  for (const table of tables) {
    const paths = files.get(table) ?? [];
    const source = readParquet(paths);
    const described = await connection.runAndReadAll(`DESCRIBE SELECT * FROM ${source}`);
    const contract = described
      .getRowObjectsJS()
      .map(row => String(row.column_name))
      .filter(name => CONTRACT_COLUMNS.includes(name));
    const exclude = contract.length > 0 ? ` EXCLUDE (${contract.join(', ')})` : '';
    await connection.run(`CREATE VIEW "${table}" AS SELECT *${exclude} FROM ${source}`);
    await connection.run(`CREATE VIEW ${LINEAGE_SCHEMA}."${table}" AS SELECT * FROM ${source}`);
    const columnMap = await tableColumnMap(connection, paths);
    if (columnMap !== null) columnMaps[table] = columnMap;
  }
  return columnMaps;
}

async function registerTables(
  connection: DuckDBConnection,
  files: TableFiles,
  location: string
): Promise<Registered> {
  const names = [...files.keys()].sort();
  const tables = names.filter(name => !name.startsWith(RAW_PREFIX));
  const rawTables = names.filter(name => name.startsWith(RAW_PREFIX));
  for (const table of REQUIRED_TABLES) {
    if (!tables.includes(table)) throw new Error(`Missing table ${table} in ${location}`);
  }
  const columnMaps = await registerDerived(connection, files, tables);
  if (rawTables.length > 0) await connection.run('CREATE SCHEMA raw');
  for (const table of rawTables) {
    const source = readParquet(files.get(table) ?? []);
    await connection.run(
      `CREATE VIEW raw."${table.slice(RAW_PREFIX.length)}" AS SELECT * FROM ${source}`
    );
  }
  return { tables: [...tables, ...rawTables], columnMaps };
}

/**
 * Reads a pipeline's Parquet tables, exposed as views so the repository's SQL
 * runs unchanged. The URL is one of:
 *
 * - a bucket root with a `latest.json`: the published snapshot, each table
 *   read from exactly the files its manifest lists (pipeline/snapshot.py);
 * - a manifest, `<root>/snapshots/<id>.json`, to pin one snapshot;
 * - a plain folder: every `<name>.parquet` in it, and every raw table in its
 *   sibling `raw/` folder.
 *
 * Tables become views `<name>` and raw ones `raw.<name>`, so lineage can
 * follow `_sources` down to raw records (see pipeline/CONTRACT.md). `s3://`
 * and `az://` URLs take credentials from the environment (duckdbStorage.ts).
 * The snapshot is resolved once, at startup. Strictly read-only.
 */
export class DuckdbSourceAdapter implements SourceDataAdapter {
  private constructor(
    private instance: DuckDBInstance,
    private registered: Registered
  ) {}

  static async create(
    url: string,
    env: Record<string, string | undefined> = process.env
  ): Promise<DuckdbSourceAdapter> {
    const location = parseParquetLocation(url);
    const instance = await DuckDBInstance.create(':memory:');
    const connection = await instance.connect();
    let registered: Registered;
    try {
      // Pipeline dates are UTC; show timestamps the same way whatever the host zone.
      await connection.run("SET GLOBAL TimeZone = 'UTC'");
      for (const statement of secretStatements(location, env)) await connection.run(statement);
      const manifest = await findManifest(connection, location);
      const files = manifest
        ? await snapshotFiles(connection, manifest)
        : await folderFiles(connection, location);
      registered = await registerTables(connection, files, location);
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
