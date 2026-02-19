import { Context } from 'hono';
import { TeamDetailPage } from '../frontend/Pages/TeamDetailPage';
import { prepareTeamDetailData } from '../domain/prepareTeamDetailData';
import { enrichCapabilitiesWithAssessment } from '../domain/capabilityAggregations';
import {
  enrichTeamsWithMetrics,
  enrichCapabilitiesWithMetrics,
} from '../domain/metricAggregations';
import { loadCapabilitiesFromFilesystem } from '../loaders/loadCapabilitiesFromFilesystem';
import { loadCapabilityMetricsFromFilesystem } from '../loaders/loadCapabilityMetricsFromFilesystem';
import { loadExperimentsFromFilesystem } from '../loaders/loadExperimentsFromFilesystem';
import { loadTeamMetricsFromFilesystem } from '../loaders/loadTeamMetricsFromFilesystem';
import { loadTeamsFromFilesystem } from '../loaders/loadTeamsFromFilesystem';
import { parseAssessmentMarkdown } from '../parsers/markdown/assessmentParser';

export async function handleTeamDetail(c: Context) {
  const rawCapabilities = await loadCapabilitiesFromFilesystem();
  const capabilityMetrics = await loadCapabilityMetricsFromFilesystem();

  const rawTeams = await loadTeamsFromFilesystem();

  const assessmentData = await parseAssessmentMarkdown();
  const capabilitiesWithAssessment = await enrichCapabilitiesWithAssessment(
    rawCapabilities,
    assessmentData
  ); // should come from parsed capabilities instead

  const experiments = await loadExperimentsFromFilesystem();
  const teamMetrics = await loadTeamMetricsFromFilesystem();
  const teams = enrichTeamsWithMetrics(rawTeams, capabilityMetrics); // why...

  // --- PURE TRANSFORMATION ---
  const capabilities = enrichCapabilitiesWithMetrics(
    capabilitiesWithAssessment,
    capabilityMetrics,
    teams
  );

  const teamId = c.req.param('teamId');
  const data = await prepareTeamDetailData(
    teamId,
    teams,
    capabilities,
    capabilityMetrics,
    experiments,
    teamMetrics
  );

  return c.html(<TeamDetailPage {...data} />);
}
