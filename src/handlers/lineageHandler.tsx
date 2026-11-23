import type { Context } from 'hono';
import { getLineageRepo } from '../db/source/index';
import type { LineageRepository } from '../db/lineageRepository';
import {
  ENTITIES_TABLE,
  FIELDS_COLUMN,
  entityHrefFor,
  expandToRaw,
  hopToSourceRefs,
  isRawTable,
  isValidRowId,
  parseRowLimit,
  sourcesOf,
} from '../domain/lineage';
import { directColumns, traceEntityValue, traceField, walkField } from '../domain/columnLineage';
import type { FieldTrace } from '../domain/columnLineage';
import type { LineageRow } from '../schemas/lineage';
import { LineageNotFoundPage } from '../frontend/Pages/LineageNotFoundPage';
import { LineageRawPage } from '../frontend/Pages/LineageRawPage';
import { LineageRowPage } from '../frontend/Pages/LineageRowPage';

type Resolved =
  | { ok: true; repo: LineageRepository; table: string; rowId: string }
  | { ok: false; message: string };

function resolve(c: Context): Resolved {
  const repo = getLineageRepo();
  const table = c.req.param('table') ?? '';
  const rowId = c.req.param('rowId') ?? '';
  if (!repo) {
    return { ok: false, message: 'Lineage is available only when Waymark reads a pipeline run.' };
  }
  if (!repo.hasTable(table)) return { ok: false, message: `There is no table ${table}.` };
  if (!isValidRowId(table, rowId)) {
    return { ok: false, message: `${rowId} is not a row id of ${table}.` };
  }
  return { ok: true, repo, table, rowId };
}

// Where tracing one field of a row starts. An entity's metadata value is traced from the
// metadata row that holds it, though the page still shows the entity.
async function startTrace(
  repo: LineageRepository,
  table: string,
  row: LineageRow,
  field: string | undefined
): Promise<FieldTrace | null> {
  if (!field) return null;
  const trace = traceField(repo.columnMaps(), table, field, row.values);
  if (trace || table !== ENTITIES_TABLE) return trace;
  return traceEntityValue(row.rowId, field, repo);
}

function notFound(c: Context, message: string) {
  return c.html(<LineageNotFoundPage message={message} />, 404);
}

/** GET /lineage/:table/:rowId — one row and the rows one hop up that built it. */
export async function lineageRowHandler(c: Context) {
  const resolved = resolve(c);
  if (!resolved.ok) return notFound(c, resolved.message);
  const { repo, table, rowId } = resolved;

  const row = await repo.getRow(table, rowId);
  if (!row) return notFound(c, `${table} has no row ${rowId}.`);

  // With ?field=, show only the sources that field reads, and the columns it reads first.
  const field = c.req.query('field') || undefined;
  const trace = await startTrace(repo, table, row, field);
  const sources = trace
    ? hopToSourceRefs(
        (await walkField(table, rowId, trace, repo.columnMaps(), repo, { depth: 1 })).hops[1] ?? {}
      )
    : sourcesOf(table, row);
  const parents = await repo.getParents(
    sources,
    parseRowLimit(c.req.query('limit')),
    trace ? directColumns(trace) : {}
  );

  return c.html(
    <LineageRowPage
      table={table}
      row={row}
      isRaw={isRawTable(table)}
      parents={parents}
      entityHref={entityHrefFor(table, rowId)}
      hasColumnMap={table in repo.columnMaps() || FIELDS_COLUMN in row.values}
      field={field}
      trace={trace}
    />
  );
}

/** GET /lineage/:table/:rowId/raw — every raw record behind a row, across all hops. */
export async function lineageRawHandler(c: Context) {
  const resolved = resolve(c);
  if (!resolved.ok) return notFound(c, resolved.message);
  const { repo, table, rowId } = resolved;

  const row = await repo.getRow(table, rowId);
  if (!row) return notFound(c, `${table} has no row ${rowId}.`);

  const field = c.req.query('field') || undefined;
  const trace = await startTrace(repo, table, row, field);
  const walk = trace
    ? await walkField(table, rowId, trace, repo.columnMaps(), repo)
    : { ...(await expandToRaw({ [table]: [rowId] }, repo.getSources)), columns: {} };
  const groups = await repo.getParents(
    hopToSourceRefs(walk.leaves),
    parseRowLimit(c.req.query('limit')),
    walk.columns
  );

  return c.html(
    <LineageRawPage
      table={table}
      rowId={rowId}
      hops={walk.hops}
      leaves={groups}
      field={field}
      trace={trace}
      columns={walk.columns}
    />
  );
}
