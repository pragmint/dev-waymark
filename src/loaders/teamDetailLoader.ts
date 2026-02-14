import { Capability, TrendDirection } from '../core/data/capabilitySchemas';
import { Experiment } from '../core/data/experimentSchemas';
import { Team, TeamCapability } from '../core/data/teamSchemas';
import { loadPracticeFromFilesystem } from './loadPractice';
import { TeamMetric } from '../frontend/scripts/insights-data';
import { parseDate } from '../frontend/scripts/insights-utils';
import type { MetricValue, Metric } from '../parsers/yaml/metricParser';
import { Practice } from './practiceLoader';
import { NotFoundError } from '../shell/middleware/errorHandler';
import { TeamDetailPageProps } from '../frontend/Pages/TeamDetailPage';

/**
 * Helper function to check if a value is a dimension score object
 */
function isDimensionScore(value: MetricValue): value is Record<string, number> {
  return typeof value === 'object' && !Array.isArray(value) && value !== null;
}

/**
 * Helper function to calculate average score from a metric value
 * If the value is a dimension score object, returns the average across all dimensions
 * Otherwise, returns the value as-is if it's a number, or 0 if it's a string
 */
function getNumericScore(value: MetricValue): number {
  if (typeof value === 'number') {
    return value;
  }
  if (isDimensionScore(value)) {
    const scores = Object.values(value);
    return scores.reduce((sum, score) => sum + score, 0) / scores.length;
  }
  return 0; // String values or other types default to 0
}

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
    // No metrics for this capability
    return {
      id: capabilityId,
      currentScore: null,
      trend: null,
    };
  }

  // Find the most recent data point for this team
  const teamData = metric.data.filter(d => d.team === teamId);

  if (teamData.length === 0) {
    // No data for this team
    return {
      id: capabilityId,
      currentScore: null,
      trend: null,
    };
  }

  // Get most recent score
  const sortedData = teamData.sort(
    (a, b) => parseDate(b.date).getTime() - parseDate(a.date).getTime()
  );
  const currentScore = getNumericScore(sortedData[0].value);

  // Calculate trend
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
    // Only one data point, no trend
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
  // Find the requested team
  //
  const team = teams.find(t => t.id === teamId);
  if (!team) {
    throw new NotFoundError('Team', teamId);
  }

  // Get experiments for this team
  const experiments = allExperiments.filter(exp => exp.teamId === teamId);

  // Get team metrics for this team
  const teamMetrics = allTeamMetrics.filter(m => m.teamId === teamId);

  // Prepare capability data for rendering
  const capabilityMap = new Map(capabilities.map(cap => [cap.id, cap]));

  // Enrich all capabilities with team's metric data
  const teamCapabilityMap = new Map<string, TeamCapability>();
  for (const capability of capabilities) {
    const enrichedCapability = enrichCapabilityWithTeamMetrics(
      capability.id,
      teamId,
      capabilityMetrics
    );
    teamCapabilityMap.set(capability.id, enrichedCapability);
  }

  // Load practices for all experiments (new and old format)
  const practiceMap = new Map<string, Practice>();

  // Load practices from new experiments
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

  // Load practices from old activeExperiments (if present)
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
