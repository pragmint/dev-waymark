import { Capability, TrendDirection } from './capabilitySchemas';
import { Experiment } from './experimentSchemas';
import { Team, TeamCapability } from './teamSchemas';
import { loadPracticeFromFilesystem, Practice } from '../../loaders/loadPracticeFromFilesystem';
import { TeamMetric } from '../../frontend/scripts/insights-data';
import { parseDate } from '../utils/dateFormatter';
import type { Metric } from '../../parsers/yaml/metricParser';
import { NotFoundError } from '../../shell/middleware/errorHandler';
import { TeamDetailPageProps } from '../../frontend/Pages/TeamDetailPage';
import { getNumericScore } from './metricHelpers';

/**
 * Helper function to enrich a capability with team's metric data
 */
function enrichCapabilityWithTeamMetrics(
  capabilityId: string,
  teamId: string,
  metrics: Metric[]
): TeamCapability {
  const metric = metrics.find(m => m.capabilityId === capabilityId);

  if (!metric) {
    return {
      id: capabilityId,
      currentScore: null,
      trend: null,
    };
  }

  const teamData = metric.data.filter(d => d.team === teamId);

  if (teamData.length === 0) {
    return {
      id: capabilityId,
      currentScore: null,
      trend: null,
    };
  }

  const sortedData = teamData.sort(
    (a, b) => parseDate(b.date).getTime() - parseDate(a.date).getTime()
  );
  const currentScore = getNumericScore(sortedData[0].value);

  let trend: TrendDirection | null = 'stable';
  if (sortedData.length >= 2) {
    const currentValue = getNumericScore(sortedData[0].value);
    const previousValue = getNumericScore(sortedData[1].value);
    const scoreDiff = currentValue - previousValue;
    if (scoreDiff > 0) {
      trend = 'up';
    } else if (scoreDiff < 0) {
      trend = 'down';
    }
  } else {
    trend = null;
  }

  return {
    id: capabilityId,
    currentScore,
    trend,
  };
}

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

  const teamCapabilityMap = new Map<string, TeamCapability>();
  for (const capability of capabilities) {
    const enrichedCapability = enrichCapabilityWithTeamMetrics(
      capability.id,
      teamId,
      capabilityMetrics
    );
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
