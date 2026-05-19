import type { Context } from 'hono';
import { getEntityRepo } from '../db/source/index';
import { EntityDetailPage } from '../frontend/Pages/EntityDetailPage';

export async function entityDetailHandler(c: Context) {
  const idParam = c.req.param('id') ?? '';
  const id = parseInt(idParam, 10);
  const repo = getEntityRepo();
  const entity = isNaN(id) ? null : await repo.get(id);

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
