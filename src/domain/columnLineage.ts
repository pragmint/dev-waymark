import { ColumnMapSchema } from '../schemas/lineage';
import type { ColumnMap, ColumnRef } from '../schemas/lineage';
import { DERIVED_ID_COLUMN, FIELDS_COLUMN, RAW_ID_COLUMN, isRawTable } from './lineage';

// Field-level lineage = which input columns feed each output column (a row's `_fields`, or its
// table's column map) combined with each row's `_sources` (which input rows). Following only the
// source tables a field's columns read narrows the row walk to the rows that actually feed it.

const REF_PATTERN =
  /^((?:raw\.)?[a-z][a-z0-9_]*)\.([A-Za-z_][A-Za-z0-9_]*)(?::(\$(?:\.[A-Za-z0-9_]+)+))?$/;
export const JSON_PATH_PATTERN = /^\$(\.[A-Za-z0-9_]+)+$/;

export function parseColumnRef(ref: string): ColumnRef | null {
  const match = REF_PATTERN.exec(ref);
  if (!match) return null;
  const [, table = '', column = '', path] = match;
  return path ? { table, column, path } : { table, column };
}

/** How a reference reads as a column label: `column`, or `column:$.path` inside JSON text. */
export function refLabel(ref: ColumnRef): string {
  return ref.path ? `${ref.column}:${ref.path}` : ref.column;
}

/** A row's own `_fields`, or an empty map when it has none or they don't parse. */
function ownFields(values: Record<string, unknown>): ColumnMap {
  const parsed = ColumnMapSchema.safeParse(values[FIELDS_COLUMN]);
  return parsed.success ? parsed.data : {};
}

function isRowIdentity(ref: ColumnRef): boolean {
  return ref.column === DERIVED_ID_COLUMN || ref.column === RAW_ID_COLUMN;
}

export type FieldTrace = {
  field: string;
  /** The input columns the field is computed from directly, one hop up. */
  direct: ColumnRef[];
  /** Every column reached at any hop, as labels, by table. */
  columns: Record<string, string[]>;
  /**
   * Per table reached, the source tables worth following. A table missing here (no column map,
   * or reached by a whole-row reference such as `_row_id`) follows all of its sources.
   */
  follows: Record<string, string[]>;
};

function addUnique(target: Record<string, string[]>, key: string, values: string[]): void {
  target[key] = [...new Set([...(target[key] ?? []), ...values])].sort();
}

function parseRefs(refs: string[]): ColumnRef[] {
  return refs.map(parseColumnRef).filter((ref): ref is ColumnRef => ref !== null);
}

/**
 * Trace one field of one row. The row's own `_fields` gives the first hop exactly; past it, each
 * table's column map is the union over its rows, so it can list more than one row read. Returns
 * null when neither the row nor its table maps the field.
 */
export function traceField(
  maps: Record<string, ColumnMap>,
  table: string,
  field: string,
  values: Record<string, unknown>
): FieldTrace | null {
  const refs = ownFields(values)[field] ?? maps[table]?.[field];
  if (!refs) return null;
  const direct = parseRefs(refs);

  const trace: FieldTrace = { field, direct, columns: {}, follows: {} };
  addUnique(trace.follows, table, [...new Set(direct.map(ref => ref.table))]);

  const wholeRows = new Set<string>();
  const seen = new Set<string>();
  const queue = [...direct];
  while (queue.length > 0) {
    const ref = queue.shift() as ColumnRef;
    const key = `${ref.table}.${refLabel(ref)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    addUnique(trace.columns, ref.table, [refLabel(ref)]);
    if (isRawTable(ref.table)) continue;

    const nextRefs = maps[ref.table]?.[ref.column];
    if (isRowIdentity(ref) || !nextRefs) {
      wholeRows.add(ref.table);
      continue;
    }
    const next = parseRefs(nextRefs);
    addUnique(trace.follows, ref.table, [...new Set(next.map(r => r.table))]);
    queue.push(...next);
  }
  for (const wholeTable of wholeRows) delete trace.follows[wholeTable];
  return trace;
}

/** The `follow` filter for `expandToRaw`: only the source tables the field reads. */
export function followFor(trace: FieldTrace): (from: string, to: string) => boolean {
  return (from, to) => {
    const allowed = trace.follows[from];
    return allowed === undefined || allowed.includes(to);
  };
}

/** The direct references of a field, as column labels by source table. */
export function directColumns(trace: FieldTrace): Record<string, string[]> {
  const byTable: Record<string, string[]> = {};
  for (const ref of trace.direct) addUnique(byTable, ref.table, [refLabel(ref)]);
  return byTable;
}
