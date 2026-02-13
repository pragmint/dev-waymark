import {
  enrichTeamsWithMetrics,
  enrichCapabilitiesWithMetrics,
  enrichExperimentsWithMetrics,
} from '../core/data/metricAggregations';
import {
  loadCapabilitiesFromFilesystem,
  enrichCapabilitiesWithAssessment,
} from './capabilityLoader';
import { loadExperimentsFromFilesystem } from './experimentLoader';
import {
  loadCapabilityMetricsFromFilesystem,
  loadTeamMetricsFromFilesystem,
} from './metricLoader';
import { loadSummariesFromFilesystem } from './summaryLoader';
import { loadTeamsFromFilesystem } from './teamLoader';

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
