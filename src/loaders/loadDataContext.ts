import {
  enrichTeamsWithMetrics,
  enrichCapabilitiesWithMetrics,
  enrichExperimentsWithMetrics,
} from '../core/data/metricAggregations';
import {
  loadCapabilitiesFromFilesystem,
  enrichCapabilitiesWithAssessment,
} from '../shell/loaders/capabilityLoader';
import { loadExperimentsFromFilesystem } from '../shell/loaders/experimentLoader';
import {
  loadCapabilityMetricsFromFilesystem,
  loadTeamMetricsFromFilesystem,
} from '../shell/loaders/metricLoader';
import { loadSummariesFromFilesystem } from '../shell/loaders/summaryLoader';
import { loadTeamsFromFilesystem } from '../shell/loaders/teamLoader';

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

export async function loadDataContext() {
  return { enrichedExperiments, capabilities, summaries, teams, teamMetrics, capabilityMetrics };
}
