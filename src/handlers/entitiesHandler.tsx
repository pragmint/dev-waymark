import type { Context } from 'hono';
import { getEntityRepo } from '../db/source/index';
import { getAppStateRepo } from '../db/appState/index';
import type { PagedEntities } from '../db/entityRepository';
import type { AvailableFilter } from '../schemas/entity';
import type { PresetWithTree } from '../schemas/preset';
import { collectLeaves, emptyTree, isLeaf, makeLeaf } from '../schemas/filterTree';
import type { FilterTree } from '../schemas/filterTree';
import { EntitiesPage } from '../frontend/Pages/EntitiesPage';
import { entitiesToCsv, exportFilenameSlug, planExportChunks } from '../domain/entityCsv';
import type { EntityWithMetadata } from '../schemas/entity';
import {
  buildEntityUrl,
  encodeTree,
  findMatchingPresetId,
  parseTreeFromUrl,
  treesEqual,
} from '../domain/filterUrl';

const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 200;

// A single export attempt is given this long to finish before it's abandoned
// in favor of asking the user to split the job into chunks (see
// entitiesExportHandler). Rows are fetched in EXPORT_BATCH_SIZE-row batches so
// elapsed time can be checked between DB round trips instead of blocking for
// the whole (potentially huge) unbounded query.
const EXPORT_TIMEOUT_MS = 10_000;
const EXPORT_BATCH_SIZE = 500;

function parsePositiveInt(raw: string | undefined, fallback: number, max?: number): number {
  if (!raw) return fallback;
  const n = parseInt(raw, 10);
  if (isNaN(n) || n < 1) return fallback;
  return max ? Math.min(n, max) : n;
}

function parseNonNegativeInt(raw: string | undefined, fallback: number): number {
  if (raw === undefined) return fallback;
  const n = parseInt(raw, 10);
  return isNaN(n) || n < 0 ? fallback : n;
}

function findEntityTypeValue(tree: FilterTree): string | null {
  for (const leaf of collectLeaves(tree)) {
    if (leaf.key === 'entity_type' && leaf.op === 'eq') {
      return Array.isArray(leaf.value) ? (leaf.value[0] ?? null) : leaf.value;
    }
  }
  return null;
}

type PresetResolution = {
  selectedPresetId: number | null;
  selectedPresetTree: FilterTree | null;
  isDraft: boolean;
};

// Resolve the "active" preset. When a `preset=N` URL param is present and
// valid, that preset is pinned regardless of tree matching (so the dropdown
// stays selected while the user drafts changes). Otherwise fall back to
// matching the current tree against saved presets.
function resolvePreset(
  presetParam: string | undefined,
  activeTree: FilterTree,
  presetsWithTree: PresetWithTree[]
): PresetResolution {
  const presetParamId = presetParam ? parseInt(presetParam, 10) : NaN;
  const pinned = !isNaN(presetParamId)
    ? presetsWithTree.find(p => p.id === presetParamId)
    : undefined;

  if (pinned) {
    return {
      selectedPresetId: pinned.id,
      selectedPresetTree: pinned.tree,
      isDraft: !treesEqual(activeTree, pinned.tree),
    };
  }

  const presetRefs = presetsWithTree.map(p => ({ id: p.id, tree: p.tree }));
  const matchedId = findMatchingPresetId(activeTree, presetRefs);
  const matched = matchedId != null ? presetsWithTree.find(p => p.id === matchedId) : undefined;
  return {
    selectedPresetId: matchedId,
    selectedPresetTree: matched?.tree ?? null,
    isDraft: false,
  };
}

function csvResponse(c: Context, csv: string, slug: string, nextCursor?: number): Response {
  c.header('Content-Type', 'text/csv; charset=utf-8');
  c.header('Content-Disposition', `attachment; filename="entities-${slug}.csv"`);
  if (nextCursor != null) c.header('X-Next-Cursor', String(nextCursor));
  return c.body(csv);
}

// Export the filtered population as a CSV download. Reuses the same tree
// parsing and column derivation as the page so the file matches what the
// table shows — just unbounded, not capped to one page.
//
// Two request shapes:
//  - No `limit` param: a single-shot attempt at the *entire* filtered
//    population. Rows are pulled in batches (keyset-paginated by id, not
//    OFFSET — see repo.list) so elapsed time can be checked between DB round
//    trips; if EXPORT_TIMEOUT_MS is exceeded before all rows are in, the job
//    is abandoned (no partial CSV is served) and a 503 with the measured
//    throughput + a suggested chunk plan is returned instead, so the client
//    can offer to split the download.
//  - `limit` present: one chunk of a client-driven split download. `afterId`
//    (the previous chunk's last row id) continues the same keyset walk —
//    omit it for the first chunk. The response carries the next chunk's
//    cursor in `X-Next-Cursor` (absent once the walk is exhausted) since a
//    plain CSV body has nowhere else to put it.
export async function entitiesExportHandler(c: Context) {
  const repo = getEntityRepo();
  const url = new URL(c.req.url);
  const activeTree = parseTreeFromUrl(url);
  const selectedEntityType = findEntityTypeValue(activeTree);
  const slug = exportFilenameSlug(selectedEntityType);

  const metadataKeys = selectedEntityType ? await repo.listMetadataKeys(selectedEntityType) : [];

  // Not scoped by `keys` here: CSV export always wants every metadata key the
  // type has (metadataKeys already *is* the full set), so a keys filter would
  // add zero selectivity — and on SQLite, combining a large `entity_id IN`
  // list with a `key IN` list of every key for the type sends the planner
  // down a full-table-scan plan instead of the entity_id index (confirmed via
  // EXPLAIN QUERY PLAN against a 150k-row / 60-key load-test dataset: ~27s
  // per 2000-row batch with the keys filter vs. ~170ms without it).
  const limitParam = c.req.query('limit');
  if (limitParam !== undefined) {
    const limit = parsePositiveInt(limitParam, EXPORT_BATCH_SIZE);
    const afterIdParam = c.req.query('afterId');
    const afterId = afterIdParam !== undefined ? parseNonNegativeInt(afterIdParam, 0) : undefined;
    const entities = await repo.list(activeTree, { limit, afterId });
    const nextCursor = entities.length === limit ? entities[entities.length - 1].id : undefined;
    return csvResponse(c, entitiesToCsv(entities, metadataKeys), slug, nextCursor);
  }

  const totalCount = await repo.count(activeTree);
  const start = performance.now();
  const entities: EntityWithMetadata[] = [];
  let cursor: number | undefined;
  let fetched = 0;
  while (fetched < totalCount) {
    const batch = await repo.list(activeTree, {
      limit: EXPORT_BATCH_SIZE,
      afterId: cursor,
    });
    if (batch.length === 0) break;
    entities.push(...batch);
    fetched += batch.length;
    cursor = batch[batch.length - 1].id;

    const elapsedMs = performance.now() - start;
    if (elapsedMs > EXPORT_TIMEOUT_MS && fetched < totalCount) {
      const measuredRowsPerSecond = fetched / (elapsedMs / 1000);
      // Apply a conservative safety factor: assume real-world throughput is lower
      // than what we measured during the timeout window (which may have favorable
      // caching, low contention, etc.). This ensures chunks finish well under
      // their planned time window.
      const conservativeRowsPerSecond = measuredRowsPerSecond / 1.5;
      const { chunks, rowsPerChunk } = planExportChunks(totalCount, conservativeRowsPerSecond);
      c.status(503);
      return c.json({
        error: 'timeout',
        totalCount,
        rowsPerChunk,
        chunks,
      });
    }
  }

  return csvResponse(c, entitiesToCsv(entities, metadataKeys), slug);
}

export async function entitiesHandler(c: Context) {
  const repo = getEntityRepo();
  const appStateRepo = getAppStateRepo();

  const url = new URL(c.req.url);
  const activeTree = parseTreeFromUrl(url);

  const perPage = parsePositiveInt(c.req.query('per_page'), DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE);
  const page = parsePositiveInt(c.req.query('page'), 1);

  const entityTypes = await repo.listEntityTypes();
  const selectedEntityType = findEntityTypeValue(activeTree);

  // Redirect to the first entity type when none is selected. entity_type must
  // AND with the rest of the tree — if the user's tree is an OR root, wrap it
  // so the type filter isn't OR'd against the predicates.
  if (!selectedEntityType && entityTypes.length > 0) {
    const etLeaf = makeLeaf('entity_type', 'eq', entityTypes[0]);
    const existing = activeTree.children.filter(c => !(isLeaf(c) && c.key === 'entity_type'));
    const seededTree: FilterTree =
      activeTree.op === 'AND'
        ? { ...activeTree, children: [etLeaf, ...existing] }
        : {
            type: 'group',
            id: 'root',
            op: 'AND',
            children: [etLeaf, { ...activeTree, id: `${activeTree.id}_inner`, children: existing }],
          };
    const redirectParams = new URLSearchParams(url.searchParams);
    redirectParams.set('f', encodeTree(seededTree));
    return c.redirect(`/entities?${redirectParams.toString()}`, 302);
  }

  // The filter editor refetches available values with the leaf-being-edited
  // removed and needs every distinct value (not the capped initial-render set)
  // — when `all_distinct=1` is set, lift the per-field cap.
  const allDistinctValues = c.req.query('all_distinct') === '1';

  // Independent of the tree/entity-type branch below — kick it off now so it
  // runs concurrently with that work instead of adding its own round trip
  // after.
  const presetsWithTreePromise = appStateRepo.listPresetsWithTree();

  let pagedResult: PagedEntities;
  let availableFilters: AvailableFilter[];
  let metadataKeys: string[];
  if (selectedEntityType) {
    // These three queries are independent of one another — run them
    // concurrently rather than paying three sequential round trips.
    [pagedResult, availableFilters, metadataKeys] = await Promise.all([
      repo.listPaged(activeTree, { limit: perPage, offset: (page - 1) * perPage }),
      repo.getAvailableFilters(activeTree, { allDistinctValues }),
      // Columns reflect every key the type defines, not just keys with
      // non-null values in the current (possibly null-filtered) population.
      repo.listMetadataKeys(selectedEntityType),
    ]);
  } else {
    // No entity types means a (near-)empty entities table — the unfiltered
    // population is the only case rendered without a type selected.
    pagedResult = { pageEntities: [], total: 0 };
    availableFilters = await repo.getAvailableFilters(emptyTree());
    metadataKeys = [];
  }

  const presetsWithTree = await presetsWithTreePromise;
  const presets = presetsWithTree.map(p => ({
    id: p.id,
    name: p.name,
    url: buildEntityUrl(p.tree, p.id),
  }));

  const { selectedPresetId, selectedPresetTree, isDraft } = resolvePreset(
    c.req.query('preset'),
    activeTree,
    presetsWithTree
  );

  return c.html(
    <EntitiesPage
      entities={pagedResult.pageEntities}
      totalCount={pagedResult.total}
      page={page}
      perPage={perPage}
      activeTree={activeTree}
      availableFilters={availableFilters}
      metadataKeys={metadataKeys}
      entityTypes={entityTypes}
      presets={presets}
      selectedPresetId={selectedPresetId}
      selectedPresetTree={selectedPresetTree}
      selectedEntityType={selectedEntityType}
      isDraft={isDraft}
    />
  );
}
