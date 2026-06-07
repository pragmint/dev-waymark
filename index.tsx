import { Hono } from 'hono';
import { serveStatic } from 'hono/bun';
import { loadConfig } from './src/config';
import { createSourceAdapter } from './src/db/source/factory';
import { initSourceAdapter } from './src/db/source/index';
import { createAppStateRepo } from './src/db/appState/factory';
import { initAppStateRepo } from './src/db/appState/index';
import { entitiesHandler } from './src/handlers/entitiesHandler';
import { entityDetailHandler } from './src/handlers/entityDetailHandler';
import {
  datasetsListHandler,
  datasetsSaveHandler,
  datasetsDeleteHandler,
} from './src/handlers/datasetsHandler';
import {
  visualizationsListHandler,
  visualizationsNewHandler,
  visualizationsTemplateHandler,
  visualizationsSaveHandler,
  visualizationsDetailHandler,
  visualizationsEditHandler,
  visualizationsUpdateHandler,
  visualizationsDeleteHandler,
} from './src/handlers/visualizationsHandler';
import {
  chartDataByIdHandler,
  chartDataPreviewHandler,
  datasetFieldsHandler,
} from './src/handlers/chartDataHandler';

const config = loadConfig();

const sourceAdapter = await createSourceAdapter(config.sourceDb);
await sourceAdapter.validateConnection();
initSourceAdapter(sourceAdapter);

const appStateRepo = createAppStateRepo(config.appDb);
await appStateRepo.migrate();
initAppStateRepo(appStateRepo);

const app = new Hono();

app.use('/*', serveStatic({ root: './public' }));

app.get('/', c => c.redirect('/entities'));
app.get('/entities', entitiesHandler);
app.get('/entities/:id', entityDetailHandler);
app.get('/datasets', datasetsListHandler);
app.post('/datasets', datasetsSaveHandler);
app.post('/datasets/:id/delete', datasetsDeleteHandler);

app.get('/visualizations', visualizationsListHandler);
app.get('/visualizations/new', visualizationsNewHandler);
app.get('/visualizations/new/:templateId', visualizationsTemplateHandler);
app.post('/visualizations', visualizationsSaveHandler);
app.get('/visualizations/:id', visualizationsDetailHandler);
app.get('/visualizations/:id/edit', visualizationsEditHandler);
app.post('/visualizations/:id', visualizationsUpdateHandler);
app.post('/visualizations/:id/delete', visualizationsDeleteHandler);

app.get('/api/chart-data/:id', chartDataByIdHandler);
app.post('/api/chart-data/preview', chartDataPreviewHandler);
app.get('/api/dataset-fields/:id', datasetFieldsHandler);

export default {
  port: config.port,
  fetch: app.fetch,
};
