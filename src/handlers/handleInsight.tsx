import { Context } from 'hono';
import { InsightsPage } from '../frontend/Pages/InsightsPage';
import { prepareInsightsData } from '../domain/prepareInsightsData';
import { enrichCapabilitiesWithAssessment } from '../domain/capabilityAggregations';
import {
  enrichTeamsWithMetrics,
  enrichCapabilitiesWithMetrics,
} from '../domain/metricAggregations';
import { loadCapabilitiesFromFilesystem } from '../loaders/loadCapabilitiesFromFilesystem';
import { loadCapabilityMetricsFromFilesystem } from '../loaders/loadCapabilityMetricsFromFilesystem';
import { loadTeamMetricsFromFilesystem } from '../loaders/loadTeamMetricsFromFilesystem';
import { loadTeamsFromFilesystem } from '../loaders/loadTeamsFromFilesystem';
import { parseAssessmentMarkdown } from '../parsers/markdown/assessmentParser';

export async function handleInsight(c: Context) {
  const rawCapabilities = await loadCapabilitiesFromFilesystem();
  const capabilityMetrics = await loadCapabilityMetricsFromFilesystem();

  const rawTeams = await loadTeamsFromFilesystem();

  const assessmentData = await parseAssessmentMarkdown();
  const capabilitiesWithAssessment = await enrichCapabilitiesWithAssessment(
    rawCapabilities,
    assessmentData
  ); // should come from parsed capabilities instead

  const teamMetrics = await loadTeamMetricsFromFilesystem();
  const teams = enrichTeamsWithMetrics(rawTeams, capabilityMetrics);

  // --- PURE TRANSFORMATION ---
  const capabilities = enrichCapabilitiesWithMetrics(
    capabilitiesWithAssessment,
    capabilityMetrics,
    teams
  );
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
}
