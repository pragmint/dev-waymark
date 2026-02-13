import type { Capability, TrendDirection } from './capabilityTypes';
import type { Metric, TeamMetric, MetricValue } from '../../parsers/yaml/metricParser';
import type { Team, TeamCapability } from './teamTypes';
import type { Experiment } from './experimentTypes';
import { normalizeTeamCapabilities } from './teamSchemas';
import { parseDate } from '../utils/dateFormatter';

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
 * Aggregates metrics to enrich capabilities with computed scores and trends
 */
export function enrichCapabilitiesWithMetrics(
  capabilities: Capability[],
  metrics: Metric[],
  teams: Team[]
): Capability[] {
  // Create a map of metrics by capability ID
  const metricsMap = new Map<string, Metric>();
  metrics.forEach(metric => {
    metricsMap.set(metric.capabilityId, metric);
  });

  // Count teams that are actively targeting each capability
  const targetingCounts = new Map<string, number>();
  teams.forEach(team => {
    const normalizedCapabilities = normalizeTeamCapabilities(team);
    normalizedCapabilities.forEach(tc => {
      targetingCounts.set(tc.id, (targetingCounts.get(tc.id) || 0) + 1);
    });
  });

  // Create a set of valid team IDs (teams that have files in the filesystem)
  const validTeamIds = new Set(teams.map(team => team.id));

  return capabilities
    .map(capability => {
      const metric = metricsMap.get(capability.id);

      if (metric && metric.data.length > 0) {
        // Calculate average score across all teams using each team's most recent value
        // Group data by team, filtering to only include teams with files in the filesystem
        const teamDataMap = new Map<string, typeof metric.data>();
        metric.data.forEach(dataPoint => {
          // Only include teams that have files in resources/private/yaml/teams/
          if (validTeamIds.has(dataPoint.team)) {
            if (!teamDataMap.has(dataPoint.team)) {
              teamDataMap.set(dataPoint.team, []);
            }
            teamDataMap.get(dataPoint.team)!.push(dataPoint);
          }
        });

        // Get most recent value for each team
        const currentTeamValues: number[] = [];
        const previousTeamValues: number[] = [];

        teamDataMap.forEach(teamData => {
          // Sort team's data by date (most recent first)
          const sortedTeamData = teamData.sort(
            (a, b) => parseDate(b.date).getTime() - parseDate(a.date).getTime()
          );

          // Get current (most recent) value - convert to numeric score
          const currentValue = getNumericScore(sortedTeamData[0].value);
          currentTeamValues.push(currentValue);

          // Get previous value if it exists, otherwise use current value (no change)
          if (sortedTeamData.length >= 2) {
            previousTeamValues.push(getNumericScore(sortedTeamData[1].value));
          } else {
            // Team only has one data point - treat as no change
            previousTeamValues.push(currentValue);
          }
        });

        // If no valid teams have data after filtering, treat as no metrics
        if (currentTeamValues.length === 0) {
          return {
            ...capability,
            currentScore: 0,
            trend: 'stable' as TrendDirection,
            teamsTargeting: targetingCounts.get(capability.id) || 0,
          };
        }

        // Calculate average of all teams' most recent values
        const avgScore =
          currentTeamValues.reduce((sum, v) => sum + v, 0) / currentTeamValues.length;
        const currentScore = Math.round(avgScore * 10) / 10;

        // Calculate trend by comparing current average with previous average
        let trend: TrendDirection = 'stable';

        // Both arrays now have the same length
        const prevAvg =
          previousTeamValues.reduce((sum, v) => sum + v, 0) / previousTeamValues.length;
        const scoreDiff = avgScore - prevAvg;

        if (scoreDiff > 0.1) {
          trend = 'up';
        } else if (scoreDiff < -0.1) {
          trend = 'down';
        }

        const teamsTargeting = targetingCounts.get(capability.id) || 0;

        return {
          ...capability,
          currentScore,
          trend,
          teamsTargeting,
        };
      }

      // No metrics data for this capability
      return {
        ...capability,
        currentScore: 0,
        trend: 'stable' as TrendDirection,
        teamsTargeting: targetingCounts.get(capability.id) || 0,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Enriches teams with capability scores from metrics
 * Now handles both old format (objects) and new format (strings)
 */
export function enrichTeamsWithMetrics(teams: Team[], metrics: Metric[]): Team[] {
  const metricsMap = new Map<string, Metric>();
  metrics.forEach(metric => {
    metricsMap.set(metric.capabilityId, metric);
  });

  return teams.map(team => {
    const normalizedTargeted = normalizeTeamCapabilities(team);

    const targetedCapabilities = normalizedTargeted.map(tc =>
      enrichTeamCapability(tc, team.id, metricsMap)
    );

    const nonTargetedCapabilities = team.nonTargetedCapabilities
      ? team.nonTargetedCapabilities.map(tc => enrichTeamCapability(tc, team.id, metricsMap))
      : [];

    return {
      ...team,
      targetedCapabilities,
      nonTargetedCapabilities,
      activeExperiments: team.activeExperiments || [],
    };
  });
}

function enrichTeamCapability(
  teamCapability: TeamCapability,
  teamId: string,
  metricsMap: Map<string, Metric>
): TeamCapability {
  const metric = metricsMap.get(teamCapability.id);

  if (!metric) {
    // No metrics for this capability, return with null values
    return {
      ...teamCapability,
      currentScore: null,
      trend: null,
    };
  }

  // Find the most recent data point for this team
  const teamData = metric.data.filter(d => d.team === teamId);

  if (teamData.length === 0) {
    // No data for this team, return with null values
    return {
      ...teamCapability,
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
  let trend: TrendDirection = 'stable';
  if (sortedData.length >= 2) {
    const currentValue = getNumericScore(sortedData[0].value);
    const previousValue = getNumericScore(sortedData[1].value);
    const scoreDiff = currentValue - previousValue;
    if (scoreDiff > 0) {
      trend = 'up';
    } else if (scoreDiff < 0) {
      trend = 'down';
    }
  }

  return {
    ...teamCapability,
    currentScore,
    trend,
  };
}

/**
 * Enriches experiments with resolved metric data
 * This allows the UI to display actual metric values referenced in experiments
 */
export function enrichExperimentsWithMetrics(
  experiments: Experiment[],
  _teamMetrics: TeamMetric[]
): Experiment[] {
  // No transformation needed for now - just pass through
  // In future, we could resolve metric references to include actual data
  // For now, experiments just store the reference strings
  return experiments;
}

/**
 * Helper to resolve a metric reference from an experiment
 * Returns the actual metric data for a given reference string
 * Example: resolveMetricReference("team-a/linter-error-count", teamMetrics)
 */
export function resolveMetricReference(
  metricRef: string,
  teamMetrics: TeamMetric[]
): TeamMetric | undefined {
  return teamMetrics.find(m => `${m.teamId}/${m.metricName}` === metricRef);
}
