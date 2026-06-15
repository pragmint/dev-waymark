import type { Context } from 'hono';
import { getEntityRepo } from '../db/source/index';
import type { PagedEntities } from '../db/entityRepository';
import { MetaFilterOpSchema } from '../schemas/entity';
import type { MetaFilter } from '../schemas/entity';
import { EntitiesPage } from '../frontend/Pages/EntitiesPage';

const META_FILTER_RE = /^mf__(.+)__([a-z]+)$/;
const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 200;

function parsePositiveInt(raw: string | undefined, fallback: number, max?: number): number {
  if (!raw) return fallback;
  const n = parseInt(raw, 10);
  if (isNaN(n) || n < 1) return fallback;
  return max ? Math.min(n, max) : n;
}

export async function entitiesHandler(c: Context) {
  const repo = getEntityRepo();

  const url = new URL(c.req.url);
  const allFilters: MetaFilter[] = [];

  for (const [name, value] of url.searchParams) {
    if (!value) continue;
    const match = META_FILTER_RE.exec(name);
    if (!match) continue;
    const [, key, opRaw] = match;
    const parsed = MetaFilterOpSchema.safeParse(opRaw);
    if (!parsed.success) continue;
    allFilters.push({ key, op: parsed.data, value });
  }

  const addingKey = c.req.query('add_filter') || undefined;
  const editingKey = c.req.query('edit_filter') || undefined;

  const perPage = parsePositiveInt(c.req.query('per_page'), DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE);
  const page = parsePositiveInt(c.req.query('page'), 1);

  // When editing a filter, exclude it from the query so results are unfiltered by that key
  const queryFilters = editingKey ? allFilters.filter(f => f.key !== editingKey) : allFilters;

  // Don't query results until an entity type filter is selected
  const hasEntityTypeFilter = queryFilters.some(f => f.key === 'entity_type');
  let pagedResult: PagedEntities;

  if (hasEntityTypeFilter) {
    pagedResult = await repo.listPaged(queryFilters, {
      limit: perPage,
      offset: (page - 1) * perPage,
    });

    // When editing a filter, get unfiltered available filters so all options are visible.
    if (editingKey) {
      const { allIds: unfiltered } = await repo.listPaged([], { limit: 1000000, offset: 0 });
      pagedResult.allIds = unfiltered;
    }
  } else {
    // Get available filters from all entities when no entity type filter is selected
    const { allIds: unfiltered } = await repo.listPaged([], { limit: 1000000, offset: 0 });
    pagedResult = { pageEntities: [], allIds: unfiltered, total: 0 };
  }

  const { pageEntities, allIds, total } = pagedResult;
  const availableFilterIds = allIds;

  const availableFilters = await repo.getAvailableFilters(availableFilterIds);

  return c.html(
    <EntitiesPage
      entities={pageEntities}
      totalCount={total}
      page={page}
      perPage={perPage}
      activeFilters={allFilters}
      availableFilters={availableFilters}
      addingKey={addingKey}
      editingKey={editingKey}
    />
  );
}
