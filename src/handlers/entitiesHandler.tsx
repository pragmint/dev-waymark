import type { Context } from 'hono';
import { getDb } from '../db/client';
import { createEntityRepository } from '../db/entityRepository';
import { EntityFiltersSchema } from '../schemas/entity';
import { EntitiesPage } from '../frontend/Pages/EntitiesPage';

export async function entitiesHandler(c: Context) {
  const db = getDb();
  const repo = createEntityRepository(db);

  const filters = EntityFiltersSchema.parse({
    source: c.req.query('source') || undefined,
    type: c.req.query('type') || undefined,
    from: c.req.query('from') || undefined,
    to: c.req.query('to') || undefined,
  });

  const entities = repo.list(filters);
  const sources = repo.distinctSources();
  const types = repo.distinctTypes();

  return c.html(
    <EntitiesPage entities={entities} filters={filters} sources={sources} types={types} />
  );
}
