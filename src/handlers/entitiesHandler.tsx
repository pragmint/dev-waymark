import type { Context } from 'hono';
import { getEntityRepo } from '../db/source/index';
import { MetaFilterOpSchema } from '../schemas/entity';
import type { MetaFilter } from '../schemas/entity';
import { EntitiesPage } from '../frontend/Pages/EntitiesPage';

const META_FILTER_RE = /^mf__(.+)__([a-z]+)$/;

export async function entitiesHandler(c: Context) {
  const repo = getEntityRepo();

  const url = new URL(c.req.url);
  const metaFilters: MetaFilter[] = [];

  for (const [name, value] of url.searchParams) {
    if (!value) continue;
    const match = META_FILTER_RE.exec(name);
    if (!match) continue;
    const [, key, opRaw] = match;
    const parsed = MetaFilterOpSchema.safeParse(opRaw);
    if (!parsed.success) continue;
    metaFilters.push({ key, op: parsed.data, value });
  }

  const addingKey = c.req.query('add_filter') || undefined;

  const entities = await repo.list(metaFilters);
  const availableFilters = await repo.getAvailableFilters(entities.map(e => e.id));

  return c.html(
    <EntitiesPage
      entities={entities}
      activeFilters={metaFilters}
      availableFilters={availableFilters}
      addingKey={addingKey}
    />
  );
}
