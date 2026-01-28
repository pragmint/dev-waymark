import type { Capability, TrendDirection } from './capabilityTypes';
import type { Metric } from '../../shell/loaders/metricLoader';
import type { Team, TeamCapability } from './teamTypes';
import { parseDate } from '../utils/dateFormatter';

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
    team.targetedCapabilities?.forEach(tc => {
      targetingCounts.set(tc.id, (targetingCounts.get(tc.id) || 0) + 1);
    });
  });

  return capabilities.map(capability => {
    const metric = metricsMap.get(capability.id);

    if (metric && metric.data.length > 0) {
      // Calculate average score across all teams using each team's most recent value
      // Group data by team
      const teamDataMap = new Map<string, typeof metric.data>();
      metric.data.forEach(dataPoint => {
        if (!teamDataMap.has(dataPoint.team)) {
          teamDataMap.set(dataPoint.team, []);
        }
        teamDataMap.get(dataPoint.team)!.push(dataPoint);
      });

      // Get most recent value for each team
      const currentTeamValues: number[] = [];
      const previousTeamValues: number[] = [];

      teamDataMap.forEach(teamData => {
        // Sort team's data by date (most recent first)
        const sortedTeamData = teamData.sort(
          (a, b) => parseDate(b.date).getTime() - parseDate(a.date).getTime()
        );

        // Get current (most recent) value
        currentTeamValues.push(sortedTeamData[0].value);

        // Get previous value if it exists
        if (sortedTeamData.length >= 2) {
          previousTeamValues.push(sortedTeamData[1].value);
        }
      });

      // Calculate average of all teams' most recent values
      const avgScore = currentTeamValues.reduce((sum, v) => sum + v, 0) / currentTeamValues.length;
      const currentScore = Math.round(avgScore * 10) / 10;

      // Calculate trend by comparing current average with previous average
      let trend: TrendDirection = 'stable';

      if (previousTeamValues.length > 0) {
        const prevAvg =
          previousTeamValues.reduce((sum, v) => sum + v, 0) / previousTeamValues.length;
        const scoreDiff = avgScore - prevAvg;

        if (scoreDiff > 0.1) {
          trend = 'up';
        } else if (scoreDiff < -0.1) {
          trend = 'down';
        }
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
  });
}

/**
 * Enriches teams with capability scores from metrics
 */
export function enrichTeamsWithMetrics(teams: Team[], metrics: Metric[]): Team[] {
  // Create a map of metrics by capability ID
  const metricsMap = new Map<string, Metric>();
  metrics.forEach(metric => {
    metricsMap.set(metric.capabilityId, metric);
  });

  return teams.map(team => {
    // Build maps for targeted and non-targeted capabilities
    const targetedCapabilities = team.targetedCapabilities.map(tc =>
      enrichTeamCapability(tc, team.id, metricsMap)
    );

    const nonTargetedCapabilities = team.nonTargetedCapabilities.map(tc =>
      enrichTeamCapability(tc, team.id, metricsMap)
    );

    return {
      ...team,
      targetedCapabilities,
      nonTargetedCapabilities,
    };
  });
}

/**
 * Helper function to enrich a single team capability with metric data
 */
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
  const currentScore = sortedData[0].value;

  // Calculate trend
  let trend: TrendDirection = 'stable';
  if (sortedData.length >= 2) {
    const scoreDiff = sortedData[0].value - sortedData[1].value;
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
