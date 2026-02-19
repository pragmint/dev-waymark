import { enrichCapabilitiesWithAssessment } from '../domain/capabilityAggregations';
import {
  enrichTeamsWithMetrics,
  enrichCapabilitiesWithMetrics,
} from '../domain/metricAggregations';
import { parseAssessmentMarkdown } from '../parsers/markdown/assessmentParser';
import { loadCapabilitiesFromFilesystem } from './loadCapabilitiesFromFilesystem';
import { loadCapabilityMetricsFromFilesystem } from './loadCapabilityMetricsFromFilesystem';
import { loadExperimentsFromFilesystem } from './loadExperimentsFromFilesystem';
import { loadSummariesFromFilesystem } from './loadSummariesFromFilesystem';
import { loadTeamMetricsFromFilesystem } from './loadTeamMetricsFromFilesystem';
import { loadTeamsFromFilesystem } from './loadTeamsFromFilesystem';

// load data

const rawCapabilities = await loadCapabilitiesFromFilesystem();
const capabilityMetrics = await loadCapabilityMetricsFromFilesystem();

const rawTeams = await loadTeamsFromFilesystem();

const assessmentData = await parseAssessmentMarkdown();
const capabilitiesWithAssessment = await enrichCapabilitiesWithAssessment(
  rawCapabilities,
  assessmentData
); // should come from parsed capabilities instead

const experiments = await loadExperimentsFromFilesystem();
const metrics = await loadTeamMetricsFromFilesystem();
const summaries = await loadSummariesFromFilesystem();
const teams = enrichTeamsWithMetrics(rawTeams, capabilityMetrics); // why...

// --- PURE TRANSFORMATION ---
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
    teamMetrics: metrics,
    capabilityMetrics,
  };
}
