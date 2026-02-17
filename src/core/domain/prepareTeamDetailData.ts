import { Capability } from './capabilitySchemas';
import { Experiment } from './experimentSchemas';
import { Team, TeamCapability } from './teamSchemas';
import { loadPracticeFromFilesystem, Practice } from '../../loaders/loadPracticeFromFilesystem';
import { TeamMetric } from '../../frontend/scripts/insights-data';
import type { Metric } from '../../parsers/yaml/metricParser';
import { NotFoundError } from './errors';
import { TeamDetailPageProps } from '../../frontend/Pages/TeamDetailPage';
import { enrichTeamCapability } from './metricAggregations';

/**
 * Prepares all data needed for the Team Detail page
 * Pure, testable function that orchestrates data loading and transformation
 * @throws {NotFoundError} if team is not found
 */
export async function prepareTeamDetailData(
  teamId: string,
  teams: Team[],
  capabilities: Capability[],
  capabilityMetrics: Metric[],
  allExperiments: Experiment[],
  allTeamMetrics: TeamMetric[]
): Promise<TeamDetailPageProps> {
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

  const practiceMap = new Map<string, Practice>();

  for (const experiment of experiments) {
    try {
      const practice = await loadPracticeFromFilesystem(experiment.intervention.practiceUnderTest);
      if (practice) {
        practiceMap.set(experiment.intervention.practiceUnderTest, practice);
      }
    } catch {
      // Practice file doesn't exist - skip it
      // The UI will fall back to displaying the practice ID
    }
  }

  if (team.activeExperiments) {
    for (const experiment of team.activeExperiments) {
      try {
        const practice = await loadPracticeFromFilesystem(experiment.practiceId);
        if (practice) {
          practiceMap.set(experiment.practiceId, practice);
        }
      } catch {
        // Practice file doesn't exist - skip it
      }
    }
  }

  return {
    teams,
    team,
    allCapabilities: capabilities,
    capabilityMap,
    teamCapabilityMap,
    practiceMap,
    experiments,
    teamMetrics,
  };
}
