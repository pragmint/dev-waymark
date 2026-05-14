import { Hono } from 'hono';
import { serveStatic } from 'hono/bun';
import { getDb } from './src/db/client';
import { runMigrations } from './src/db/migrate';
import { entitiesHandler } from './src/handlers/entitiesHandler';
import { entityDetailHandler } from './src/handlers/entityDetailHandler';

const app = new Hono();

runMigrations(getDb());

app.use('/*', serveStatic({ root: './public' }));

app.get('/', c => c.redirect('/entities'));
app.get('/entities', entitiesHandler);
app.get('/entities/:id', entityDetailHandler);

export default {
  port: parseInt(process.env.PORT ?? '3000'),
  fetch: app.fetch,
};
