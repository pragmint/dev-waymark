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
  entityPresetsSaveHandler,
  entityPresetsUpdateHandler,
  entityPresetsDeleteHandler,
} from './src/handlers/entityPresetsHandler';
import {
  dashboardsPageHandler,
  dashboardCardsApiHandler,
  dashboardSaveHandler,
  dashboardUpdateHandler,
  dashboardDeleteHandler,
  dashboardAddVisualizationHandler,
  dashboardRemoveVisualizationHandler,
  visualizationCreateApiHandler,
  visualizationDeleteApiHandler,
  visualizationDetailApiHandler,
  visualizationDashboardsApiHandler,
  visualizationUpdateApiHandler,
} from './src/handlers/dashboardsHandler';
import {
  chartDataByIdHandler,
  chartDataPreviewHandler,
  presetFieldsHandler,
} from './src/handlers/chartDataHandler';
import {
  testSeedPresetHandler,
  testClearPresetsHandler,
  testSeedVisualizationHandler,
  testSeedDashboardHandler,
  testClearDashboardsHandler,
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
app.post('/entities/presets', entityPresetsSaveHandler);
app.post('/entities/presets/:id', entityPresetsUpdateHandler);
app.post('/entities/presets/:id/delete', entityPresetsDeleteHandler);
app.get('/entities/:id', entityDetailHandler);

app.get('/visualizations', dashboardsPageHandler);
app.post('/visualizations/dashboards', dashboardSaveHandler);
app.post('/visualizations/dashboards/:id', dashboardUpdateHandler);
app.post('/visualizations/dashboards/:id/delete', dashboardDeleteHandler);
app.post('/visualizations/dashboards/:id/visualizations', dashboardAddVisualizationHandler);
app.post(
  '/visualizations/dashboards/:id/visualizations/:vizId/delete',
  dashboardRemoveVisualizationHandler
);
app.post('/api/visualizations', visualizationCreateApiHandler);
app.get('/api/visualizations/:id', visualizationDetailApiHandler);
app.post('/api/visualizations/:id', visualizationUpdateApiHandler);
app.get('/api/visualizations/:id/dashboards', visualizationDashboardsApiHandler);
app.post('/api/visualizations/:id/delete', visualizationDeleteApiHandler);

app.get('/api/dashboards/:id/cards', dashboardCardsApiHandler);

app.get('/api/chart-data/:id', chartDataByIdHandler);
app.post('/api/chart-data/preview', chartDataPreviewHandler);
app.get('/api/preset-fields/:id', presetFieldsHandler);

if (config.testMode) {
  app.post('/test/presets', testSeedPresetHandler);
  app.post('/test/presets/clear', testClearPresetsHandler);
  app.post('/test/visualizations', testSeedVisualizationHandler);
  app.post('/test/dashboards', testSeedDashboardHandler);
  app.post('/test/dashboards/clear', testClearDashboardsHandler);
}

export default {
  port: config.port,
  fetch: app.fetch,
};
