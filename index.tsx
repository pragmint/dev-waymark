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
  presetsListHandler,
  presetsSaveHandler,
  presetsDeleteHandler,
} from './src/handlers/presetsHandler';
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
  presetFieldsHandler,
} from './src/handlers/chartDataHandler';
import {
  testSeedPresetHandler,
  testSeedVisualizationHandler,
} from './src/handlers/testSeedHandler';

const config = loadConfig();

const sourceAdapter = await createSourceAdapter(config.sourceDb, { testMode: config.testMode });
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
app.get('/presets', presetsListHandler);
app.post('/presets', presetsSaveHandler);
app.post('/presets/:id/delete', presetsDeleteHandler);

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
app.get('/api/preset-fields/:id', presetFieldsHandler);

if (config.testMode) {
  app.post('/test/presets', testSeedPresetHandler);
  app.post('/test/visualizations', testSeedVisualizationHandler);
}

export default {
  port: config.port,
  fetch: app.fetch,
};
