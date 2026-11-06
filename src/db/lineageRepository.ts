import type { SourceDataAdapter } from './source/adapter';
import { LineageRowSchema, SourceRefsSchema } from '../schemas/lineage';
import type { LineageRow, ParentGroup, SourceRef } from '../schemas/lineage';
import {
  DERIVED_ID_COLUMN,
  PREVIEW_CHARS,
  RAW_PREFIX,
  groupSourcesByTable,
  idColumnFor,
  isRawTable,
  planHop,
} from '../domain/lineage';

export type RowOptions = { limit?: number; preview?: boolean };

export type LineageRepository = {
  tables(): string[];
  hasTable(table: string): boolean;
  /** One row with every column in full, `_sources` included. */
  getRow(table: string, rowId: string): Promise<LineageRow | null>;
  /** Rows by id, in id order. */
  getRows(table: string, rowIds: string[], options?: RowOptions): Promise<LineageRow[]>;
  /** The distinct `_sources` of some rows of a derived table: the expand-to-raw fetcher. */
  getSources(table: string, rowIds: string[]): Promise<SourceRef[]>;
  /** A row's sources fetched as rows, one group per source table. */
  getParents(sources: SourceRef[], limit: number): Promise<ParentGroup[]>;
};

function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

// Raw tables live in the `raw` schema; derived tables in the default one.
function tableRef(table: string): string {
  return isRawTable(table)
    ? `raw.${quoteIdent(table.slice(RAW_PREFIX.length))}`
    : quoteIdent(table);
}

// Ids travel as one JSON-encoded parameter, so a hop of thousands of rows is
// still a single bind (the same approach as DuckdbSourceAdapter.inList).
function idMatch(table: string): string {
  const ids = `unnest(from_json(?, '["VARCHAR"]'))`;
  const column = idColumnFor(table);
  return isRawTable(table)
    ? `${column} IN (SELECT ${ids})`
    : `${column} IN (SELECT CAST(${ids} AS BIGINT))`;
}

function previewColumns(columns: Array<{ name: string; type: string }>): string {
  return columns
    .map(({ name, type }) =>
      type === 'VARCHAR'
        ? `left(${quoteIdent(name)}, ${PREVIEW_CHARS + 1}) AS ${quoteIdent(name)}`
        : quoteIdent(name)
    )
    .join(', ');
}

function parseRow(raw: { row_id: string; row: string }): LineageRow {
  const values = JSON.parse(raw.row) as Record<string, unknown>;
  // A 53-bit _row_id survives JSON, but keep the exact text the id came from.
  if (DERIVED_ID_COLUMN in values) values[DERIVED_ID_COLUMN] = raw.row_id;
  return LineageRowSchema.parse({ rowId: raw.row_id, values });
}

export function createLineageRepository(
  adapter: SourceDataAdapter,
  lineageTables: string[]
): LineageRepository {
  const known = new Set(lineageTables);
  const columnCache = new Map<string, Promise<Array<{ name: string; type: string }>>>();

  function assertTable(table: string): void {
    if (!known.has(table)) throw new Error(`Unknown lineage table: ${table}`);
  }

  function columnsOf(table: string) {
    let columns = columnCache.get(table);
    if (!columns) {
      columns = adapter
        .query<{ column_name: string; column_type: string }>(`DESCRIBE ${tableRef(table)}`)
        .then(rows => rows.map(row => ({ name: row.column_name, type: row.column_type })));
      columnCache.set(table, columns);
    }
    return columns;
  }

  async function selectRows(table: string, where: string, params: string[], options: RowOptions) {
    const id = `CAST(${idColumnFor(table)} AS VARCHAR)`;
    const select = options.preview ? previewColumns(await columnsOf(table)) : '*';
    const limit = options.limit === undefined ? '' : `LIMIT ${Math.max(0, options.limit)}`;
    const rows = await adapter.query<{ row_id: string; row: string }>(
      `SELECT ${id} AS row_id, CAST(to_json(t) AS VARCHAR) AS row
       FROM (SELECT ${select} FROM ${tableRef(table)} WHERE ${where}) AS t
       ORDER BY row_id ${limit}`,
      params
    );
    return rows.map(parseRow);
  }

  const repo: LineageRepository = {
    tables: () => [...lineageTables],

    hasTable: table => known.has(table),

    async getRow(table, rowId) {
      assertTable(table);
      const rows = await selectRows(table, idMatch(table), [JSON.stringify([rowId])], {
        limit: 1,
      });
      return rows[0] ?? null;
    },

    async getRows(table, rowIds, options = {}) {
      assertTable(table);
      if (rowIds.length === 0) return [];
      return selectRows(table, idMatch(table), [JSON.stringify(rowIds)], options);
    },

    async getSources(table, rowIds) {
      assertTable(table);
      if (isRawTable(table) || rowIds.length === 0) return [];
      const rows = await adapter.query<{ table: string; row_id: string }>(
        `SELECT DISTINCT source."table" AS "table", source.row_id AS row_id
         FROM (SELECT unnest(_sources) AS source FROM ${tableRef(table)} WHERE ${idMatch(table)})`,
        [JSON.stringify(rowIds)]
      );
      return SourceRefsSchema.parse(rows);
    },

    async getParents(sources, limit) {
      // A source table this run doesn't have (raw data not copied alongside
      // the tables, say) still shows, with its count but no rows.
      return Promise.all(
        planHop(groupSourcesByTable(sources)).map(async ({ table, ids }) => ({
          table,
          isRaw: isRawTable(table),
          available: known.has(table),
          total: ids.length,
          rows: known.has(table)
            ? await repo.getRows(table, ids.slice(0, limit), { preview: true })
            : [],
        }))
      );
    },
  };
  return repo;
}
