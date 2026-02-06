// Imperative Shell - All I/O happens here
// Core business logic is imported as pure functions

import { Hono } from 'hono';
import type { Context } from 'hono';
import { serveStatic } from 'hono/bun';
import { errorHandler } from './src/shell/middleware/errorHandler';
import { loadTeamsFromFilesystem } from './src/shell/loaders/teamLoader';
import {
  loadCapabilitiesFromFilesystem,
  enrichCapabilitiesWithAssessment,
  loadCapabilityMarkdown,
} from './src/shell/loaders/capabilityLoader';
import {
  loadPracticeFromFilesystem,
  loadAllPracticesFromFilesystem,
} from './src/shell/loaders/practiceLoader';
import { loadSummariesFromFilesystem } from './src/shell/loaders/summaryLoader';
import {
  loadCapabilityMetricsFromFilesystem,
  loadTeamMetricsFromFilesystem,
} from './src/shell/loaders/metricLoader';
import { loadExperimentsFromFilesystem } from './src/shell/loaders/experimentLoader';
import {
  enrichCapabilitiesWithMetrics,
  enrichTeamsWithMetrics,
  enrichExperimentsWithMetrics,
} from './src/core/data/metricAggregations';
import {
  getAllCapabilities,
  findCapabilityById,
  getCapabilityScoreForTeam,
} from './src/core/data/capabilityQueries';
import { NotFoundError } from './src/core/errors';
import { OverviewPage } from './src/pages/OverviewPage';
import { CapabilityCatalogPage } from './src/pages/CapabilityCatalogPage';
import { CapabilityDetailPage } from './src/pages/CapabilityDetailPage';
import { PracticesCatalogPage } from './src/pages/PracticesCatalogPage';
import { PracticeDetailPage } from './src/pages/PracticeDetailPage';
import { TeamDetailPage } from './src/pages/TeamDetailPage';
import { ExperimentDetailPage } from './src/pages/ExperimentDetailPage';
import { InsightsPage } from './src/pages/InsightsPage';
import { prepareOverviewData } from './src/pages/handlers/OverviewHandler';
import { prepareTeamDetailData } from './src/pages/handlers/TeamDetailHandler';
import { prepareExperimentDetailData } from './src/pages/handlers/ExperimentDetailHandler';
import { prepareInsightsData } from './src/pages/handlers/InsightsHandler';

// --- INITIALIZATION (I/O) ---
const rawCapabilities = await loadCapabilitiesFromFilesystem();
const capabilitiesWithAssessment = await enrichCapabilitiesWithAssessment(rawCapabilities);
const rawTeams = await loadTeamsFromFilesystem();
const capabilityMetrics = await loadCapabilityMetricsFromFilesystem();
const teamMetrics = await loadTeamMetricsFromFilesystem();
const experiments = await loadExperimentsFromFilesystem();
const summaries = await loadSummariesFromFilesystem();

// --- PURE TRANSFORMATION ---
const teams = enrichTeamsWithMetrics(rawTeams, capabilityMetrics);
const capabilities = enrichCapabilitiesWithMetrics(
  capabilitiesWithAssessment,
  capabilityMetrics,
  teams
);
const enrichedExperiments = enrichExperimentsWithMetrics(experiments, teamMetrics);

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
const handleArchive = (c: Context) => {
  const date = c.req.param('date');
  const data = prepareOverviewData(teams, capabilities, summaries, date);
  return c.html(<OverviewPage {...data} />);
};

app.get('/archive/:date', handleArchive);
app.get('/archive/:date/', handleArchive);

// Insights page
const handleInsight = (c: Context) => {
  const insightsData = prepareInsightsData(teams, capabilities, capabilityMetrics, teamMetrics);

  return c.html(
    <InsightsPage
      teams={insightsData.teams}
      metricOptions={insightsData.metricOptions}
      capabilityMetricsJson={JSON.stringify(insightsData.capabilityMetrics)}
      teamMetricsJson={JSON.stringify(insightsData.teamMetrics)}
      availableDates={insightsData.availableDates}
    />
  );
};

app.get('/insight', handleInsight);
app.get('/insight/', handleInsight);

// Capability catalog page
const handleCapabilityCatalog = (c: Context) => {
  const allCapabilities = getAllCapabilities(capabilities);

  return c.html(<CapabilityCatalogPage teams={teams} allCapabilities={allCapabilities} />);
};

app.get('/catalog/capability', handleCapabilityCatalog);
app.get('/catalog/capability/', handleCapabilityCatalog);

// Capability detail page handler (shared logic)
const handleCapabilityDetail = async (c: Context) => {
  const capabilityId = c.req.param('capabilityId');
  const capability = findCapabilityById(capabilities, capabilityId);

  if (!capability) {
    throw new NotFoundError('Capability', capabilityId);
  }

  // Get team filter from query string
  let teamFilter = c.req.query('team') || 'all';

  // If there's only one team, automatically show that team's score
  if (teams.length === 1 && teamFilter === 'all') {
    const singleTeamId = teams[0].id;
    return c.redirect(`/catalog/capability/${capabilityId}?team=${singleTeamId}`);
  }

  // Calculate team-specific score
  const filteredCapability = getCapabilityScoreForTeam(capability, capabilityMetrics, teamFilter);

  // Load capability markdown content
  const markdownContent = await loadCapabilityMarkdown(capabilityId);

  return c.html(
    <CapabilityDetailPage
      teams={teams}
      capability={filteredCapability}
      selectedTeam={teamFilter}
      markdownContent={markdownContent}
    />
  );
};

// Capability detail page (with and without trailing slash)
app.get('/catalog/capability/:capabilityId', handleCapabilityDetail);
app.get('/catalog/capability/:capabilityId/', handleCapabilityDetail);

// Practice catalog page
const handlePracticeCatalog = async (c: Context) => {
  const practices = await loadAllPracticesFromFilesystem();

  return c.html(<PracticesCatalogPage teams={teams} practices={practices} />);
};

app.get('/catalog/practice', handlePracticeCatalog);
app.get('/catalog/practice/', handlePracticeCatalog);

// Practice detail page
const handlePracticeDetail = async (c: Context) => {
  const practiceId = c.req.param('practiceId');
  const practice = await loadPracticeFromFilesystem(practiceId);

  if (!practice) {
    throw new NotFoundError('Practice', practiceId);
  }

  return c.html(<PracticeDetailPage teams={teams} practice={practice} />);
};

app.get('/catalog/practice/:practiceId', handlePracticeDetail);
app.get('/catalog/practice/:practiceId/', handlePracticeDetail);

// Team detail page
const handleTeamDetail = async (c: Context) => {
  const teamId = c.req.param('teamId');
  const data = await prepareTeamDetailData(
    teamId,
    teams,
    capabilities,
    capabilityMetrics,
    enrichedExperiments,
    teamMetrics
  );
  return c.html(<TeamDetailPage {...data} />);
};

app.get('/team/:teamId', handleTeamDetail);
app.get('/team/:teamId/', handleTeamDetail);

// Experiment detail page
const handleExperimentDetail = async (c: Context) => {
  const experimentId = c.req.param('experimentId');
  const data = await prepareExperimentDetailData(experimentId, teams, enrichedExperiments);
  return c.html(<ExperimentDetailPage {...data} />);
};

app.get('/experiment/:experimentId', handleExperimentDetail);
app.get('/experiment/:experimentId/', handleExperimentDetail);

// --- HTTP SERVER (I/O) ---
export default {
  port: 3000,
  fetch: app.fetch,
};

console.log('Server running at http://localhost:3000');
