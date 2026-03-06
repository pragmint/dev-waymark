import { Hono } from 'hono';
import type { Context } from 'hono';
import { serveStatic } from 'hono/bun';
import { trimTrailingSlash } from 'hono/trailing-slash';
import { createMiddleware } from 'hono/factory';
import { NotFoundError, isAppError, formatErrorForLogging } from './src/domain/errors';
import { FilesystemCapabilitiesRepository } from './src/infrastructure/storage/filesystem/CapabilitiesRepository';
import { FilesystemCapabilityMetricsRepository } from './src/infrastructure/storage/filesystem/CapabilityMetricsRepository';
import { FilesystemTeamsRepository } from './src/infrastructure/storage/filesystem/TeamsRepository';
import { FilesystemTeamMetricsRepository } from './src/infrastructure/storage/filesystem/TeamMetricsRepository';
import { FilesystemExperimentsRepository } from './src/infrastructure/storage/filesystem/ExperimentsRepository';
import { FilesystemPracticesRepository } from './src/infrastructure/storage/filesystem/PracticesRepository';
import { FilesystemSummariesRepository } from './src/infrastructure/storage/filesystem/SummariesRepository';
import * as capabilitiesListAppHandler from './src/application/capabilities/list/Handler';
import * as capabilitiesGetAppHandler from './src/application/capabilities/get/Handler';
import * as teamsGetAppHandler from './src/application/teams/get/Handler';
import * as experimentsGetAppHandler from './src/application/experiments/get/Handler';
import * as practicesListAppHandler from './src/application/practices/list/Handler';
import * as practicesGetAppHandler from './src/application/practices/get/Handler';
import * as overviewsGetAppHandler from './src/application/overviews/get/Handler';
import * as insightsGetAppHandler from './src/application/insights/get/Handler';
import * as capabilitiesListWebHandler from './src/web/capabilities/list/Handler';
import * as capabilitiesGetWebHandler from './src/web/capabilities/get/Handler';
import * as teamsGetWebHandler from './src/web/teams/get/Handler';
import * as experimentsGetWebHandler from './src/web/experiments/get/Handler';
import * as practicesListWebHandler from './src/web/practices/list/Handler';
import * as practicesGetWebHandler from './src/web/practices/get/Handler';
import * as overviewsGetWebHandler from './src/web/overviews/get/Handler';
import * as insightsGetWebHandler from './src/web/insights/get/Handler';

// Imperative Shell - All I/O happens here
// Infrastructure repositories
const capabilitiesRepo = new FilesystemCapabilitiesRepository();
const capabilityMetricsRepo = new FilesystemCapabilityMetricsRepository();
const teamsRepo = new FilesystemTeamsRepository();
const teamMetricsRepo = new FilesystemTeamMetricsRepository();
const experimentsRepo = new FilesystemExperimentsRepository();
const practicesRepo = new FilesystemPracticesRepository();
const summariesRepo = new FilesystemSummariesRepository();

// Application handlers
const capabilitiesListHandle = capabilitiesListAppHandler.create(
  capabilitiesRepo,
  capabilityMetricsRepo,
  teamsRepo
);
const capabilitiesGetHandle = capabilitiesGetAppHandler.create(
  capabilitiesRepo,
  capabilityMetricsRepo,
  teamsRepo
);
const teamsGetHandle = teamsGetAppHandler.create(
  capabilitiesRepo,
  capabilityMetricsRepo,
  teamsRepo,
  teamMetricsRepo,
  experimentsRepo,
  practicesRepo
);
const experimentsGetHandle = experimentsGetAppHandler.create(
  experimentsRepo,
  teamsRepo,
  capabilityMetricsRepo,
  teamMetricsRepo,
  practicesRepo
);
const practicesListHandle = practicesListAppHandler.create(practicesRepo);
const practicesGetHandle = practicesGetAppHandler.create(practicesRepo);
const overviewsGetHandle = overviewsGetAppHandler.create(
  capabilitiesRepo,
  capabilityMetricsRepo,
  teamsRepo,
  summariesRepo
);
const insightsGetHandle = insightsGetAppHandler.create(
  capabilitiesRepo,
  capabilityMetricsRepo,
  teamsRepo,
  teamMetricsRepo
);

// Web handlers
const handleCapabilityCatalog = capabilitiesListWebHandler.create(capabilitiesListHandle);
const handleCapabilityDetail = capabilitiesGetWebHandler.create(capabilitiesGetHandle);
const handleTeamDetail = teamsGetWebHandler.create(teamsGetHandle);
const handleExperimentDetail = experimentsGetWebHandler.create(experimentsGetHandle);
const handlePracticeCatalog = practicesListWebHandler.create(practicesListHandle);
const handlePracticeDetail = practicesGetWebHandler.create(practicesGetHandle);
const handleOverview = overviewsGetWebHandler.create(overviewsGetHandle);
const handleInsight = insightsGetWebHandler.create(insightsGetHandle);

const app = new Hono();

app.onError(async (err: Error, c: Context) => {
  console.log(formatErrorForLogging(err, { path: c.req.path, method: c.req.method }));

  if (isAppError(err)) {
    if (err instanceof NotFoundError) {
      return c.text(err.message, 404);
    }
    return c.text(`Server error: ${err.message}`, 500);
  }

  return c.text('An unexpected error occurred', 500);
});

const logger = createMiddleware(async (c, next) => {
  console.log(`[${c.req.method}] ${c.req.url}`);
  await next();
});

app.use(logger);

app.use(trimTrailingSlash());
app.use('/public/*', serveStatic({ root: './' }));
app.get('/favicon.ico', serveStatic({ path: './assets/favicon.ico' }));

app.get('/', handleOverview);
app.get('/archive/:date', handleOverview);
app.get('/insight', handleInsight);
app.get('/catalog/capability', handleCapabilityCatalog);
app.get('/catalog/capability/:capabilityId', handleCapabilityDetail);
app.get('/catalog/practice', handlePracticeCatalog);
app.get('/catalog/practice/:practiceId', handlePracticeDetail);
app.get('/team/:teamId', handleTeamDetail);
app.get('/experiment/:experimentId', handleExperimentDetail);

export default {
  port: 3000,
  fetch: app.fetch,
};

console.log('Server running at http://localhost:3000');
