import { enrichCapabilitiesWithAssessment } from '../core/domain/capabilityAggregations';
import {
  enrichTeamsWithMetrics,
  enrichCapabilitiesWithMetrics,
} from '../core/domain/metricAggregations';
import { loadCapabilitiesFromFilesystem } from './loadCapabilitiesFromFilesystem';
import { loadCapabilityMetricsFromFilesystem } from './loadCapabilityMetricsFromFilesystem';
import { loadExperimentsFromFilesystem } from './loadExperimentsFromFilesystem';
import { loadSummariesFromFilesystem } from './loadSummariesFromFilesystem';
import { loadTeamMetricsFromFilesystem } from './loadTeamMetricsFromFilesystem';
import { loadTeamsFromFilesystem } from './loadTeamsFromFilesystem';

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
export async function loadDataContext() {
  return {
    enrichedExperiments: experiments,
    capabilities,
    summaries,
    teams,
    teamMetrics,
    capabilityMetrics,
  };
}
