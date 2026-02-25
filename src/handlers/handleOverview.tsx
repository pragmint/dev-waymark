import { Context } from 'hono';
import { prepareOverviewData } from '../domain/prepareOverviewData';
import { OverviewPage } from '../frontend/Pages/OverviewPage';
import {
  enrichTeamsWithMetrics,
  enrichCapabilitiesWithMetrics,
} from '../domain/metricAggregations';
import { loadAndParseCapabilities } from '../loaders/loadAndParseCapabilities';
import { loadCapabilityMetricsFromFilesystem } from '../loaders/loadCapabilityMetricsFromFilesystem';
import { loadSummariesFromFilesystem } from '../loaders/loadSummariesFromFilesystem';
import { loadTeamsFromFilesystem } from '../loaders/loadTeamsFromFilesystem';

const capabilitiesWithAssessment = await loadAndParseCapabilities();
const capabilityMetrics = await loadCapabilityMetricsFromFilesystem();

const rawTeams = await loadTeamsFromFilesystem();

const summaries = await loadSummariesFromFilesystem();
const teams = enrichTeamsWithMetrics(rawTeams, capabilityMetrics);

// --- PURE TRANSFORMATION ---
const capabilities = enrichCapabilitiesWithMetrics(
  capabilitiesWithAssessment,
  capabilityMetrics,
  teams
);
export const handleOverview = async (c: Context) => {
  const data = prepareOverviewData(capabilities, summaries, c.req.param('date'));
  return c.html(<OverviewPage {...data} />);
};
