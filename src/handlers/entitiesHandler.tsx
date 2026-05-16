import type { Context } from 'hono';
import { getDb } from '../db/client';
import { createEntityRepository } from '../db/entityRepository';
import { MetaFilterOpSchema, DateRangeFiltersSchema } from '../schemas/entity';
import type { MetaFilter } from '../schemas/entity';
import { EntitiesPage } from '../frontend/Pages/EntitiesPage';

const META_FILTER_RE = /^mf__(.+)__([a-z]+)$/;

export async function entitiesHandler(c: Context) {
  const db = getDb();
  const repo = createEntityRepository(db);

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

  const dateRange = DateRangeFiltersSchema.parse({
    from: c.req.query('from') || undefined,
    to: c.req.query('to') || undefined,
  });

  const addingKey = c.req.query('add_filter') || undefined;

  const entities = repo.list(metaFilters, dateRange);
  const availableFilters = repo.getAvailableFilters(entities.map(e => e.id));

  return c.html(
    <EntitiesPage
      entities={entities}
      activeFilters={metaFilters}
      availableFilters={availableFilters}
      dateRange={dateRange}
      addingKey={addingKey}
    />
  );
}
