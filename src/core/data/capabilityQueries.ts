import type { Capability, TrendDirection } from './capabilityTypes';
import type { Metric, MetricValue } from '../../parsers/yaml/metricParser';
import { parseDate } from '../utils/dateFormatter';

// Pure query functions - no I/O, no mutation

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
 * Calculate capability score for a specific team or all teams
 * Returns a modified capability with team-specific score and trend
 */
export function getCapabilityScoreForTeam(
  capability: Capability,
  metrics: Metric[],
  teamFilter: string | null
): Capability {
  // If no team filter or "all", return the capability as is (already has aggregated scores)
  if (!teamFilter || teamFilter === 'all') {
    return capability;
  }

  // Find the metric for this capability
  const metric = metrics.find(m => m.capabilityId === capability.id);

  if (!metric || metric.data.length === 0) {
    return {
      ...capability,
      currentScore: 0,
      trend: 'stable' as TrendDirection,
    };
  }

  // Filter data for the specific team
  const teamData = metric.data.filter(d => d.team === teamFilter);

  if (teamData.length === 0) {
    return {
      ...capability,
      currentScore: 0,
      trend: 'stable' as TrendDirection,
    };
  }

  // Sort by date (most recent first)
  const sortedData = teamData.sort(
    (a, b) => parseDate(b.date).getTime() - parseDate(a.date).getTime()
  );

  // Get current score - convert to numeric score (handles dimension scores)
  const currentScore = getNumericScore(sortedData[0].value);

  // Extract dimension scores if present
  const dimensionScores = isDimensionScore(sortedData[0].value) ? sortedData[0].value : undefined;

  // Extract justifications
  const justification = sortedData[0].justification;
  const dimensionJustifications = sortedData[0].dimensionJustifications;

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
    ...capability,
    currentScore,
    trend,
    dimensionScores,
    justification,
    dimensionJustifications,
  };
}

export function getTopThreeCapabilities(capabilities: Capability[]): Capability[] {
  // Return the top 3 capabilities by current score, with ties broken by teams targeting
  return [...capabilities]
    .sort((a, b) => {
      if (b.currentScore !== a.currentScore) {
        return b.currentScore - a.currentScore;
      }
      return b.teamsTargeting - a.teamsTargeting;
    })
    .slice(0, 3);
}
