// The container's entry point: read the inputs the runner staged, compute the table, and write it
// with the contract's column types. DuckDB is only the Parquet reader and writer here.
import {
  DuckDBConnection,
  DuckDBInstance,
  DuckDBTimestampTZValue,
  type DuckDBValue,
  listValue,
  mapValue,
  structValue,
} from '@duckdb/node-api';
import { readJobEnv } from './contract';
import { type Entity, type LeadTimeRow, type Link, leadTimeByIssueType } from './leadTime';

type Row = Record<string, DuckDBValue>;

const OUTPUT_TABLE = `
  CREATE TABLE output (
    _row_id BIGINT,
    _sources STRUCT("table" VARCHAR, row_id VARCHAR)[],
    _fields MAP(VARCHAR, VARCHAR[]),
    issue_type VARCHAR,
    tickets BIGINT,
    avg_lead_time_hours DOUBLE,
    median_lead_time_hours DOUBLE
  )`;

const sqlString = (value: string) => `'${value.replaceAll("'", "''")}'`;

function bigintOrNull(value: DuckDBValue): bigint | null {
  return typeof value === 'bigint' ? value : null;
}

function textOrNull(value: DuckDBValue): string | null {
  return typeof value === 'string' ? value : null;
}

function bigintColumn(row: Row, column: string): bigint {
  const value = bigintOrNull(row[column]);
  if (value === null) {
    throw new Error(`${column} must be a BIGINT, got ${String(row[column])}`);
  }
  return value;
}

async function readRows(con: DuckDBConnection, uri: string, columns: string[]): Promise<Row[]> {
  const select = columns.map(column => `"${column}"`).join(', ');
  const reader = await con.runAndReadAll(`SELECT ${select} FROM read_parquet(${sqlString(uri)})`);
  return reader.getRowObjects();
}

function toEntity(row: Row): Entity {
  const merged = row.merged_at;
  return {
    _row_id: bigintColumn(row, '_row_id'),
    type: textOrNull(row.type),
    issue_type: textOrNull(row.issue_type),
    created_at: textOrNull(row.created_at),
    merged_at: merged instanceof DuckDBTimestampTZValue ? merged.micros : null,
  };
}

function toLink(row: Row): Link {
  return {
    _row_id: bigintColumn(row, '_row_id'),
    ticket_id: bigintOrNull(row.ticket_id),
    change_id: bigintOrNull(row.change_id),
  };
}

function appendNullable<T>(append: (value: T) => void, appendNull: () => void, value: T | null) {
  if (value === null) {
    appendNull();
  } else {
    append(value);
  }
}

async function writeRows(con: DuckDBConnection, rows: LeadTimeRow[], uri: string) {
  await con.run(OUTPUT_TABLE);
  const appender = await con.createAppender('output');
  const appendNull = () => appender.appendNull();
  for (const row of rows) {
    appender.appendBigInt(row._row_id);
    appender.appendList(listValue(row._sources.map(source => structValue(source))));
    appender.appendMap(
      mapValue(Object.entries(row._fields).map(([key, refs]) => ({ key, value: listValue(refs) })))
    );
    appendNullable(value => appender.appendVarchar(value), appendNull, row.issue_type);
    appender.appendBigInt(row.tickets);
    appendNullable(value => appender.appendDouble(value), appendNull, row.avg_lead_time_hours);
    appendNullable(value => appender.appendDouble(value), appendNull, row.median_lead_time_hours);
    appender.endRow();
  }
  appender.closeSync();
  await con.run(`COPY output TO ${sqlString(uri)} (FORMAT parquet)`);
}

async function main() {
  const env = readJobEnv(process.env);
  const instance = await DuckDBInstance.create(':memory:');
  const con = await instance.connect();
  try {
    const entities = await readRows(con, env.inputs.entities, [
      '_row_id',
      'type',
      'issue_type',
      'created_at',
      'merged_at',
    ]);
    const links = await readRows(con, env.inputs.ticket_change_links, [
      '_row_id',
      'ticket_id',
      'change_id',
    ]);
    const rows = leadTimeByIssueType(env.params.client, entities.map(toEntity), links.map(toLink));
    await writeRows(con, rows, env.output);
  } finally {
    con.closeSync();
    instance.closeSync();
  }
}

await main();
