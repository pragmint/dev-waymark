import type { Context } from 'hono';
import { getLineageRepo } from '../db/source/index';
import type { LineageRepository } from '../db/lineageRepository';
import {
  entityHrefFor,
  expandToRaw,
  hopToSourceRefs,
  isRawTable,
  isValidRowId,
  parseRowLimit,
  sourcesOf,
} from '../domain/lineage';
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

  const parents = await repo.getParents(sourcesOf(table, row), parseRowLimit(c.req.query('limit')));

  return c.html(
    <LineageRowPage
      table={table}
      row={row}
      isRaw={isRawTable(table)}
      parents={parents}
      entityHref={entityHrefFor(table, rowId)}
    />
  );
}

/** GET /lineage/:table/:rowId/raw — every raw record behind a row, across all hops. */
export async function lineageRawHandler(c: Context) {
  const resolved = resolve(c);
  if (!resolved.ok) return notFound(c, resolved.message);
  const { repo, table, rowId } = resolved;

  if (!(await repo.getRow(table, rowId))) return notFound(c, `${table} has no row ${rowId}.`);

  const { hops, leaves } = await expandToRaw({ [table]: [rowId] }, repo.getSources);
  const groups = await repo.getParents(
    hopToSourceRefs(leaves),
    parseRowLimit(c.req.query('limit'))
  );

  return c.html(<LineageRawPage table={table} rowId={rowId} hops={hops} leaves={groups} />);
}
