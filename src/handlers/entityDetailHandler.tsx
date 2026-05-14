import type { Context } from 'hono';
import { getDb } from '../db/client';
import { createEntityRepository } from '../db/entityRepository';
import { EntityDetailPage } from '../frontend/Pages/EntityDetailPage';

export async function entityDetailHandler(c: Context) {
  const id = c.req.param('id') ?? '';
  const db = getDb();
  const repo = createEntityRepository(db);
  const entity = repo.get(id);

  if (!entity) {
    return c.html(
      <html>
        <body>
          <h1>Not found</h1>
          <p>
            Entity <code>{id}</code> does not exist.
          </p>
          <a href="/entities">← Back to entities</a>
        </body>
      </html>,
      404
    );
  }

  return c.html(<EntityDetailPage entity={entity} />);
}
