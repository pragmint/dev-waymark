// Imperative Shell - All I/O happens here
// Core business logic is imported as pure functions

import { Hono } from 'hono';
import { serveStatic } from 'hono/bun';
import { loadTeamsFromFilesystem } from './src/shell/loaders/teamLoader';
import { loadCapabilitiesFromFilesystem } from './src/shell/loaders/capabilityLoader';
import { loadPracticeFromFilesystem, loadAllPracticesFromFilesystem } from './src/shell/loaders/practiceLoader';
import { enrichCapabilitiesWithTeamData } from './src/core/data/capabilityAggregations';
import { getTopThreeCapabilities, groupCapabilitiesByCategory, findCapabilityById } from './src/core/data/capabilityQueries';
import { findTeamById, findExperimentById } from './src/core/data/teamQueries';
import { OverviewPage } from './src/pages/OverviewPage';
import { ComingSoonPage } from './src/pages/ComingSoonPage';
import { CapabilityCatalogPage } from './src/pages/CapabilityCatalogPage';
import { CapabilityDetailPage } from './src/pages/CapabilityDetailPage';
import { PracticesCatalogPage } from './src/pages/PracticesCatalogPage';
import { PracticeDetailPage } from './src/pages/PracticeDetailPage';
import { TeamDetailPage } from './src/pages/TeamDetailPage';
import { ExperimentDetailPage } from './src/pages/ExperimentDetailPage';

// --- INITIALIZATION (I/O) ---
const rawCapabilities = await loadCapabilitiesFromFilesystem();
const teams = await loadTeamsFromFilesystem();

// --- PURE TRANSFORMATION ---
const capabilities = enrichCapabilitiesWithTeamData(rawCapabilities, teams);

// --- HONO APP SETUP ---
const app = new Hono();

// Serve static files
app.use('/resources/*', serveStatic({ root: './' }));

// Overview page
app.get('/', (c) => {
  const topThree = getTopThreeCapabilities(capabilities);
  const capabilitiesByCategory = groupCapabilitiesByCategory(capabilities);

  return c.html(
    <OverviewPage
      teams={teams}
      topThree={topThree}
      capabilitiesByCategory={capabilitiesByCategory}
    />
  );
});

// Coming soon pages
app.get('/insight/', (c) => {
  return c.html(
    <ComingSoonPage
      teams={teams}
      title="Insights"
      heading="Insights"
      activePage="insights"
    />
  );
});

// Capability catalog page
app.get('/catalog/capability/', (c) => {
  const capabilitiesByCategory = groupCapabilitiesByCategory(capabilities);

  return c.html(
    <CapabilityCatalogPage
      teams={teams}
      capabilitiesByCategory={capabilitiesByCategory}
    />
  );
});

// Capability detail page
app.get('/catalog/capability/:capabilityId', async (c) => {
  const capabilityId = c.req.param('capabilityId');
  const capability = findCapabilityById(capabilities, capabilityId);

  if (!capability) {
    return c.text('Capability not found', 404);
  }

  return c.html(
    <CapabilityDetailPage
      teams={teams}
      capability={capability}
    />
  );
});

// Practice catalog page
app.get('/catalog/practice/', async (c) => {
  const practices = await loadAllPracticesFromFilesystem();

  return c.html(
    <PracticesCatalogPage
      teams={teams}
      practices={practices}
    />
  );
});

// Practice detail page
app.get('/catalog/practice/:practiceId/', async (c) => {
  const practiceId = c.req.param('practiceId');
  const practice = await loadPracticeFromFilesystem(practiceId);

  if (!practice) {
    return c.text('Practice not found', 404);
  }

  return c.html(
    <PracticeDetailPage
      teams={teams}
      practice={practice}
    />
  );
});

// Resources catalog (coming soon)
app.get('/catalog/resource/', (c) => {
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
app.get('/team/:teamId/', async (c) => {
  const teamId = c.req.param('teamId');
  const team = findTeamById(teams, teamId);

  if (!team) {
    return c.text('Team not found', 404);
  }

  // Prepare data for rendering
  const capabilitiesByCategory = groupCapabilitiesByCategory(capabilities);
  const capabilityMap = new Map(capabilities.map(cap => [cap.id, cap]));

  // Load practices for all experiments
  const practiceMap = new Map();
  for (const exp of team.activeExperiments) {
    const practice = await loadPracticeFromFilesystem(exp.practiceId);
    if (practice) {
      practiceMap.set(exp.practiceId, practice);
    }
  }

  return c.html(
    <TeamDetailPage
      teams={teams}
      team={team}
      capabilitiesByCategory={capabilitiesByCategory}
      capabilityMap={capabilityMap}
      practiceMap={practiceMap}
    />
  );
});

// Experiment detail page
app.get('/experiment/:experimentId/', async (c) => {
  const experimentId = c.req.param('experimentId');
  const result = findExperimentById(teams, experimentId);

  if (!result) {
    return c.text('Experiment not found', 404);
  }

  const { team, experiment } = result;
  const practice = await loadPracticeFromFilesystem(experiment.practiceId);
  const practiceName = practice ? practice.title : experiment.practiceId;

  return c.html(
    <ExperimentDetailPage
      teams={teams}
      team={team}
      experiment={experiment}
      practiceName={practiceName}
    />
  );
});

// --- HTTP SERVER (I/O) ---
export default {
  port: 3000,
  fetch: app.fetch,
};

console.log('Server running at http://localhost:3000');
