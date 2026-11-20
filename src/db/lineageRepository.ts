import type { SourceDataAdapter } from './source/adapter';
import { ColumnMapSchema, LineageRowSchema, SourceRefsSchema } from '../schemas/lineage';
import type { ColumnMap, LineageRow, ParentGroup, SourceRef } from '../schemas/lineage';
import { JSON_PATH_PATTERN } from '../domain/columnLineage';
import type { FieldFetchers, RowSource } from '../domain/columnLineage';
import {
  DERIVED_ID_COLUMN,
  LINEAGE_SCHEMA,
  PREVIEW_CHARS,
  RAW_PREFIX,
  groupSourcesByTable,
  idColumnFor,
  isRawTable,
  planHop,
} from '../domain/lineage';

export type RowOptions = {
  limit?: number;
  preview?: boolean;
  /** `column:$.path` labels: values pulled out of JSON text, added as columns of that name. */
  extracts?: string[];
};

export type LineageRepository = FieldFetchers & {
  tables(): string[];
  hasTable(table: string): boolean;
  /** One row with every column in full, `_sources` included. */
  getRow(table: string, rowId: string): Promise<LineageRow | null>;
  /** Rows by id, in id order. */
  getRows(table: string, rowIds: string[], options?: RowOptions): Promise<LineageRow[]>;
  /** The distinct `_sources` of some rows of a derived table: the expand-to-raw fetcher. */
  getSources(table: string, rowIds: string[]): Promise<SourceRef[]>;
  /**
   * A row's sources fetched as rows, one group per source table. `highlight` names, per table,
   * the columns to show first; `column:$.path` labels are extracted from JSON text.
   */
  getParents(
    sources: SourceRef[],
    limit: number,
    highlight?: Record<string, string[]>
  ): Promise<ParentGroup[]>;
  /** Each table's column map, for the tables whose files carry a valid one. */
  columnMaps(): Record<string, ColumnMap>;
};

function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

// Raw tables live in the `raw` schema; derived tables, with their contract
// columns, in the lineage schema.
function tableRef(table: string): string {
  return isRawTable(table)
    ? `raw.${quoteIdent(table.slice(RAW_PREFIX.length))}`
    : `${LINEAGE_SCHEMA}.${quoteIdent(table)}`;
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

function extractColumns(extracts: string[]): string {
  return extracts
    .map(label => {
      const [column = '', path = ''] = label.split(':');
      if (!JSON_PATH_PATTERN.test(path)) throw new Error(`Invalid JSON path in ${label}`);
      return `, json_extract_string(${quoteIdent(column)}, '${path}') AS ${quoteIdent(label)}`;
    })
    .join('');
}

// Maps that fail validation are dropped: lineage then falls back to whole rows for that table.
function parseColumnMaps(raw: Record<string, string>): Record<string, ColumnMap> {
  const maps: Record<string, ColumnMap> = {};
  for (const [table, json] of Object.entries(raw)) {
    try {
      maps[table] = ColumnMapSchema.parse(JSON.parse(json));
    } catch (err) {
      console.error(`[dev-waymark] Ignoring the column map of ${table}:`, err);
    }
  }
  return maps;
}

function parseRow(raw: { row_id: string; row: string }): LineageRow {
  const values = JSON.parse(raw.row) as Record<string, unknown>;
  // A 53-bit _row_id survives JSON, but keep the exact text the id came from.
  if (DERIVED_ID_COLUMN in values) values[DERIVED_ID_COLUMN] = raw.row_id;
  return LineageRowSchema.parse({ rowId: raw.row_id, values });
}

export function createLineageRepository(
  adapter: SourceDataAdapter,
  lineageTables: string[],
  rawColumnMaps: Record<string, string> = {}
): LineageRepository {
  const known = new Set(lineageTables);
  const maps = parseColumnMaps(rawColumnMaps);
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
    const columns = options.preview ? previewColumns(await columnsOf(table)) : '*';
    const select = columns + extractColumns(options.extracts ?? []);
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

    columnMaps: () => maps,

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

    async rowSources(table, rowIds) {
      assertTable(table);
      if (isRawTable(table) || rowIds.length === 0) return [];
      const rows = await adapter.query<RowSource>(
        `SELECT DISTINCT CAST(_row_id AS VARCHAR) AS "rowId", source."table" AS "table",
           source.row_id AS row_id
         FROM (SELECT _row_id, unnest(_sources) AS source FROM ${tableRef(table)}
               WHERE ${idMatch(table)})`,
        [JSON.stringify(rowIds)]
      );
      return rows.map(({ rowId, table: source, row_id }) => ({ rowId, table: source, row_id }));
    },

    async columnValues(table, column, rowIds) {
      if (!known.has(table) || rowIds.length === 0) return {};
      // A filter names a column the pipeline checked exists; one this run lacks matches nothing.
      if (!(await columnsOf(table)).some(({ name }) => name === column)) return {};
      const rows = await adapter.query<{ row_id: string; value: string | null }>(
        `SELECT CAST(${idColumnFor(table)} AS VARCHAR) AS row_id,
           CAST(${quoteIdent(column)} AS VARCHAR) AS value
         FROM ${tableRef(table)} WHERE ${idMatch(table)}`,
        [JSON.stringify(rowIds)]
      );
      return Object.fromEntries(rows.map(({ row_id, value }) => [row_id, value]));
    },

    async getParents(sources, limit, highlight = {}) {
      // A source table this run doesn't have (raw data not copied alongside
      // the tables, say) still shows, with its count but no rows.
      return Promise.all(
        planHop(groupSourcesByTable(sources)).map(async ({ table, ids }) => {
          const columns = highlight[table] ?? [];
          const extracts = columns.filter(label => label.includes(':'));
          return {
            table,
            isRaw: isRawTable(table),
            available: known.has(table),
            total: ids.length,
            highlight: columns,
            rows: known.has(table)
              ? await repo.getRows(table, ids.slice(0, limit), { preview: true, extracts })
              : [],
          };
        })
      );
    },
  };
  return repo;
}
