// Imperative Shell - All I/O happens here
// Core business logic is imported as pure functions

import { Hono } from 'hono';
import { serveStatic } from 'hono/bun';
import { errorHandler } from './src/shell/middleware/errorHandler';
import { loadTeamsFromFilesystem } from './src/shell/loaders/teamLoader';
import { loadCapabilitiesFromFilesystem } from './src/shell/loaders/capabilityLoader';
import {
  loadPracticeFromFilesystem,
  loadAllPracticesFromFilesystem,
} from './src/shell/loaders/practiceLoader';
import { loadSummariesFromFilesystem } from './src/shell/loaders/summaryLoader';
import { enrichCapabilitiesWithTeamData } from './src/core/data/capabilityAggregations';
import { groupCapabilitiesByCategory, findCapabilityById } from './src/core/data/capabilityQueries';
import { NotFoundError } from './src/core/errors';
import { OverviewPage } from './src/pages/OverviewPage';
import { ComingSoonPage } from './src/pages/ComingSoonPage';
import { CapabilityCatalogPage } from './src/pages/CapabilityCatalogPage';
import { CapabilityDetailPage } from './src/pages/CapabilityDetailPage';
import { PracticesCatalogPage } from './src/pages/PracticesCatalogPage';
import { PracticeDetailPage } from './src/pages/PracticeDetailPage';
import { TeamDetailPage } from './src/pages/TeamDetailPage';
import { ExperimentDetailPage } from './src/pages/ExperimentDetailPage';
import { prepareOverviewData } from './src/pages/handlers/OverviewHandler';
import { prepareTeamDetailData } from './src/pages/handlers/TeamDetailHandler';
import { prepareExperimentDetailData } from './src/pages/handlers/ExperimentDetailHandler';

// --- INITIALIZATION (I/O) ---
const rawCapabilities = await loadCapabilitiesFromFilesystem();
const teams = await loadTeamsFromFilesystem();
const summaries = await loadSummariesFromFilesystem();

// --- PURE TRANSFORMATION ---
const capabilities = enrichCapabilitiesWithTeamData(rawCapabilities, teams);

// --- HONO APP SETUP ---
const app = new Hono();

// Register error handler
app.onError(errorHandler);

// Serve static files
app.use('/resources/*', serveStatic({ root: './' }));

// Overview page
app.get('/', c => {
  const data = prepareOverviewData(teams, capabilities, summaries);
  return c.html(<OverviewPage {...data} />);
});

// Archive page - displays a specific summary by date
app.get('/archive/:date/', c => {
  const date = c.req.param('date');
  const data = prepareOverviewData(teams, capabilities, summaries, date);
  return c.html(<OverviewPage {...data} />);
});

// Coming soon pages
app.get('/insight/', c => {
  return c.html(
    <ComingSoonPage teams={teams} title="Insights" heading="Insights" activePage="insights" />
  );
});

// Capability catalog page
app.get('/catalog/capability/', c => {
  const capabilitiesByCategory = groupCapabilitiesByCategory(capabilities);

  return c.html(
    <CapabilityCatalogPage teams={teams} capabilitiesByCategory={capabilitiesByCategory} />
  );
});

// Capability detail page
app.get('/catalog/capability/:capabilityId', async c => {
  const capabilityId = c.req.param('capabilityId');
  const capability = findCapabilityById(capabilities, capabilityId);

  if (!capability) {
    throw new NotFoundError('Capability', capabilityId);
  }

  return c.html(<CapabilityDetailPage teams={teams} capability={capability} />);
});

// Practice catalog page
app.get('/catalog/practice/', async c => {
  const practices = await loadAllPracticesFromFilesystem();

  return c.html(<PracticesCatalogPage teams={teams} practices={practices} />);
});

// Practice detail page
app.get('/catalog/practice/:practiceId/', async c => {
  const practiceId = c.req.param('practiceId');
  const practice = await loadPracticeFromFilesystem(practiceId);

  if (!practice) {
    throw new NotFoundError('Practice', practiceId);
  }

  return c.html(<PracticeDetailPage teams={teams} practice={practice} />);
});

// Resources catalog (coming soon)
app.get('/catalog/resource/', c => {
  return c.html(
    <ComingSoonPage
      teams={teams}
      title="Resources Catalog"
      heading="Resources"
      activePage="resources"
    />
  );
});

// Team detail page
app.get('/team/:teamId/', async c => {
  const teamId = c.req.param('teamId');
  const data = await prepareTeamDetailData(teamId, teams, capabilities);
  return c.html(<TeamDetailPage {...data} />);
});

// Experiment detail page
app.get('/experiment/:experimentId/', async c => {
  const experimentId = c.req.param('experimentId');
  const data = await prepareExperimentDetailData(experimentId, teams);
  return c.html(<ExperimentDetailPage {...data} />);
});

// --- HTTP SERVER (I/O) ---
export default {
  port: 3000,
  fetch: app.fetch,
};

console.log('Server running at http://localhost:3000');
