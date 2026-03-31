import { Context } from 'hono';
import { InsightsPage } from '../frontend/Pages/InsightsPage';
import { prepareInsightsData } from '../domain/prepareInsightsData';
import {
  enrichTeamsWithMetrics,
  enrichCapabilitiesWithMetrics,
} from '../domain/metricAggregations';
import { loadAndParseCapabilities } from '../loaders/loadAndParseCapabilities';
import { loadCapabilityMetricsFromFilesystem } from '../loaders/loadCapabilityMetricsFromFilesystem';
import { loadTeamMetricsFromFilesystem } from '../loaders/loadTeamMetricsFromFilesystem';
import { loadTeamsFromFilesystem } from '../loaders/loadTeamsFromFilesystem';
import { loadExperimentsFromFilesystem } from '../loaders/loadExperimentsFromFilesystem';

const capabilitiesWithAssessment = await loadAndParseCapabilities();
const capabilityMetrics = await loadCapabilityMetricsFromFilesystem();

const rawTeams = await loadTeamsFromFilesystem();

const teamMetrics = await loadTeamMetricsFromFilesystem();
const teams = enrichTeamsWithMetrics(rawTeams, capabilityMetrics);

const allExperiments = await loadExperimentsFromFilesystem();

// --- PURE TRANSFORMATION ---
const capabilities = enrichCapabilitiesWithMetrics(
  capabilitiesWithAssessment,
  capabilityMetrics,
  teams
);
const insightsData = prepareInsightsData(teams, capabilities, capabilityMetrics, teamMetrics);

// Lightweight experiment options for the client (only fields needed for overlay rendering)
const experimentOptions = allExperiments.map(exp => ({
  id: exp.id,
  title: exp.title,
  teamId: exp.teamId,
  startDate: exp.startDate ?? null,
  expectedDurationInWeeks: exp.expectedDurationInWeeks ?? null,
}));

export async function handleInsight(c: Context) {
  return c.html(
    <InsightsPage
      teams={insightsData.teams}
      metricOptions={insightsData.metricOptions}
      capabilityMetricsJson={JSON.stringify(insightsData.capabilityMetrics)}
      teamMetricsJson={JSON.stringify(insightsData.teamMetrics)}
      availableDates={insightsData.availableDates}
      experimentsJson={JSON.stringify(experimentOptions)}
    />
  );
}
