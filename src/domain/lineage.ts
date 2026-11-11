import { SourceRefsSchema } from '../schemas/lineage';
import type { Hop, LineageRow, SourceRef } from '../schemas/lineage';

// Row lineage as pipeline/CONTRACT.md defines it: every derived row lists, in
// `_sources`, the rows one hop up that it was built from. Raw tables are the
// root, named `raw.<table>`, and a raw row is identified by its `_dlt_id`.

export const RAW_PREFIX = 'raw.';
export const RAW_ID_COLUMN = '_dlt_id';
export const DERIVED_ID_COLUMN = '_row_id';
export const SOURCES_COLUMN = '_sources';
export const FIELDS_COLUMN = '_fields';
/** The columns every derived row carries for lineage, beside its own values. */
export const CONTRACT_COLUMNS: readonly string[] = [
  DERIVED_ID_COLUMN,
  SOURCES_COLUMN,
  FIELDS_COLUMN,
];

// A derived table's plain view leaves out the contract columns, so entity
// queries never read them; this schema holds the full view for lineage.
export const LINEAGE_SCHEMA = 'lineage';

// Long text (Jira's raw `fields` JSON runs to megabytes) is cut to this many
// characters in listings; a single row's own page shows it in full.
export const PREVIEW_CHARS = 160;

export type IdColumn = typeof RAW_ID_COLUMN | typeof DERIVED_ID_COLUMN;

/** One lookup a hop needs: these ids in this table. */
export type HopQuery = { table: string; idColumn: IdColumn; ids: string[] };

export function isRawTable(table: string): boolean {
  return table.startsWith(RAW_PREFIX);
}

export function idColumnFor(table: string): IdColumn {
  return isRawTable(table) ? RAW_ID_COLUMN : DERIVED_ID_COLUMN;
}

/**
 * True when `rowId` can identify a row of `table`: a derived row's `_row_id`
 * is an integer, and a raw row's `_dlt_id` is any non-empty text.
 */
export function isValidRowId(table: string, rowId: string): boolean {
  if (rowId === '') return false;
  return isRawTable(table) || /^-?\d{1,19}$/.test(rowId);
}

/** Group source refs by table, with each table's ids unique and sorted. */
export function groupSourcesByTable(refs: SourceRef[]): Hop {
  const byTable = new Map<string, Set<string>>();
  for (const { table, row_id } of refs) {
    const ids = byTable.get(table) ?? new Set<string>();
    ids.add(row_id);
    byTable.set(table, ids);
  }
  const hop: Hop = {};
  for (const table of [...byTable.keys()].sort()) {
    hop[table] = [...(byTable.get(table) ?? [])].sort();
  }
  return hop;
}

/** The lookups that fetch a hop's rows: one per table, by that table's id column. */
export function planHop(hop: Hop): HopQuery[] {
  return Object.keys(hop)
    .sort()
    .map(table => ({ table, idColumn: idColumnFor(table), ids: hop[table] ?? [] }))
    .filter(query => query.ids.length > 0);
}

function mergeInto(target: Hop, extra: Hop): void {
  for (const [table, ids] of Object.entries(extra)) {
    target[table] = [...new Set([...(target[table] ?? []), ...ids])].sort();
  }
}

/** Drop ids already seen at an earlier hop, so shared ancestors are fetched once. */
function withoutSeen(hop: Hop, seen: Map<string, Set<string>>): Hop {
  const fresh: Hop = {};
  for (const [table, ids] of Object.entries(hop)) {
    const seenIds = seen.get(table) ?? new Set<string>();
    const unseen = ids.filter(id => !seenIds.has(id));
    if (unseen.length > 0) fresh[table] = unseen;
  }
  return fresh;
}

function markSeen(hop: Hop, seen: Map<string, Set<string>>): void {
  for (const [table, ids] of Object.entries(hop)) {
    const seenIds = seen.get(table) ?? new Set<string>();
    for (const id of ids) seenIds.add(id);
    seen.set(table, seenIds);
  }
}

/** Fetches the `_sources` of the given rows of one derived table. */
export type FetchSources = (table: string, rowIds: string[]) => Promise<SourceRef[]>;

export type Expansion = {
  /** Rows reached at each hop, starting with the starting rows. */
  hops: Hop[];
  /** Every raw row reached, at any hop. */
  leaves: Hop;
};

export const MAX_HOPS = 32;

/**
 * Follow `_sources` hop by hop from `start` until only raw rows remain, and
 * return every raw row reached. A derived table may read raw directly, so raw
 * rows can turn up at any hop. Each row is expanded once even when several
 * paths reach it, and `maxHops` stops a malformed cycle. `follow` limits which source tables
 * are followed from each table, which is how a single field is traced.
 */
export type ExpandOptions = {
  /** Whether to follow sources from one table to another; field lineage narrows this. */
  follow?: (from: string, to: string) => boolean;
  maxHops?: number;
};

export async function expandToRaw(
  start: Hop,
  fetchSources: FetchSources,
  { follow = () => true, maxHops = MAX_HOPS }: ExpandOptions = {}
): Promise<Expansion> {
  const hops: Hop[] = [start];
  const leaves: Hop = {};
  const seen = new Map<string, Set<string>>();
  markSeen(start, seen);

  let frontier = start;
  for (let depth = 0; depth < maxHops; depth++) {
    const next: Hop = {};
    for (const query of planHop(frontier)) {
      if (isRawTable(query.table)) {
        mergeInto(leaves, { [query.table]: query.ids });
        continue;
      }
      const sources = await fetchSources(query.table, query.ids);
      const followed = sources.filter(source => follow(query.table, source.table));
      mergeInto(next, groupSourcesByTable(followed));
    }
    frontier = withoutSeen(next, seen);
    if (Object.keys(frontier).length === 0) return { hops, leaves };
    markSeen(frontier, seen);
    hops.push(frontier);
  }
  throw new Error(`Lineage did not reach raw data within ${maxHops} hops`);
}

/** Total rows in a hop, across tables. */
export function hopSize(hop: Hop): number {
  return Object.values(hop).reduce((sum, ids) => sum + ids.length, 0);
}

export const DEFAULT_ROW_LIMIT = 100;
export const MAX_ROW_LIMIT = 5000;

/** The `?limit=` of a lineage page: rows shown per source table. */
export function parseRowLimit(param: string | undefined): number {
  if (param === 'all') return MAX_ROW_LIMIT;
  const limit = Number.parseInt(param ?? '', 10);
  if (!Number.isFinite(limit) || limit < 1) return DEFAULT_ROW_LIMIT;
  return Math.min(limit, MAX_ROW_LIMIT);
}

/** A lineage page's path. Ids are encoded: a dlt id can contain `+` or `/`. */
export function lineagePath(table: string, rowId: string, suffix = ''): string {
  return `/lineage/${encodeURIComponent(table)}/${encodeURIComponent(rowId)}${suffix}`;
}

/** A row's own `_sources`; a raw row has none. */
export function sourcesOf(table: string, row: LineageRow): SourceRef[] {
  return isRawTable(table) ? [] : SourceRefsSchema.parse(row.values._sources ?? []);
}

/** A hop as source refs: the inverse of `groupSourcesByTable`. */
export function hopToSourceRefs(hop: Hop): SourceRef[] {
  return Object.entries(hop).flatMap(([table, ids]) => ids.map(row_id => ({ table, row_id })));
}

// Pipeline entities use their `_row_id` as their Waymark entity id, so an
// entity and its lineage row link to each other.
export const ENTITIES_TABLE = 'entities';

export function entityLineagePath(entityId: number): string {
  return lineagePath(ENTITIES_TABLE, String(entityId));
}

/** The Waymark entity page for a lineage row, when the row is an entity. */
export function entityHrefFor(table: string, rowId: string): string | undefined {
  return table === ENTITIES_TABLE ? `/entities/${rowId}` : undefined;
}

/** A lineage page's URL with query parameters; empty or missing values are left out. */
export function withQuery(path: string, params: Record<string, string | undefined>): string {
  const query = Object.entries(params)
    .filter((entry): entry is [string, string] => Boolean(entry[1]))
    .map(([key, value]) => `${key}=${encodeURIComponent(value)}`)
    .join('&');
  return query ? `${path}?${query}` : path;
}
