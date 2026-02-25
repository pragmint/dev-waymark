import { Context } from 'hono';
import { TeamDetailPage } from '../frontend/Pages/TeamDetailPage';
import { prepareTeamDetailData } from '../domain/prepareTeamDetailData';
import {
  enrichTeamsWithMetrics,
  enrichCapabilitiesWithMetrics,
} from '../domain/metricAggregations';
import { loadAndParseCapabilities } from '../loaders/loadAndParseCapabilities';
import { loadCapabilityMetricsFromFilesystem } from '../loaders/loadCapabilityMetricsFromFilesystem';
import { loadExperimentsFromFilesystem } from '../loaders/loadExperimentsFromFilesystem';
import { loadTeamMetricsFromFilesystem } from '../loaders/loadTeamMetricsFromFilesystem';
import { loadTeamsFromFilesystem } from '../loaders/loadTeamsFromFilesystem';

const capabilitiesWithAssessment = await loadAndParseCapabilities();
const capabilityMetrics = await loadCapabilityMetricsFromFilesystem();

const rawTeams = await loadTeamsFromFilesystem();

const experiments = await loadExperimentsFromFilesystem();
const teamMetrics = await loadTeamMetricsFromFilesystem();
const teams = enrichTeamsWithMetrics(rawTeams, capabilityMetrics);

// --- PURE TRANSFORMATION ---
const capabilities = enrichCapabilitiesWithMetrics(
  capabilitiesWithAssessment,
  capabilityMetrics,
  teams
);

export async function handleTeamDetail(c: Context) {
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
