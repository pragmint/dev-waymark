import type { Capability, TrendDirection } from '../schemas/capabilitySchemas';
import type { Metric } from '../schemas/metricSchemas';
import { parseDate } from './parseDate';
import { isDimensionScore, getNumericScore, calculateTrend } from './metricHelpers';

// Pure query functions - no I/O, no mutation

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

  const trend = calculateTrend(sortedData);

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
