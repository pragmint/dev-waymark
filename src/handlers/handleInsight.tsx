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

const capabilitiesWithAssessment = await loadAndParseCapabilities();
const capabilityMetrics = await loadCapabilityMetricsFromFilesystem();

const rawTeams = await loadTeamsFromFilesystem();

const teamMetrics = await loadTeamMetricsFromFilesystem();
const teams = enrichTeamsWithMetrics(rawTeams, capabilityMetrics);

// --- PURE TRANSFORMATION ---
const capabilities = enrichCapabilitiesWithMetrics(
  capabilitiesWithAssessment,
  capabilityMetrics,
  teams
);
const insightsData = prepareInsightsData(teams, capabilities, capabilityMetrics, teamMetrics);

export async function handleInsight(c: Context) {
  return c.html(
    <InsightsPage
      teams={insightsData.teams}
      availableDates={insightsData.availableDates}
      metricOptions={insightsData.metricOptions}
    />
  );
}
