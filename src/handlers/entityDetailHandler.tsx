import type { Context } from 'hono';
import { getDb } from '../db/client';
import { createEntityRepository } from '../db/entityRepository';
import { EntityDetailPage } from '../frontend/Pages/EntityDetailPage';

export async function entityDetailHandler(c: Context) {
  const idParam = c.req.param('id') ?? '';
  const id = parseInt(idParam, 10);
  const db = getDb();
  const repo = createEntityRepository(db);
  const entity = isNaN(id) ? null : repo.get(id);

  if (!entity) {
    return c.html(
      <html>
        <body>
          <h1>Not found</h1>
          <p>
            Entity <code>{idParam}</code> does not exist.
          </p>
          <a href="/entities">← Back to entities</a>
        </body>
      </html>,
      404
    );
  }

  return c.html(<EntityDetailPage entity={entity} />);
}
