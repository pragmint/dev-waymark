import { ColumnMapSchema } from '../schemas/lineage';
import type { ColumnMap, ColumnRef, Hop } from '../schemas/lineage';
import { DERIVED_ID_COLUMN, FIELDS_COLUMN, MAX_HOPS, RAW_ID_COLUMN, isRawTable } from './lineage';

// Field-level lineage = which input columns feed each output column (a row's `_fields`, or its
// table's column map) combined with each row's `_sources` (which input rows). Tracing a field
// carries, for every row it reaches, the columns of that row the field needs, and follows only
// the sources those columns' references name: a filtered reference only its matching rows.

const REF_PATTERN =
  /^((?:raw\.)?[a-z][a-z0-9_]*)(?:\[([A-Za-z_][A-Za-z0-9_]*)=([^[\]]+)\])?\.([A-Za-z_][A-Za-z0-9_]*)(?::(\$(?:\.[A-Za-z0-9_]+)+))?$/;
export const JSON_PATH_PATTERN = /^\$(\.[A-Za-z0-9_]+)+$/;

export function parseColumnRef(ref: string): ColumnRef | null {
  const match = REF_PATTERN.exec(ref);
  if (!match) return null;
  const [, table = '', whereColumn, whereValue, column = '', path] = match;
  return {
    table,
    column,
    ...(path ? { path } : {}),
    ...(whereColumn && whereValue ? { where: { column: whereColumn, value: whereValue } } : {}),
  };
}

/** How a reference reads as a column label: `column`, or `column:$.path` inside JSON text. */
export function refLabel(ref: ColumnRef): string {
  return ref.path ? `${ref.column}:${ref.path}` : ref.column;
}

/** A reference as written in `_fields`: `table.label`, or `table[column=value].label`. */
export function refText(ref: ColumnRef): string {
  const where = ref.where ? `[${ref.where.column}=${ref.where.value}]` : '';
  return `${ref.table}${where}.${refLabel(ref)}`;
}

/** A row's own `_fields`, or an empty map when it has none or they don't parse. */
function ownFields(values: Record<string, unknown>): ColumnMap {
  const parsed = ColumnMapSchema.safeParse(values[FIELDS_COLUMN]);
  return parsed.success ? parsed.data : {};
}

function isRowIdentity(ref: ColumnRef): boolean {
  return ref.column === DERIVED_ID_COLUMN || ref.column === RAW_ID_COLUMN;
}

function parseRefs(refs: string[]): ColumnRef[] {
  return refs.map(parseColumnRef).filter((ref): ref is ColumnRef => ref !== null);
}

export type FieldTrace = {
  field: string;
  /** The input columns the field is computed from directly, one hop up. */
  direct: ColumnRef[];
  /** The row's own `_fields`, which say exactly what this row reads; empty when it has none. */
  own: ColumnMap;
};

/**
 * Where tracing one field of one row starts: the row's own `_fields`, else its table's column
 * map. Returns null when neither declares the field.
 */
export function traceField(
  maps: Record<string, ColumnMap>,
  table: string,
  field: string,
  values: Record<string, unknown>
): FieldTrace | null {
  const own = ownFields(values);
  const refs = own[field] ?? maps[table]?.[field];
  if (!refs) return null;
  return { field, direct: parseRefs(refs), own };
}

/** The direct references of a field, as column labels by source table. */
export function directColumns(trace: FieldTrace): Record<string, string[]> {
  const byTable: Record<string, string[]> = {};
  for (const ref of trace.direct) addUnique(byTable, ref.table, [refLabel(ref)]);
  return byTable;
}

function addUnique(target: Record<string, string[]>, key: string, values: string[]): void {
  target[key] = [...new Set([...(target[key] ?? []), ...values])].sort();
}

/** One `_sources` entry of one row. */
export type RowSource = { rowId: string; table: string; row_id: string };

export type FieldFetchers = {
  /** Each given row's `_sources`, one entry per source. */
  rowSources(table: string, rowIds: string[]): Promise<RowSource[]>;
  /** One column's value as text in each given row, for testing a filtered reference. */
  columnValues(
    table: string,
    column: string,
    rowIds: string[]
  ): Promise<Record<string, string | null>>;
};

export type FieldWalk = {
  /** Rows reached at each hop, starting with the row itself. A row appears again only when the
   * field needs more of it than was already followed. */
  hops: Hop[];
  /** Every raw row reached, at any hop. */
  leaves: Hop;
  /** Every column label the field reads, by table: only where a row reached reads it. */
  columns: Record<string, string[]>;
};

/** The column labels needed from a row, or null for the whole row (and so all its sources). */
type Needs = Set<string> | null;
type Frontier = Map<string, Map<string, Needs>>;

function union(a: Needs, b: Needs): Needs {
  return a === null || b === null ? null : new Set([...a, ...b]);
}

function addNeeds(frontier: Frontier, table: string, rowId: string, needs: Needs): void {
  const rows = frontier.get(table) ?? new Map<string, Needs>();
  rows.set(rowId, rows.has(rowId) ? union(rows.get(rowId) ?? null, needs) : needs);
  frontier.set(table, rows);
}

function toHop(frontier: Frontier): Hop {
  const hop: Hop = {};
  for (const table of [...frontier.keys()].sort()) {
    hop[table] = [...(frontier.get(table)?.keys() ?? [])].sort();
  }
  return hop;
}

type RefsOf = (table: string, rowId: string, column: string) => string[] | undefined;
/** Each row's sources, by source table. */
type Parents = Map<string, Map<string, Set<string>>>;
/** A reference one row's needs make, with that row's sources it may read. */
type Pending = { ref: ColumnRef; ids: Set<string> };

function groupParents(sources: RowSource[]): Parents {
  const parents: Parents = new Map();
  for (const { rowId, table, row_id } of sources) {
    const byTable = parents.get(rowId) ?? new Map<string, Set<string>>();
    byTable.set(table, (byTable.get(table) ?? new Set()).add(row_id));
    parents.set(rowId, byTable);
  }
  return parents;
}

/** The references a row's needs make, or null when it needs every source. */
function rowRefs(
  table: string,
  rowId: string,
  needs: Needs,
  parents: Map<string, Set<string>>,
  refsOf: RefsOf
): Pending[] | null {
  if (needs === null) return null;
  const pending: Pending[] = [];
  for (const label of needs) {
    const refs = refsOf(table, rowId, label.split(':')[0] ?? label);
    // Nothing says what this column reads, so it may read any source.
    if (refs === undefined) return null;
    for (const ref of parseRefs(refs)) {
      const ids = parents.get(ref.table);
      if (ids && ids.size > 0) pending.push({ ref, ids });
    }
  }
  return pending;
}

const filterKey = (table: string, column: string) => `${table}\u0000${column}`;

/** The value of each filter column the references test, in the rows they may read. */
async function filterValues(
  pending: Pending[],
  fetchers: FieldFetchers
): Promise<Map<string, Record<string, string | null>>> {
  const wanted = new Map<string, { table: string; column: string; ids: Set<string> }>();
  for (const { ref, ids } of pending) {
    if (!ref.where) continue;
    const key = filterKey(ref.table, ref.where.column);
    const entry = wanted.get(key) ?? { table: ref.table, column: ref.where.column, ids: new Set() };
    for (const id of ids) entry.ids.add(id);
    wanted.set(key, entry);
  }
  const values = new Map<string, Record<string, string | null>>();
  for (const [key, { table, column, ids }] of wanted) {
    values.set(key, await fetchers.columnValues(table, column, [...ids].sort()));
  }
  return values;
}

/** The rows a reference reads: those its filter matches, or all of them. */
function readRows(
  { ref, ids }: Pending,
  values: Map<string, Record<string, string | null>>
): string[] {
  const where = ref.where;
  if (!where) return [...ids];
  const tested = values.get(filterKey(ref.table, where.column)) ?? {};
  return [...ids].filter(id => tested[id] === where.value);
}

/** The references the rows' needs make. A row that needs every source has them added to
 * `reached` at once, as whole rows. */
function collectRefs(
  table: string,
  rows: Map<string, Needs>,
  parents: Parents,
  refsOf: RefsOf,
  reached: Frontier
): Pending[] {
  const pending: Pending[] = [];
  for (const [rowId, needs] of rows) {
    const own = parents.get(rowId) ?? new Map<string, Set<string>>();
    const refs = rowRefs(table, rowId, needs, own, refsOf);
    if (refs) {
      pending.push(...refs);
      continue;
    }
    for (const [sourceTable, ids] of own) {
      for (const id of ids) addNeeds(reached, sourceTable, id, null);
    }
  }
  return pending;
}

/** The sources one hop up from every derived row in `frontier`, each with what it's needed for. */
async function step(
  frontier: Frontier,
  refsOf: RefsOf,
  fetchers: FieldFetchers,
  columns: Record<string, string[]>
): Promise<Frontier> {
  const reached: Frontier = new Map();
  for (const [table, rows] of frontier) {
    if (isRawTable(table)) continue;
    const parents = groupParents(await fetchers.rowSources(table, [...rows.keys()]));
    const pending = collectRefs(table, rows, parents, refsOf, reached);
    const values = await filterValues(pending, fetchers);
    for (const entry of pending) {
      const read = readRows(entry, values);
      if (read.length === 0) continue;
      const label = refLabel(entry.ref);
      addUnique(columns, entry.ref.table, [label]);
      const needs = isRowIdentity(entry.ref) ? null : new Set([label]);
      for (const id of read) addNeeds(reached, entry.ref.table, id, needs);
    }
  }
  return reached;
}

/** What a reached row still needs following for, recording it as followed; null for the whole
 * row, undefined when everything it needs was already followed. */
function unfollowed(followed: Map<string, Needs>, key: string, needs: Needs): Needs | undefined {
  if (!followed.has(key)) {
    followed.set(key, needs);
    return needs;
  }
  const before = followed.get(key) ?? null;
  if (before === null) return undefined;
  const fresh = needs === null ? null : new Set([...needs].filter(label => !before.has(label)));
  if (fresh !== null && fresh.size === 0) return undefined;
  followed.set(key, union(before, fresh));
  return fresh;
}

export type WalkOptions = {
  /** Stop after this many hops instead of walking to raw; a row page needs only the first. */
  depth?: number;
  maxHops?: number;
};

/**
 * Trace one field of one row to the rows and columns it reads, hop by hop. The row's own
 * `_fields` give the first hop exactly; past it, each table's column map is the union over its
 * rows, so a row there follows every column the map lists for what it's needed for, but only
 * among its own sources. The same walk as `trace` in pipeline/trace.py.
 */
export async function walkField(
  table: string,
  rowId: string,
  trace: FieldTrace,
  maps: Record<string, ColumnMap>,
  fetchers: FieldFetchers,
  { depth, maxHops = MAX_HOPS }: WalkOptions = {}
): Promise<FieldWalk> {
  const refsOf: RefsOf = (atTable, atRow, column) =>
    atTable === table && atRow === rowId && Object.hasOwn(trace.own, column)
      ? trace.own[column]
      : maps[atTable]?.[column];

  const start: Needs = new Set([trace.field]);
  const walk: FieldWalk = { hops: [{ [table]: [rowId] }], leaves: {}, columns: {} };
  const followed = new Map<string, Needs>([[`${table}\u0000${rowId}`, start]]);
  let frontier: Frontier = new Map([[table, new Map([[rowId, start]])]]);

  for (let hop = 0; hop < (depth ?? maxHops); hop++) {
    const reached = await step(frontier, refsOf, fetchers, walk.columns);
    frontier = new Map();
    for (const [reachedTable, rows] of reached) {
      for (const [reachedId, reachedNeeds] of rows) {
        const needs = unfollowed(followed, `${reachedTable}\u0000${reachedId}`, reachedNeeds);
        if (needs === undefined) continue;
        addNeeds(frontier, reachedTable, reachedId, needs);
        if (isRawTable(reachedTable)) addUnique(walk.leaves, reachedTable, [reachedId]);
      }
    }
    if (frontier.size === 0) return walk;
    walk.hops.push(toHop(frontier));
  }
  if (depth !== undefined) return walk;
  throw new Error(`Lineage did not reach raw data within ${maxHops} hops`);
}
