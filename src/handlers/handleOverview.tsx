import { Context } from 'hono';
import { prepareOverviewData } from '../domain/prepareOverviewData';
import { OverviewPage } from '../frontend/Pages/OverviewPage';
import { enrichCapabilitiesWithAssessment } from '../domain/capabilityAggregations';
import { enrichTeamsWithMetrics, enrichCapabilitiesWithMetrics } from '../domain/metricAggregations';
import { loadCapabilitiesFromFilesystem } from '../loaders/loadCapabilitiesFromFilesystem';
import { loadCapabilityMetricsFromFilesystem } from '../loaders/loadCapabilityMetricsFromFilesystem';
import { loadSummariesFromFilesystem } from '../loaders/loadSummariesFromFilesystem';
import { loadTeamsFromFilesystem } from '../loaders/loadTeamsFromFilesystem';
import { parseAssessmentMarkdown } from '../parsers/markdown/assessmentParser';

export const handleOverview = async (c: Context) => {
  const rawCapabilities = await loadCapabilitiesFromFilesystem();
  const capabilityMetrics = await loadCapabilityMetricsFromFilesystem();

  const rawTeams = await loadTeamsFromFilesystem();

  const assessmentData = await parseAssessmentMarkdown();
  const capabilitiesWithAssessment = await enrichCapabilitiesWithAssessment(
    rawCapabilities,
    assessmentData
  );

  const summaries = await loadSummariesFromFilesystem();
  const teams = enrichTeamsWithMetrics(rawTeams, capabilityMetrics);

  // --- PURE TRANSFORMATION ---
  const capabilities = enrichCapabilitiesWithMetrics(
    capabilitiesWithAssessment,
    capabilityMetrics,
    teams
  );
  const date = c.req.param('date');
  if (date === undefined) {
    const data = prepareOverviewData(teams, capabilities, summaries);
    return c.html(<OverviewPage {...data} />);
  } else {
    const data = prepareOverviewData(teams, capabilities, summaries, date);
    return c.html(<OverviewPage {...data} />);
  }
};
