import type { Context } from 'hono';
import { getEntityRepo } from '../db/source/index';
import { MetaFilterOpSchema } from '../schemas/entity';
import type { MetaFilter } from '../schemas/entity';
import { EntitiesPage } from '../frontend/Pages/EntitiesPage';

const META_FILTER_RE = /^mf__(.+)__([a-z]+)$/;

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

  // When editing a filter, exclude it from the query so results are unfiltered by that key
  const queryFilters = editingKey ? allFilters.filter(f => f.key !== editingKey) : allFilters;

  const entities = await repo.list(queryFilters);
  const availableFilters = await repo.getAvailableFilters(entities.map(e => e.id));

  return c.html(
    <EntitiesPage
      entities={entities}
      activeFilters={allFilters}
      availableFilters={availableFilters}
      addingKey={addingKey}
      editingKey={editingKey}
    />
  );
}
