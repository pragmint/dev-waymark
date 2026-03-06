import { Capability } from '../schemas/capabilitySchemas';
import { Experiment } from '../schemas/experimentSchemas';
import { Team, TeamCapability } from '../schemas/teamSchemas';
import type { Practice } from '../application/practices/Repository';
import { TeamMetric } from '../frontend/scripts/insights-data';
import type { Metric } from '../schemas/metricSchemas';
import { NotFoundError } from './errors';
import { TeamDetailPageProps } from '../frontend/Pages/TeamDetailPage';
import { enrichTeamCapability } from './metricAggregations';

/**
 * Prepares all data needed for the Team Detail page
 * Pure, testable function that orchestrates data transformation
 * @throws {NotFoundError} if team is not found
 */
export function prepareTeamDetailData(
  teamId: string,
  teams: Team[],
  capabilities: Capability[],
  capabilityMetrics: Metric[],
  allExperiments: Experiment[],
  allTeamMetrics: TeamMetric[],
  practiceMap: Map<string, Practice> = new Map()
): TeamDetailPageProps {
  const team = teams.find(t => t.id === teamId);
  if (!team) {
    throw new NotFoundError('Team', teamId);
  }

  const experiments = allExperiments.filter(exp => exp.teamId === teamId);
  const teamMetrics = allTeamMetrics.filter(m => m.teamId === teamId);

  const capabilityMap = new Map(capabilities.map(cap => [cap.id, cap]));

  const metricsMap = new Map<string, Metric>();
  capabilityMetrics.forEach(metric => {
    metricsMap.set(metric.capabilityId, metric);
  });

  const teamCapabilityMap = new Map<string, TeamCapability>();
  for (const capability of capabilities) {
    const minimalCapability: TeamCapability = {
      id: capability.id,
      currentScore: null,
      trend: null,
    };
    const enrichedCapability = enrichTeamCapability(minimalCapability, teamId, metricsMap);
    teamCapabilityMap.set(capability.id, enrichedCapability);
  }

  return {
    team,
    allCapabilities: capabilities,
    capabilityMap,
    teamCapabilityMap,
    practiceMap,
    experiments,
    teamMetrics,
  };
}
